use axum::{
    extract::{Path, State},
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::FromRow;

use crate::auth::{
    create_session, is_site_admin, resolve_openid, upsert_wechat_user, AuthUser,
};
use crate::error::{AppError, AppResult};
use crate::{db, AppState};

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

pub async fn healthz() -> &'static str {
    "ok"
}

// ---------------------------------------------------------------------------
// Auth: WeChat login
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct WechatLoginReq {
    pub code: String,
}

#[derive(Serialize)]
pub struct UserDto {
    pub id: i64,
    pub display_name: String,
}

#[derive(Serialize)]
pub struct LoginResp {
    pub token: String,
    pub user: UserDto,
}

pub async fn auth_wechat(
    State(state): State<AppState>,
    Json(req): Json<WechatLoginReq>,
) -> AppResult<Json<LoginResp>> {
    if req.code.trim().is_empty() {
        return Err(AppError::BadRequest("missing code".into()));
    }
    let openid = resolve_openid(&state.config, req.code.trim()).await?;
    let (user_id, display_name, _created) = upsert_wechat_user(&state.pool, &openid).await?;

    // Bootstrap: grant site_admin to the configured openid on login.
    if state.config.seed_admin_openid.as_deref() == Some(openid.as_str()) {
        db::grant_site_admin(&state.pool, user_id)
            .await
            .map_err(AppError::Internal)?;
    }

    let token = create_session(&state.pool, user_id).await?;
    Ok(Json(LoginResp {
        token,
        user: UserDto {
            id: user_id,
            display_name,
        },
    }))
}

// ---------------------------------------------------------------------------
// Meetings
// ---------------------------------------------------------------------------

#[derive(Serialize)]
pub struct SessionDto {
    pub id: i64,
    pub position: i64,
    pub group_label: String,
    pub name: String,
    pub duration_minutes: i64,
    pub role_slot_id: Option<i64>,
}

#[derive(Serialize)]
pub struct RoleSlotDto {
    pub id: i64,
    pub role_id: i64,
    pub role_name: String,
    /// Display label derived at render time: `role_name` plus an ordinal when the meeting
    /// has more than one slot of the same role (e.g. `Speaker 1`, `Speaker 2`).
    pub label: String,
    pub booker_id: Option<i64>,
    pub booker_name: Option<String>,
    pub taker_id: Option<i64>,
}

#[derive(Serialize)]
pub struct MeetingDto {
    pub id: i64,
    pub number: i64,
    pub title: String,
    pub theme: String,
    pub date: String,
    pub start_time: String,
    pub end_time: String,
    pub venue: String,
    pub status: String,
    pub sessions: Vec<SessionDto>,
    pub role_slots: Vec<RoleSlotDto>,
}

#[derive(FromRow)]
struct MeetingRow {
    id: i64,
    number: i64,
    title: String,
    theme: String,
    date: String,
    start_time: String,
    end_time: String,
    venue: String,
    status: String,
}

#[derive(FromRow)]
struct SessionRow {
    id: i64,
    position: i64,
    group_label: String,
    name: String,
    duration_minutes: i64,
    role_slot_id: Option<i64>,
}

#[derive(FromRow)]
struct SlotRow {
    id: i64,
    role_id: i64,
    role_name: String,
    booker_id: Option<i64>,
    booker_name: Option<String>,
    taker_id: Option<i64>,
}

async fn load_meeting_dto(pool: &sqlx::SqlitePool, m: MeetingRow) -> AppResult<MeetingDto> {
    let sessions = sqlx::query_as::<_, SessionRow>(
        "SELECT id, position, group_label, name, duration_minutes, role_slot_id \
         FROM session WHERE meeting_id = ? ORDER BY position",
    )
    .bind(m.id)
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|s| SessionDto {
        id: s.id,
        position: s.position,
        group_label: s.group_label,
        name: s.name,
        duration_minutes: s.duration_minutes,
        role_slot_id: s.role_slot_id,
    })
    .collect();

    let slot_rows = sqlx::query_as::<_, SlotRow>(
        "SELECT rs.id, rs.role_id, r.name AS role_name, ra.booker_id, \
                u.display_name AS booker_name, ra.taker_id \
         FROM role_slot rs \
         JOIN role r ON r.id = rs.role_id \
         LEFT JOIN role_assignment ra ON ra.role_slot_id = rs.id \
         LEFT JOIN user u ON u.id = ra.booker_id \
         WHERE rs.meeting_id = ? ORDER BY rs.id",
    )
    .bind(m.id)
    .fetch_all(pool)
    .await?;

    // Derive display labels: append an ordinal only when a role repeats in the meeting.
    let mut counts: std::collections::HashMap<i64, i64> = std::collections::HashMap::new();
    for s in &slot_rows {
        *counts.entry(s.role_id).or_insert(0) += 1;
    }
    let mut seen: std::collections::HashMap<i64, i64> = std::collections::HashMap::new();
    let role_slots = slot_rows
        .into_iter()
        .map(|s| {
            let ordinal = {
                let n = seen.entry(s.role_id).or_insert(0);
                *n += 1;
                *n
            };
            let label = if counts.get(&s.role_id).copied().unwrap_or(0) > 1 {
                format!("{} {}", s.role_name, ordinal)
            } else {
                s.role_name.clone()
            };
            RoleSlotDto {
                id: s.id,
                role_id: s.role_id,
                role_name: s.role_name,
                label,
                booker_id: s.booker_id,
                booker_name: s.booker_name,
                taker_id: s.taker_id,
            }
        })
        .collect();

    Ok(MeetingDto {
        id: m.id,
        number: m.number,
        title: m.title,
        theme: m.theme,
        date: m.date,
        start_time: m.start_time,
        end_time: m.end_time,
        venue: m.venue,
        status: m.status,
        sessions,
        role_slots,
    })
}

