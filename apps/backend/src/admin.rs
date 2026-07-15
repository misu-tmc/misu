// Web admin surface: server-served HTML pages plus the admin-scoped JSON APIs
// (meeting list/upsert, roles catalog, user management) served on the shared
// `/api/*` paths.
//
// The pages require a web session and redirect to `/login` when absent; the JSON APIs
// require a `site_admin` grant (the `AdminUser` extractor).

use axum::{
    extract::{Path, Query, State},
    http::{header, StatusCode},
    response::{Html, IntoResponse, Redirect, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::FromRow;
use std::collections::HashSet;

use crate::auth::{AdminUser, MaybeAuthUser};
use crate::error::{AppError, AppResult};
use crate::handlers;
use crate::AppState;

// ---------------------------------------------------------------------------
// Page serving (self-contained HTML files under the configured web dir)
// ---------------------------------------------------------------------------

async fn read_page(state: &AppState, file: &str) -> Response {
    let path = std::path::Path::new(&state.config.web_dir).join(file);
    match tokio::fs::read_to_string(&path).await {
        Ok(content) => Html(content).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("failed to read {}: {e}", path.display()),
        )
            .into_response(),
    }
}

/// Serve an admin page, redirecting to `/login` when there is no web session.
async fn serve_admin(state: &AppState, maybe: MaybeAuthUser, file: &str) -> Response {
    match maybe.0 {
        Some(_) => read_page(state, file).await,
        None => Redirect::to("/login").into_response(),
    }
}

/// The login page is always reachable (it is how you get a session).
pub async fn page_login(State(s): State<AppState>) -> Response {
    read_page(&s, "login.html").await
}

pub async fn page_meetings(State(s): State<AppState>, m: MaybeAuthUser) -> Response {
    serve_admin(&s, m, "meetings.html").await
}

pub async fn page_users(State(s): State<AppState>, m: MaybeAuthUser) -> Response {
    serve_admin(&s, m, "users.html").await
}

pub async fn page_editor(State(s): State<AppState>, m: MaybeAuthUser) -> Response {
    serve_admin(&s, m, "editor.html").await
}

pub async fn page_agenda_print(State(s): State<AppState>, m: MaybeAuthUser) -> Response {
    serve_admin(&s, m, "agenda-print.html").await
}

/// Serve static assets used by the print agenda and web pages.
pub async fn static_asset(State(s): State<AppState>, Path(path): Path<String>) -> Response {
    if path.contains("..") || path.starts_with('/') {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let full = std::path::Path::new(&s.config.static_dir).join(&path);
    match tokio::fs::read(&full).await {
        Ok(bytes) => {
            let content_type = match full.extension().and_then(|e| e.to_str()).unwrap_or("") {
                "png" => "image/png",
                "jpg" | "jpeg" => "image/jpeg",
                "svg" => "image/svg+xml",
                "webp" => "image/webp",
                "css" => "text/css; charset=utf-8",
                "js" => "application/javascript; charset=utf-8",
                _ => "application/octet-stream",
            };
            ([(header::CONTENT_TYPE, content_type)], bytes).into_response()
        }
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

// ---------------------------------------------------------------------------
// Meetings: list
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct ListQuery {
    pub scope: Option<String>,
}

#[derive(FromRow, Serialize)]
pub struct MeetingSummary {
    pub id: i64,
    pub number: i64,
    pub title: String,
    pub theme: String,
    pub date: String,
    pub start_time: String,
    pub end_time: String,
    pub venue: String,
    pub status: String,
    /// Derived lifecycle phase: `draft`, `open`, `ongoing`, or `archived`.
    #[sqlx(default)]
    pub phase: String,
    pub is_template: i64,
    pub meeting_manager: Option<i64>,
}

const SUMMARY_COLS: &str = "id, number, title, theme, date, start_time, end_time, venue, status, is_template, meeting_manager";

/// `scope`: `open` (today onward, default), `archived` (past), `all`, or `templates`.
pub async fn list_meetings(
    State(state): State<AppState>,
    _admin: AdminUser,
    Query(q): Query<ListQuery>,
) -> AppResult<Json<Vec<MeetingSummary>>> {
    let today = chrono::Local::now().date_naive().to_string();
    let scope = q.scope.as_deref().unwrap_or("open");

    let mut rows = match scope {
        "templates" => {
            sqlx::query_as::<_, MeetingSummary>(&format!(
                "SELECT {SUMMARY_COLS} FROM meeting WHERE is_template = 1 ORDER BY number DESC"
            ))
            .fetch_all(&state.pool)
            .await?
        }
        "all" => {
            sqlx::query_as::<_, MeetingSummary>(&format!(
                "SELECT {SUMMARY_COLS} FROM meeting ORDER BY date DESC, number DESC"
            ))
            .fetch_all(&state.pool)
            .await?
        }
        "archived" => {
            sqlx::query_as::<_, MeetingSummary>(&format!(
                "SELECT {SUMMARY_COLS} FROM meeting WHERE date < ? \
                 ORDER BY date DESC, number DESC"
            ))
            .bind(&today)
            .fetch_all(&state.pool)
            .await?
        }
        _ => {
            // open
            sqlx::query_as::<_, MeetingSummary>(&format!(
                "SELECT {SUMMARY_COLS} FROM meeting WHERE date >= ? \
                 ORDER BY date ASC, number ASC"
            ))
            .bind(&today)
            .fetch_all(&state.pool)
            .await?
        }
    };
    for m in &mut rows {
        m.phase = handlers::meeting_phase(&m.status, &m.date, &m.start_time).to_string();
    }
    Ok(Json(rows))
}

// ---------------------------------------------------------------------------
// Meetings: upsert (the editor's Save / Publish)
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct SlotIn {
    pub role_slot_id: Option<i64>,
    pub role_id: Option<i64>,
    pub role_name: Option<String>,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub is_optional: bool,
}

#[derive(Deserialize)]
pub struct SessionIn {
    pub position: i64,
    #[serde(default)]
    pub group_label: String,
    pub name: String,
    #[serde(default)]
    pub duration_minutes: i64,
    /// Index into the posted `role_slots` array, or null for a session with no role.
    pub role_slot_index: Option<usize>,
}

#[derive(Deserialize)]
pub struct MeetingIn {
    pub meeting_id: Option<i64>,
    pub number: Option<i64>,
    pub title: String,
    #[serde(default)]
    pub theme: String,
    #[serde(default)]
    pub keyword: String,
    pub date: String,
    pub start_time: String,
    #[serde(default)]
    pub end_time: String,
    #[serde(default)]
    pub venue: String,
    #[serde(default)]
    pub is_template: bool,
    pub status: Option<String>,
    #[serde(default)]
    pub role_slots: Vec<SlotIn>,
    #[serde(default)]
    pub sessions: Vec<SessionIn>,
}

/// Upsert a whole meeting document. Creates when `meeting_id` is absent, otherwise
/// overwrites structure. Role slots matched by `role_slot_id` keep their `booker_id`,
/// so saving/publishing never clobbers bookings.
pub async fn upsert_meeting(
    State(state): State<AppState>,
    _admin: AdminUser,
    Json(input): Json<MeetingIn>,
) -> AppResult<Json<handlers::MeetingDto>> {
    if input.title.trim().is_empty() {
        return Err(AppError::BadRequest("title is required".into()));
    }
    if input.date.trim().is_empty() {
        return Err(AppError::BadRequest("date is required".into()));
    }

    let status = match input.status.as_deref() {
        Some("published") => "published",
        _ => "draft",
    };

    let mut tx = state.pool.begin().await?;

    // Resolve every slot's role_id (create role from name for the creatable combobox).
    let mut slot_role_ids: Vec<i64> = Vec::with_capacity(input.role_slots.len());
    for slot in &input.role_slots {
        let role_id = match slot.role_id {
            Some(id) => id,
            None => {
                let name = slot
                    .role_name
                    .as_deref()
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .ok_or_else(|| AppError::BadRequest("each role slot needs a role".into()))?;
                sqlx::query("INSERT OR IGNORE INTO role(name) VALUES (?)")
                    .bind(name)
                    .execute(&mut *tx)
                    .await?;
                sqlx::query_scalar::<_, i64>("SELECT id FROM role WHERE name = ?")
                    .bind(name)
                    .fetch_one(&mut *tx)
                    .await?
            }
        };
        slot_role_ids.push(role_id);
    }

    // Upsert the meeting row.
    let meeting_id = match input.meeting_id {
        Some(id) => {
            let number = match input.number {
                Some(n) => n,
                None => sqlx::query_scalar::<_, i64>("SELECT number FROM meeting WHERE id = ?")
                    .bind(id)
                    .fetch_optional(&mut *tx)
                    .await?
                    .ok_or(AppError::NotFound)?,
            };
            let affected = sqlx::query(
                "UPDATE meeting SET number = ?, title = ?, theme = ?, keyword = ?, date = ?, start_time = ?, \
                 end_time = ?, venue = ?, status = ?, is_template = ? WHERE id = ?",
            )
            .bind(number)
            .bind(input.title.trim())
            .bind(input.theme.trim())
            .bind(input.keyword.trim())
            .bind(input.date.trim())
            .bind(input.start_time.trim())
            .bind(input.end_time.trim())
            .bind(input.venue.trim())
            .bind(status)
            .bind(input.is_template as i64)
            .bind(id)
            .execute(&mut *tx)
            .await?
            .rows_affected();
            if affected == 0 {
                return Err(AppError::NotFound);
            }
            id
        }
        None => {
            let number = match input.number {
                Some(n) => n,
                None => {
                    sqlx::query_scalar::<_, i64>("SELECT COALESCE(MAX(number), 0) + 1 FROM meeting")
                        .fetch_one(&mut *tx)
                        .await?
                }
            };
            sqlx::query_scalar::<_, i64>(
                "INSERT INTO meeting(number, title, theme, keyword, date, start_time, end_time, venue, \
                 status, is_template) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
            )
            .bind(number)
            .bind(input.title.trim())
            .bind(input.theme.trim())
            .bind(input.keyword.trim())
            .bind(input.date.trim())
            .bind(input.start_time.trim())
            .bind(input.end_time.trim())
            .bind(input.venue.trim())
            .bind(status)
            .bind(input.is_template as i64)
            .fetch_one(&mut *tx)
            .await?
        }
    };

    // Existing slots for this meeting (to preserve bookings and drop removed ones).
    let existing_slots: Vec<i64> =
        sqlx::query_scalar("SELECT id FROM role_slot WHERE meeting_id = ?")
            .bind(meeting_id)
            .fetch_all(&mut *tx)
            .await?;
    let existing_set: HashSet<i64> = existing_slots.iter().copied().collect();

    // Remove sessions first so role_slot deletes don't hit the FK reference.
    sqlx::query("DELETE FROM session WHERE meeting_id = ?")
        .bind(meeting_id)
        .execute(&mut *tx)
        .await?;

    // Upsert slots; build index -> actual id map and the keep set.
    let mut index_to_id: Vec<i64> = Vec::with_capacity(input.role_slots.len());
    let mut keep: HashSet<i64> = HashSet::new();
    for (slot, role_id) in input.role_slots.iter().zip(slot_role_ids.iter()) {
        let label = slot
            .label
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty());
        let id = match slot.role_slot_id {
            Some(id) if existing_set.contains(&id) => {
                sqlx::query(
                    "UPDATE role_slot SET role_id = ?, label = ?, is_optional = ? WHERE id = ?",
                )
                .bind(role_id)
                .bind(label)
                .bind(slot.is_optional as i64)
                .bind(id)
                .execute(&mut *tx)
                .await?;
                id
            }
            _ => sqlx::query_scalar::<_, i64>(
                "INSERT INTO role_slot(meeting_id, role_id, label, is_optional) \
                 VALUES (?, ?, ?, ?) RETURNING id",
            )
            .bind(meeting_id)
            .bind(role_id)
            .bind(label)
            .bind(slot.is_optional as i64)
            .fetch_one(&mut *tx)
            .await?,
        };
        keep.insert(id);
        index_to_id.push(id);
    }

    // Delete slots that were removed in the editor.
    for old in existing_slots {
        if !keep.contains(&old) {
            sqlx::query("DELETE FROM role_slot WHERE id = ?")
                .bind(old)
                .execute(&mut *tx)
                .await?;
        }
    }

    // Re-insert sessions, resolving role_slot_index to actual slot ids.
    for s in &input.sessions {
        let role_slot_id = match s.role_slot_index {
            Some(i) => Some(*index_to_id.get(i).ok_or_else(|| {
                AppError::BadRequest("session references an unknown role slot".into())
            })?),
            None => None,
        };
        sqlx::query(
            "INSERT INTO session(meeting_id, position, group_label, name, duration_minutes, \
             role_slot_id) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(meeting_id)
        .bind(s.position)
        .bind(s.group_label.trim())
        .bind(s.name.trim())
        .bind(s.duration_minutes)
        .bind(role_slot_id)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;

    handlers::meeting_dto_by_id(&state.pool, meeting_id)
        .await?
        .map(Json)
        .ok_or(AppError::NotFound)
}

// ---------------------------------------------------------------------------
// Roles catalog
// ---------------------------------------------------------------------------

#[derive(FromRow, Serialize)]
pub struct RoleDto {
    pub id: i64,
    pub name: String,
}

pub async fn list_roles(State(state): State<AppState>, _admin: AdminUser) -> AppResult<Json<Vec<RoleDto>>> {
    let rows = sqlx::query_as::<_, RoleDto>("SELECT id, name FROM role ORDER BY name")
        .fetch_all(&state.pool)
        .await?;
    Ok(Json(rows))
}

#[derive(Deserialize)]
pub struct RoleIn {
    pub name: String,
}

pub async fn create_role(
    State(state): State<AppState>,
    _admin: AdminUser,
    Json(input): Json<RoleIn>,
) -> AppResult<Json<RoleDto>> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err(AppError::BadRequest("role name is required".into()));
    }
    sqlx::query("INSERT OR IGNORE INTO role(name) VALUES (?)")
        .bind(name)
        .execute(&state.pool)
        .await?;
    let id = sqlx::query_scalar::<_, i64>("SELECT id FROM role WHERE name = ?")
        .bind(name)
        .fetch_one(&state.pool)
        .await?;
    Ok(Json(RoleDto {
        id,
        name: name.to_string(),
    }))
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

#[derive(FromRow)]
struct UserRow {
    id: i64,
    display_name: String,
    is_site_admin: i64,
}

#[derive(Serialize)]
pub struct UserRowDto {
    pub id: i64,
    pub display_name: String,
    pub is_site_admin: bool,
}

pub async fn list_users(State(state): State<AppState>, _admin: AdminUser) -> AppResult<Json<Vec<UserRowDto>>> {
    let rows = sqlx::query_as::<_, UserRow>(
        "SELECT u.id, u.display_name, \
         EXISTS(SELECT 1 FROM user_permission p WHERE p.user_id = u.id \
                AND p.permission = 'site_admin' AND p.revoked_at IS NULL) AS is_site_admin \
         FROM user u ORDER BY u.id",
    )
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(
        rows.into_iter()
            .map(|r| UserRowDto {
                id: r.id,
                display_name: r.display_name,
                is_site_admin: r.is_site_admin != 0,
            })
            .collect(),
    ))
}

#[derive(Deserialize)]
pub struct PermissionIn {
    pub permission: String,
    pub grant: bool,
}

/// Grant or revoke a permission for a user. Currently only `site_admin`.
pub async fn set_permission(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(user_id): Path<i64>,
    Json(input): Json<PermissionIn>,
) -> AppResult<Json<serde_json::Value>> {
    if input.permission != "site_admin" {
        return Err(AppError::BadRequest("unsupported permission".into()));
    }
    let exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM user WHERE id = ?")
        .bind(user_id)
        .fetch_one(&state.pool)
        .await?;
    if exists == 0 {
        return Err(AppError::NotFound);
    }

    if input.grant {
        let active: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM user_permission \
             WHERE user_id = ? AND permission = 'site_admin' AND revoked_at IS NULL",
        )
        .bind(user_id)
        .fetch_one(&state.pool)
        .await?;
        if active == 0 {
            sqlx::query(
                "INSERT INTO user_permission(user_id, permission, granted_by, granted_at) \
                 VALUES (?, 'site_admin', NULL, ?)",
            )
            .bind(user_id)
            .bind(chrono::Utc::now().to_rfc3339())
            .execute(&state.pool)
            .await?;
        }
    } else {
        sqlx::query(
            "UPDATE user_permission SET revoked_at = ? \
             WHERE user_id = ? AND permission = 'site_admin' AND revoked_at IS NULL",
        )
        .bind(chrono::Utc::now().to_rfc3339())
        .bind(user_id)
        .execute(&state.pool)
        .await?;
    }

    Ok(Json(json!({ "ok": true, "user_id": user_id, "is_site_admin": input.grant })))
}

// ---------------------------------------------------------------------------
// Create a bare (identity-less) user
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct NewUserIn {
    pub display_name: String,
}

/// Create a user with only a display name and no auth identity. Such a user can be
/// assigned to roles but cannot log in until an identity (e.g. WeChat) is linked, by
/// design (identity is separate from the user record).
pub async fn create_user(
    State(state): State<AppState>,
    _admin: AdminUser,
    Json(input): Json<NewUserIn>,
) -> AppResult<Json<UserRowDto>> {
    let name = input.display_name.trim();
    if name.is_empty() {
        return Err(AppError::BadRequest("display_name is required".into()));
    }
    let id = sqlx::query_scalar::<_, i64>("INSERT INTO user(display_name) VALUES (?) RETURNING id")
        .bind(name)
        .fetch_one(&state.pool)
        .await?;
    Ok(Json(UserRowDto {
        id,
        display_name: name.to_string(),
        is_site_admin: false,
    }))
}
