use axum::{
    extract::{Path, State},
    Json,
};
use serde::Deserialize;
use serde_json::json;
use sqlx::FromRow;

use crate::auth::AuthUser;
use crate::error::{AppError, AppResult};
use crate::meetings;
use crate::models::{MeetingResponse, UserResponse};
use crate::AppState;

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

pub async fn healthz() -> &'static str {
    "ok"
}

/// Upcoming published meetings (today onward), soonest first — for the Booking tab and
/// the Meeting tab's "next meeting" preview.
pub async fn meetings_upcoming(
    State(state): State<AppState>,
    _user: AuthUser,
) -> AppResult<Json<Vec<MeetingResponse>>> {
    Ok(Json(meetings::upcoming_published(&state.pool).await?))
}

pub async fn meeting_detail(
    State(state): State<AppState>,
    _user: AuthUser,
    Path(meeting_id): Path<i64>,
) -> AppResult<Json<MeetingResponse>> {
    meetings::meeting_response_by_id(&state.pool, meeting_id)
        .await?
        .map(Json)
        .ok_or(AppError::NotFound)
}

// ---------------------------------------------------------------------------
// Role booking
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct BookReq {
    pub meeting_id: i64,
    pub role_slot_id: i64,
    #[serde(default)]
    pub cancel: bool,
    /// Book/assign on behalf of this user instead of the session user (used by the web
    /// editor). Any authenticated caller may set it.
    #[serde(default)]
    pub user_id: Option<i64>,
}

#[derive(FromRow)]
struct SlotBookRow {
    meeting_id: i64,
    booker_id: Option<i64>,
}

/// Book, release or assign a role slot. Any authenticated user may act.
///
/// - No `user_id`: acts as the session user (self-booking).
/// - With `user_id`: assigns that user to the slot (used by the web editor).
pub async fn book(
    State(state): State<AppState>,
    user: AuthUser,
    Json(req): Json<BookReq>,
) -> AppResult<Json<serde_json::Value>> {
    // Slot structure is user-agnostic; the current booker comes from role_assignment.
    let slot = sqlx::query_as::<_, SlotBookRow>(
        "SELECT rs.meeting_id, ra.booker_id \
         FROM role_slot rs \
         LEFT JOIN role_assignment ra ON ra.role_slot_id = rs.id \
         WHERE rs.id = ?",
    )
    .bind(req.role_slot_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound)?;

    if slot.meeting_id != req.meeting_id {
        return Err(AppError::BadRequest(
            "role_slot does not belong to meeting".into(),
        ));
    }

    // --- Assignment on behalf of a specific user ---
    if let Some(target) = req.user_id {
        let exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM user WHERE id = ?")
            .bind(target)
            .fetch_one(&state.pool)
            .await?;
        if exists == 0 {
            return Err(AppError::BadRequest("user does not exist".into()));
        }
        sqlx::query(
            "INSERT INTO role_assignment(role_slot_id, booker_id) VALUES (?, ?) \
             ON CONFLICT(role_slot_id) DO UPDATE SET \
                booker_id = excluded.booker_id, \
                prep_data = CASE \
                    WHEN role_assignment.booker_id IS excluded.booker_id THEN role_assignment.prep_data \
                    ELSE '{}' \
                END, \
                prep_updated_at = CASE \
                    WHEN role_assignment.booker_id IS excluded.booker_id THEN role_assignment.prep_updated_at \
                    ELSE NULL \
                END",
        )
        .bind(req.role_slot_id)
        .bind(target)
        .execute(&state.pool)
        .await?;
        return Ok(Json(json!({ "ok": true, "booker_id": target })));
    }

    if req.cancel {
        match slot.booker_id {
            None => {} // already open — idempotent
            Some(_) => {
                // Release the booking; keep the row so a taker_id (if any) survives.
                sqlx::query("UPDATE role_assignment SET booker_id = NULL WHERE role_slot_id = ?")
                    .bind(req.role_slot_id)
                    .execute(&state.pool)
                    .await?;
                sqlx::query(
                    "UPDATE role_assignment SET prep_data = '{}', prep_updated_at = NULL WHERE role_slot_id = ?",
                )
                    .bind(req.role_slot_id)
                    .execute(&state.pool)
                    .await?;
            }
        }
        return Ok(Json(json!({ "ok": true, "booker_id": null })));
    }

    // --- Self-booking ---
    let me = user.id;
    match slot.booker_id {
        Some(booker) if booker == me => {} // already yours — idempotent
        Some(_) => return Err(AppError::Conflict("role already taken".into())),
        None => {
            // Upsert the assignment; only claim if still open (guards against a race).
            let affected = sqlx::query(
                "INSERT INTO role_assignment(role_slot_id, booker_id) VALUES (?, ?) \
                 ON CONFLICT(role_slot_id) DO UPDATE SET booker_id = excluded.booker_id \
                 WHERE role_assignment.booker_id IS NULL",
            )
            .bind(req.role_slot_id)
            .bind(me)
            .execute(&state.pool)
            .await?
            .rows_affected();
            if affected == 0 {
                return Err(AppError::Conflict("role already taken".into()));
            }
        }
    }
    Ok(Json(json!({ "ok": true, "booker_id": me })))
}

