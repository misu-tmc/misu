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
    taker_id: Option<i64>,
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
    // Slot structure is user-agnostic; the current assignee comes from role_assignment.
    let slot = sqlx::query_as::<_, SlotBookRow>(
        "SELECT rs.meeting_id, ra.taker_id \
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
            "INSERT INTO role_assignment(role_slot_id, taker_id) VALUES (?, ?) \
             ON DUPLICATE KEY UPDATE taker_id = VALUES(taker_id)",
        )
        .bind(req.role_slot_id)
        .bind(target)
        .execute(&state.pool)
        .await?;
        // A different speaker invalidates any speech details already on the slot.
        sqlx::query("DELETE FROM speech WHERE role_slot_id = ? AND speaker_id <> ?")
            .bind(req.role_slot_id)
            .bind(target)
            .execute(&state.pool)
            .await?;
        return Ok(Json(json!({ "ok": true, "taker_id": target })));
    }

    if req.cancel {
        match slot.taker_id {
            None => {} // already open — idempotent
            Some(_) => {
                // Release the assignment; keep the row structure clean.
                sqlx::query("UPDATE role_assignment SET taker_id = NULL WHERE role_slot_id = ?")
                    .bind(req.role_slot_id)
                    .execute(&state.pool)
                    .await?;
                // No speaker means no speech.
                sqlx::query("DELETE FROM speech WHERE role_slot_id = ?")
                    .bind(req.role_slot_id)
                    .execute(&state.pool)
                    .await?;
            }
        }
        return Ok(Json(json!({ "ok": true, "taker_id": null })));
    }

    // --- Self-booking ---
    let me = user.id;
    match slot.taker_id {
        Some(taker) if taker == me => {} // already yours — idempotent
        Some(_) => return Err(AppError::Conflict("role already taken".into())),
        None => {
            // Upsert the assignment; only claim if still open (guards against a race).
            // MySQL reports 0 affected rows when the duplicate row is already booked,
            // and 2 when an open row is claimed by the conditional update.
            let affected = sqlx::query(
                "INSERT INTO role_assignment(role_slot_id, taker_id) VALUES (?, ?) \
                 ON DUPLICATE KEY UPDATE taker_id = IF(taker_id IS NULL, VALUES(taker_id), taker_id)",
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
    Ok(Json(json!({ "ok": true, "taker_id": me })))
}

// ---------------------------------------------------------------------------
// Prepared-speech details (dedicated `speech` table)
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct SpeechUpdateReq {
    pub role_slot_id: i64,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub pathway: String,
    #[serde(default)]
    pub level: Option<i64>,
    #[serde(default)]
    pub purpose: String,
    #[serde(default)]
    pub description: String,
}

#[derive(FromRow)]
struct SpeechSlotRow {
    meeting_id: i64,
    taker_id: Option<i64>,
}

/// `PUT /api/meetings/:id/speech` — upsert a prepared speech's details. A speech is always
/// performed by someone, so the slot must have a booked speaker; otherwise this is a 400.
pub async fn update_speech(
    State(state): State<AppState>,
    _user: AuthUser,
    Path(meeting_id): Path<i64>,
    Json(req): Json<SpeechUpdateReq>,
) -> AppResult<Json<MeetingResponse>> {
    let slot = sqlx::query_as::<_, SpeechSlotRow>(
        "SELECT rs.meeting_id, ra.taker_id \
         FROM role_slot rs \
         LEFT JOIN role_assignment ra ON ra.role_slot_id = rs.id \
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
    let speaker_id = slot.taker_id.ok_or_else(|| {
        AppError::BadRequest("assign a speaker before adding speech details".into())
    })?;

    let title = req.title.trim();
    if title.is_empty() {
        return Err(AppError::BadRequest("speech title is required".into()));
    }

    sqlx::query(
        "INSERT INTO speech(role_slot_id, meeting_id, speaker_id, title, pathway, level, \
            purpose, description, updated_at) \
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP()) \
            ON DUPLICATE KEY UPDATE \
                speaker_id = VALUES(speaker_id), title = VALUES(title), \
                pathway = VALUES(pathway), level = VALUES(level), purpose = VALUES(purpose), \
                description = VALUES(description), updated_at = VALUES(updated_at)",
    )
    .bind(req.role_slot_id)
    .bind(meeting_id)
    .bind(speaker_id)
    .bind(title)
    .bind(req.pathway.trim())
    .bind(req.level)
    .bind(req.purpose.trim())
    .bind(req.description.trim())
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
