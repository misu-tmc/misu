// Web admin surface: server-served HTML pages plus the admin-scoped JSON APIs
// (meeting list/upsert, roles catalog, user management) served on the shared
// `/api/*` paths.
//
// The pages require a web session and redirect to `/login` when absent; the JSON APIs
// require an authenticated session (the `AuthUser` extractor).

use axum::{
    extract::{Path, Query, State},
    http::{header, StatusCode},
    response::{Html, IntoResponse, Redirect, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqliteConnection};
use std::collections::HashSet;

use crate::auth::{AuthUser, MaybeAuthUser};
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

const SUMMARY_COLS: &str = "m.id, m.number, m.title, m.theme, m.date, m.start_time, m.end_time, \
    COALESCE(v.name, '') AS venue, m.status, \
    CASE WHEN t.meeting_id IS NULL THEN 0 ELSE 1 END AS is_template, m.meeting_manager";
const SUMMARY_FROM: &str = "meeting m \
    LEFT JOIN venue v ON v.id = m.venue_id \
    LEFT JOIN template t ON t.meeting_id = m.id";

/// `scope`: `open` (today onward, default), `archived` (past), `all`, or `templates`.
pub async fn list_meetings(
    State(state): State<AppState>,
    _user: AuthUser,
    Query(q): Query<ListQuery>,
) -> AppResult<Json<Vec<MeetingSummary>>> {
    let today = chrono::Local::now().date_naive().to_string();
    let scope = q.scope.as_deref().unwrap_or("open");

    let mut rows = match scope {
        "templates" => {
            sqlx::query_as::<_, MeetingSummary>(&format!(
                "SELECT {SUMMARY_COLS} FROM {SUMMARY_FROM} \
                 WHERE t.meeting_id IS NOT NULL ORDER BY m.number DESC"
            ))
            .fetch_all(&state.pool)
            .await?
        }
        "all" => {
            sqlx::query_as::<_, MeetingSummary>(&format!(
                "SELECT {SUMMARY_COLS} FROM {SUMMARY_FROM} ORDER BY m.date DESC, m.number DESC"
            ))
            .fetch_all(&state.pool)
            .await?
        }
        "archived" => {
            sqlx::query_as::<_, MeetingSummary>(&format!(
                "SELECT {SUMMARY_COLS} FROM {SUMMARY_FROM} WHERE m.date < ? \
                 ORDER BY m.date DESC, m.number DESC"
            ))
            .bind(&today)
            .fetch_all(&state.pool)
            .await?
        }
        _ => {
            // open
            sqlx::query_as::<_, MeetingSummary>(&format!(
                "SELECT {SUMMARY_COLS} FROM {SUMMARY_FROM} WHERE m.date >= ? \
                 ORDER BY m.date ASC, m.number ASC"
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
    _user: AuthUser,
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
    let venue_id = resolve_venue_id(&mut *tx, &input.venue).await?;

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
                  end_time = ?, venue_id = ?, status = ? WHERE id = ?",
            )
            .bind(number)
            .bind(input.title.trim())
            .bind(input.theme.trim())
            .bind(input.keyword.trim())
            .bind(input.date.trim())
            .bind(input.start_time.trim())
            .bind(input.end_time.trim())
            .bind(venue_id)
            .bind(status)
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
                 "INSERT INTO meeting(number, title, theme, keyword, date, start_time, end_time, venue_id, \
                  status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
            )
            .bind(number)
            .bind(input.title.trim())
            .bind(input.theme.trim())
            .bind(input.keyword.trim())
            .bind(input.date.trim())
            .bind(input.start_time.trim())
            .bind(input.end_time.trim())
            .bind(venue_id)
            .bind(status)
            .fetch_one(&mut *tx)
            .await?
        }
    };

    if input.is_template {
        sqlx::query("INSERT OR IGNORE INTO template(meeting_id) VALUES (?)")
            .bind(meeting_id)
            .execute(&mut *tx)
            .await?;
    } else {
        sqlx::query("DELETE FROM template WHERE meeting_id = ?")
            .bind(meeting_id)
            .execute(&mut *tx)
            .await?;
    }

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
            _ => {
                sqlx::query_scalar::<_, i64>(
                    "INSERT INTO role_slot(meeting_id, role_id, label, is_optional) \
                 VALUES (?, ?, ?, ?) RETURNING id",
                )
                .bind(meeting_id)
                .bind(role_id)
                .bind(label)
                .bind(slot.is_optional as i64)
                .fetch_one(&mut *tx)
                .await?
            }
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
// Mini program editor: per-section batch saves
//
// Each section of the mobile accordion editor persists on its own, touching only its
// own table(s). This avoids the whole-document `upsert_meeting` rewrite so saving one
// section never clobbers another. See design/functionalities/meeting_info.md.
// ---------------------------------------------------------------------------

/// Return the meeting as a DTO after a section save (shared tail of every handler below).
async fn meeting_dto_response(
    pool: &sqlx::SqlitePool,
    meeting_id: i64,
) -> AppResult<Json<handlers::MeetingDto>> {
    handlers::meeting_dto_by_id(pool, meeting_id)
        .await?
        .map(Json)
        .ok_or(AppError::NotFound)
}

async fn resolve_venue_id(conn: &mut SqliteConnection, venue: &str) -> AppResult<Option<i64>> {
    let venue = venue.trim();
    if venue.is_empty() {
        return Ok(None);
    }
    sqlx::query("INSERT OR IGNORE INTO venue(name) VALUES (?)")
        .bind(venue)
        .execute(&mut *conn)
        .await?;
    Ok(Some(
        sqlx::query_scalar::<_, i64>("SELECT id FROM venue WHERE name = ?")
            .bind(venue)
            .fetch_one(&mut *conn)
            .await?,
    ))
}

// --- Info section: the meeting header row --------------------------------------------

#[derive(Deserialize)]
pub struct InfoIn {
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
}

/// `PUT /api/meetings/:id/info` — update only the meeting header. Never touches
/// structure (slots/sessions) or lifecycle status.
pub async fn update_meeting_info(
    State(state): State<AppState>,
    _user: AuthUser,
    Path(meeting_id): Path<i64>,
    Json(input): Json<InfoIn>,
) -> AppResult<Json<handlers::MeetingDto>> {
    if input.title.trim().is_empty() {
        return Err(AppError::BadRequest("title is required".into()));
    }
    if input.date.trim().is_empty() {
        return Err(AppError::BadRequest("date is required".into()));
    }

    let mut tx = state.pool.begin().await?;
    let venue_id = resolve_venue_id(&mut *tx, &input.venue).await?;

    let affected = sqlx::query(
        "UPDATE meeting SET title = ?, theme = ?, keyword = ?, date = ?, start_time = ?, \
         end_time = ?, venue_id = ? WHERE id = ?",
    )
    .bind(input.title.trim())
    .bind(input.theme.trim())
    .bind(input.keyword.trim())
    .bind(input.date.trim())
    .bind(input.start_time.trim())
    .bind(input.end_time.trim())
    .bind(venue_id)
    .bind(meeting_id)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if affected == 0 {
        return Err(AppError::NotFound);
    }

    tx.commit().await?;

    meeting_dto_response(&state.pool, meeting_id).await
}

// --- Roles section: reconcile the meeting's role_slot list (+ bookers) ---------------

#[derive(Deserialize)]
pub struct SlotBatchIn {
    /// Present for an existing slot (preserves its booking); absent for a new one.
    pub role_slot_id: Option<i64>,
    pub role_id: Option<i64>,
    pub role_name: Option<String>,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub is_optional: bool,
    /// Assigned booker; `null` clears the booking. Reconciled into `role_assignment`.
    #[serde(default)]
    pub booker_id: Option<i64>,
}

#[derive(Deserialize)]
pub struct SlotsIn {
    #[serde(default)]
    pub slots: Vec<SlotBatchIn>,
}

/// `PUT /api/meetings/:id/slots` — replace the whole role-slot list in one batch.
/// Existing slots are matched by `role_slot_id` (so bookings survive), new slots are
/// inserted, removed slots deleted, and each slot's `booker_id` is reconciled into
/// `role_assignment`.
pub async fn put_slots(
    State(state): State<AppState>,
    _user: AuthUser,
    Path(meeting_id): Path<i64>,
    Json(input): Json<SlotsIn>,
) -> AppResult<Json<handlers::MeetingDto>> {
    let mut tx = state.pool.begin().await?;

    let exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM meeting WHERE id = ?")
        .bind(meeting_id)
        .fetch_one(&mut *tx)
        .await?;
    if exists == 0 {
        return Err(AppError::NotFound);
    }

    // Resolve each slot's role_id, creating the role from a name when needed.
    let mut role_ids: Vec<i64> = Vec::with_capacity(input.slots.len());
    for slot in &input.slots {
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
        role_ids.push(role_id);
    }

    let existing_slots: Vec<i64> =
        sqlx::query_scalar("SELECT id FROM role_slot WHERE meeting_id = ?")
            .bind(meeting_id)
            .fetch_all(&mut *tx)
            .await?;
    let existing_set: HashSet<i64> = existing_slots.iter().copied().collect();

    let mut keep: HashSet<i64> = HashSet::new();
    for (slot, role_id) in input.slots.iter().zip(role_ids.iter()) {
        let label = slot
            .label
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty());
        let slot_id = match slot.role_slot_id {
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
            _ => {
                sqlx::query_scalar::<_, i64>(
                    "INSERT INTO role_slot(meeting_id, role_id, label, is_optional) \
                 VALUES (?, ?, ?, ?) RETURNING id",
                )
                .bind(meeting_id)
                .bind(role_id)
                .bind(label)
                .bind(slot.is_optional as i64)
                .fetch_one(&mut *tx)
                .await?
            }
        };
        keep.insert(slot_id);

        // Reconcile the booker into role_assignment.
        match slot.booker_id {
            Some(booker) => {
                let user_exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM user WHERE id = ?")
                    .bind(booker)
                    .fetch_one(&mut *tx)
                    .await?;
                if user_exists == 0 {
                    return Err(AppError::BadRequest("booker does not exist".into()));
                }
                sqlx::query(
                    "INSERT INTO role_assignment(role_slot_id, booker_id) VALUES (?, ?) \
                     ON CONFLICT(role_slot_id) DO UPDATE SET booker_id = excluded.booker_id",
                )
                .bind(slot_id)
                .bind(booker)
                .execute(&mut *tx)
                .await?;
            }
            None => {
                // Clear any booking but keep the row so a taker_id (if any) survives.
                sqlx::query("UPDATE role_assignment SET booker_id = NULL WHERE role_slot_id = ?")
                    .bind(slot_id)
                    .execute(&mut *tx)
                    .await?;
            }
        }
    }

    // Remove slots dropped in the editor: detach sessions, drop assignment, delete slot.
    for old in existing_slots {
        if !keep.contains(&old) {
            sqlx::query("UPDATE session SET role_slot_id = NULL WHERE role_slot_id = ?")
                .bind(old)
                .execute(&mut *tx)
                .await?;
            sqlx::query("DELETE FROM role_assignment WHERE role_slot_id = ?")
                .bind(old)
                .execute(&mut *tx)
                .await?;
            sqlx::query("DELETE FROM role_slot WHERE id = ?")
                .bind(old)
                .execute(&mut *tx)
                .await?;
        }
    }

    tx.commit().await?;
    meeting_dto_response(&state.pool, meeting_id).await
}

// --- Sessions section: replace the ordered session list ------------------------------

#[derive(Deserialize)]
pub struct SessionBatchIn {
    #[serde(default)]
    pub group_label: String,
    pub name: String,
    #[serde(default)]
    pub duration_minutes: i64,
    /// The actual `role_slot.id` this session hosts, or null. Must belong to the meeting.
    pub role_slot_id: Option<i64>,
}

#[derive(Deserialize)]
pub struct SessionsIn {
    #[serde(default)]
    pub sessions: Vec<SessionBatchIn>,
}

/// `PUT /api/meetings/:id/sessions` — replace all sessions in one batch. `position` is
/// recomputed from array order, so this persists add / edit / delete / reorder together.
pub async fn put_sessions(
    State(state): State<AppState>,
    _user: AuthUser,
    Path(meeting_id): Path<i64>,
    Json(input): Json<SessionsIn>,
) -> AppResult<Json<handlers::MeetingDto>> {
    let mut tx = state.pool.begin().await?;

    let exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM meeting WHERE id = ?")
        .bind(meeting_id)
        .fetch_one(&mut *tx)
        .await?;
    if exists == 0 {
        return Err(AppError::NotFound);
    }

    let valid_slots: HashSet<i64> =
        sqlx::query_scalar::<_, i64>("SELECT id FROM role_slot WHERE meeting_id = ?")
            .bind(meeting_id)
            .fetch_all(&mut *tx)
            .await?
            .into_iter()
            .collect();

    sqlx::query("DELETE FROM session WHERE meeting_id = ?")
        .bind(meeting_id)
        .execute(&mut *tx)
        .await?;

    for (idx, s) in input.sessions.iter().enumerate() {
        if s.name.trim().is_empty() {
            return Err(AppError::BadRequest("each session needs a name".into()));
        }
        if let Some(slot_id) = s.role_slot_id {
            if !valid_slots.contains(&slot_id) {
                return Err(AppError::BadRequest(
                    "session references an unknown role slot".into(),
                ));
            }
        }
        sqlx::query(
            "INSERT INTO session(meeting_id, position, group_label, name, duration_minutes, \
             role_slot_id) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(meeting_id)
        .bind(idx as i64)
        .bind(s.group_label.trim())
        .bind(s.name.trim())
        .bind(s.duration_minutes)
        .bind(s.role_slot_id)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    meeting_dto_response(&state.pool, meeting_id).await
}

// --- Publish toggle: the meeting's lifecycle status ----------------------------------

#[derive(Deserialize)]
pub struct StatusIn {
    pub status: String,
}

/// `PUT /api/meetings/:id/status` — flip between `draft` and `published`.
pub async fn update_status(
    State(state): State<AppState>,
    _user: AuthUser,
    Path(meeting_id): Path<i64>,
    Json(input): Json<StatusIn>,
) -> AppResult<Json<handlers::MeetingDto>> {
    let status = match input.status.as_str() {
        "published" => "published",
        "draft" => "draft",
        _ => {
            return Err(AppError::BadRequest(
                "status must be draft or published".into(),
            ))
        }
    };

    let affected = sqlx::query("UPDATE meeting SET status = ? WHERE id = ?")
        .bind(status)
        .bind(meeting_id)
        .execute(&state.pool)
        .await?
        .rows_affected();
    if affected == 0 {
        return Err(AppError::NotFound);
    }

    meeting_dto_response(&state.pool, meeting_id).await
}

// ---------------------------------------------------------------------------
// Roles catalog
// ---------------------------------------------------------------------------

#[derive(FromRow, Serialize)]
pub struct RoleDto {
    pub id: i64,
    pub name: String,
}

pub async fn list_roles(
    State(state): State<AppState>,
    _user: AuthUser,
) -> AppResult<Json<Vec<RoleDto>>> {
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
    _user: AuthUser,
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
}

#[derive(Serialize)]
pub struct UserRowDto {
    pub id: i64,
    pub display_name: String,
}

pub async fn list_users(
    State(state): State<AppState>,
    _user: AuthUser,
) -> AppResult<Json<Vec<UserRowDto>>> {
    let rows =
        sqlx::query_as::<_, UserRow>("SELECT u.id, u.display_name FROM user u ORDER BY u.id")
            .fetch_all(&state.pool)
            .await?;

    Ok(Json(
        rows.into_iter()
            .map(|r| UserRowDto {
                id: r.id,
                display_name: r.display_name,
            })
            .collect(),
    ))
}

#[derive(Deserialize)]
pub struct NewUserIn {
    pub display_name: String,
}

/// Create a user with only a display name and no auth identity. Such a user can be
/// assigned to roles but cannot log in until an identity (e.g. WeChat) is linked, by
/// design (identity is separate from the user record).
pub async fn create_user(
    State(state): State<AppState>,
    _user: AuthUser,
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
    }))
}