// ---------------------------------------------------------------------------
// Role preparation data
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct PrepUpdateReq {
    pub role_slot_id: i64,
    #[serde(default)]
    pub prep_data: serde_json::Value,
}

#[derive(FromRow)]
struct PrepSlotRow {
    meeting_id: i64,
}

pub async fn update_prep(
    State(state): State<AppState>,
    _user: AuthUser,
    Path(meeting_id): Path<i64>,
    Json(req): Json<PrepUpdateReq>,
) -> AppResult<Json<MeetingResponse>> {
    let slot = sqlx::query_as::<_, PrepSlotRow>(
        "SELECT rs.meeting_id \
         FROM role_slot rs \
         WHERE rs.id = ?",
    )
    .bind(req.role_slot_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound)?;

    if slot.meeting_id != meeting_id {
        return Err(AppError::BadRequest(
            "role_slot does not belong to meeting".into(),
        ));
    }
    if !req.prep_data.is_object() {
        return Err(AppError::BadRequest("prep_data must be an object".into()));
    }

    sqlx::query(
        "INSERT INTO role_assignment(role_slot_id, prep_data, prep_updated_at) \
         VALUES (?, ?, datetime('now')) \
         ON CONFLICT(role_slot_id) DO UPDATE SET \
            prep_data = excluded.prep_data, prep_updated_at = excluded.prep_updated_at",
    )
    .bind(req.role_slot_id)
    .bind(req.prep_data.to_string())
    .execute(&state.pool)
    .await?;

    meetings::meeting_response_by_id(&state.pool, meeting_id)
        .await?
        .map(Json)
        .ok_or(AppError::NotFound)
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct UpdateUserReq {
    pub display_name: String,
}

pub async fn update_user(
    State(state): State<AppState>,
    _user: AuthUser,
    Path(user_id): Path<i64>,
    Json(req): Json<UpdateUserReq>,
) -> AppResult<Json<UserResponse>> {
    let name = req.display_name.trim();
    if name.is_empty() {
        return Err(AppError::BadRequest("display_name is required".into()));
    }

    let affected = sqlx::query("UPDATE user SET display_name = ? WHERE id = ?")
        .bind(name)
        .bind(user_id)
        .execute(&state.pool)
        .await?
        .rows_affected();
    if affected == 0 {
        return Err(AppError::NotFound);
    }
    Ok(Json(UserResponse {
        id: user_id,
        display_name: name.to_string(),
    }))
}

// ---------------------------------------------------------------------------
// Club info (static for now)
// ---------------------------------------------------------------------------

pub async fn club_info() -> Json<serde_json::Value> {
    Json(json!({
        "name": "Microsoft Suzhou Toastmasters Club",
        "motto": "Where leaders are made",
        "about": "MISU is the Microsoft Suzhou Toastmasters Club, a friendly community where members practice public speaking and leadership in a supportive environment.",
        "meetings": {
            "cadence": "Every other Saturday · 19:00",
            "venue": "Room A, Building X"
        },
        "join": "Guests are always welcome. Come to a meeting to experience it, then talk to any officer about becoming a member.",
        "contact": "Scan our WeChat group QR code at a meeting, or reach out to any club officer."
    }))
}