/// Upcoming published meetings (today onward), soonest first — for the Booking tab and
/// the Meeting tab's "next meeting" preview.
pub async fn meetings_upcoming(
    State(state): State<AppState>,
    _user: AuthUser,
) -> AppResult<Json<Vec<MeetingDto>>> {
    let today = chrono::Local::now().date_naive().to_string();
    let rows = sqlx::query_as::<_, MeetingRow>(
        "SELECT id, number, title, theme, date, start_time, end_time, venue, status \
         FROM meeting \
         WHERE status = 'published' AND is_template = 0 AND date >= ? \
         ORDER BY date ASC, number ASC",
    )
    .bind(&today)
    .fetch_all(&state.pool)
    .await?;

    let mut out = Vec::with_capacity(rows.len());
    for m in rows {
        out.push(load_meeting_dto(&state.pool, m).await?);
    }
    Ok(Json(out))
}

pub async fn meeting_detail(
    State(state): State<AppState>,
    Path(meeting_id): Path<i64>,
) -> AppResult<Json<MeetingDto>> {
    meeting_dto_by_id(&state.pool, meeting_id)
        .await?
        .map(Json)
        .ok_or(AppError::NotFound)
}

/// Load one meeting as a nested DTO by id, or `None` if it does not exist.
/// Shared by the authenticated app endpoint and the admin editor.
pub(crate) async fn meeting_dto_by_id(
    pool: &sqlx::SqlitePool,
    meeting_id: i64,
) -> AppResult<Option<MeetingDto>> {
    let m = sqlx::query_as::<_, MeetingRow>(
        "SELECT id, number, title, theme, date, start_time, end_time, venue, status \
         FROM meeting WHERE id = ?",
    )
    .bind(meeting_id)
    .fetch_optional(pool)
    .await?;

    match m {
        Some(m) => Ok(Some(load_meeting_dto(pool, m).await?)),
        None => Ok(None),
    }
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
}

#[derive(FromRow)]
struct SlotBookRow {
    meeting_id: i64,
    booker_id: Option<i64>,
}

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

    if req.cancel {
        match slot.booker_id {
            None => {} // already open — idempotent
            Some(booker) => {
                let allowed = booker == user.id
                    || is_meeting_manager(&state.pool, slot.meeting_id, user.id).await?
                    || is_site_admin(&state.pool, user.id).await?;
                if !allowed {
                    return Err(AppError::Forbidden);
                }
                // Release the booking; keep the row so a taker_id (if any) survives.
                sqlx::query(
                    "UPDATE role_assignment SET booker_id = NULL WHERE role_slot_id = ?",
                )
                .bind(req.role_slot_id)
                .execute(&state.pool)
                .await?;
            }
        }
        return Ok(Json(json!({ "ok": true, "booker_id": null })));
    }

    // Booking an open slot.
    match slot.booker_id {
        Some(booker) if booker == user.id => {} // already yours — idempotent
        Some(_) => return Err(AppError::Conflict("role already taken".into())),
        None => {
            // Upsert the assignment; only claim if still open (guards against a race).
            let affected = sqlx::query(
                "INSERT INTO role_assignment(role_slot_id, booker_id) VALUES (?, ?) \
                 ON CONFLICT(role_slot_id) DO UPDATE SET booker_id = excluded.booker_id \
                 WHERE role_assignment.booker_id IS NULL",
            )
            .bind(req.role_slot_id)
            .bind(user.id)
            .execute(&state.pool)
            .await?
            .rows_affected();
            if affected == 0 {
                return Err(AppError::Conflict("role already taken".into()));
            }
        }
    }
    Ok(Json(json!({ "ok": true, "booker_id": user.id })))
}

async fn is_meeting_manager(
    pool: &sqlx::SqlitePool,
    meeting_id: i64,
    user_id: i64,
) -> AppResult<bool> {
    let manager: Option<Option<i64>> =
        sqlx::query_scalar("SELECT meeting_manager FROM meeting WHERE id = ?")
            .bind(meeting_id)
            .fetch_optional(pool)
            .await?;
    Ok(matches!(manager, Some(Some(m)) if m == user_id))
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
    user: AuthUser,
    Path(user_id): Path<i64>,
    Json(req): Json<UpdateUserReq>,
) -> AppResult<Json<UserDto>> {
    // A user may edit self; site admins may edit anyone.
    if user.id != user_id && !is_site_admin(&state.pool, user.id).await? {
        return Err(AppError::Forbidden);
    }
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
    Ok(Json(UserDto {
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
