// Web admin surface: server-served HTML pages plus the admin-scoped JSON APIs
// (meeting list/upsert, roles catalog, user management) served on the shared
// `/api/*` paths.
//
// The pages require an authenticated session and redirect to `/login` when absent;
// management JSON APIs use the same `AuthUser` guard.

use axum::{
    extract::{Path, Query, State},
    http::{header, StatusCode},
    response::{Html, IntoResponse, Redirect, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, MySqlConnection, QueryBuilder};
use std::collections::{HashMap, HashSet};

use crate::auth::{AuthUser, MaybeAuthUser};
use crate::error::{AppError, AppResult};
use crate::meetings;
use crate::models::MeetingResponse;
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
    spa_index(State(s)).await
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
// SPA: serve the standalone frontend from the configured spa_dir.
// All navigation paths (deep links, refreshes) serve index.html.
// Asset paths (*.js, *.css, sw.js, manifest.json, …) are served directly.
// ---------------------------------------------------------------------------

pub async fn spa_index(State(s): State<AppState>) -> Response {
    let path = std::path::Path::new(&s.config.spa_dir).join("index.html");
    match tokio::fs::read_to_string(&path).await {
        Ok(content) => Html(content).into_response(),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn read_spa_asset(state: &AppState, path: &str) -> Response {
    if path.contains("..") || path.starts_with('/') {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let full = std::path::Path::new(&state.config.spa_dir).join(path);
    let ext = full.extension().and_then(|e| e.to_str()).unwrap_or("");
    match tokio::fs::read(&full).await {
        Ok(bytes) => {
            let content_type = match ext {
                "html" => "text/html; charset=utf-8",
                "js" | "mjs" => "application/javascript; charset=utf-8",
                "css" => "text/css; charset=utf-8",
                "json" | "webmanifest" => "application/manifest+json; charset=utf-8",
                "png" => "image/png",
                "jpg" | "jpeg" => "image/jpeg",
                "svg" => "image/svg+xml",
                "webp" => "image/webp",
                "ico" => "image/x-icon",
                _ => "application/octet-stream",
            };
            ([(header::CONTENT_TYPE, content_type)], bytes).into_response()
        }
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

pub async fn spa_service_worker(State(s): State<AppState>) -> Response {
    read_spa_asset(&s, "sw.js").await
}

pub async fn spa_manifest(State(s): State<AppState>) -> Response {
    read_spa_asset(&s, "manifest.webmanifest").await
}

pub async fn spa_asset(State(s): State<AppState>, Path(path): Path<String>) -> Response {
    // Reject path traversal.
    if path.contains("..") || path.starts_with('/') {
        return StatusCode::BAD_REQUEST.into_response();
    }

    let full = std::path::Path::new(&s.config.spa_dir).join(&path);
    let ext = full.extension().and_then(|e| e.to_str()).unwrap_or("");

    // For any path without a file extension (SPA navigation deep-link), serve index.html.
    if ext.is_empty() {
        return spa_index(State(s)).await;
    }

    read_spa_asset(&s, &path).await
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
    pub meeting_manager: Option<i64>,
}

const SUMMARY_COLS: &str = "m.id, m.number, m.title, m.theme, m.date, m.start_time, m.end_time, \
    COALESCE(v.name, '') AS venue, m.status, m.meeting_manager";
const SUMMARY_FROM: &str = "meeting m \
    LEFT JOIN venue v ON v.id = m.venue_id";

fn default_voting_group_for_role(name: &str) -> Option<&'static str> {
    match name.trim().to_ascii_lowercase().as_str() {
        "saa" | "ah-counter" | "timer" | "grammarian" | "photographer" => Some("Best meeting role"),
        "individual evaluator"
        | "table topic evaluator"
        | "table topics evaluator"
        | "table topic evaulator"
        | "table topics evaulator" => Some("Best evaluator"),
        "prepared speech" => Some("Best speaker"),
        "table topics speaker" => Some("Best table topic speaker"),
        _ => None,
    }
}

/// `scope`: `open` (today onward, default), `archived` (past), or `all`.
pub async fn list_meetings(
    State(state): State<AppState>,
    _user: AuthUser,
    Query(q): Query<ListQuery>,
) -> AppResult<Json<Vec<MeetingSummary>>> {
    let today = chrono::Local::now().date_naive().to_string();
    let scope = q.scope.as_deref().unwrap_or("open");

    let rows = match scope {
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
/// overwrites structure. Role slots matched by `role_slot_id` keep their `taker_id`,
/// so saving/publishing never clobbers bookings.
pub async fn upsert_meeting(
    State(state): State<AppState>,
    _user: AuthUser,
    Json(input): Json<MeetingIn>,
) -> AppResult<Json<MeetingResponse>> {
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
    let venue_id = resolve_venue_id(&mut tx, &input.venue).await?;

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
                let voting_group = default_voting_group_for_role(name).unwrap_or("");
                sqlx::query(
                    "INSERT IGNORE INTO `role`(name, is_bookable, voting_group) VALUES (?, 1, ?)",
                )
                .bind(name)
                .bind(voting_group)
                .execute(&mut *tx)
                .await?;
                sqlx::query_scalar::<_, i64>("SELECT id FROM `role` WHERE name = ?")
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
            sqlx::query(
                 "INSERT INTO meeting(number, title, theme, keyword, date, start_time, end_time, venue_id, \
                status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
            .execute(&mut *tx)
            .await?
            .last_insert_id() as i64
        }
    };

    if input.is_template {
        sqlx::query("INSERT IGNORE INTO template(meeting_id) VALUES (?)")
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
    sqlx::query("DELETE FROM `session` WHERE meeting_id = ?")
        .bind(meeting_id)
        .execute(&mut *tx)
        .await?;

    // Upsert slots; build index -> actual id map and the keep set. The posted array
    // order is the intended display order, so persist each slot's index as `position`.
    let mut index_to_id: Vec<i64> = Vec::with_capacity(input.role_slots.len());
    let mut keep: HashSet<i64> = HashSet::new();
    for (index, (slot, role_id)) in input
        .role_slots
        .iter()
        .zip(slot_role_ids.iter())
        .enumerate()
    {
        let position = index as i64;
        let label = slot
            .label
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty());
        let id = match slot.role_slot_id {
            Some(id) if existing_set.contains(&id) => {
                sqlx::query(
                    "UPDATE role_slot SET role_id = ?, label = ?, is_optional = ?, position = ? \
                     WHERE id = ?",
                )
                .bind(role_id)
                .bind(label)
                .bind(slot.is_optional as i64)
                .bind(position)
                .bind(id)
                .execute(&mut *tx)
                .await?;
                id
            }
            _ => sqlx::query(
                "INSERT INTO role_slot(meeting_id, role_id, label, is_optional, position) \
                 VALUES (?, ?, ?, ?, ?)",
            )
            .bind(meeting_id)
            .bind(role_id)
            .bind(label)
            .bind(slot.is_optional as i64)
            .bind(position)
            .execute(&mut *tx)
            .await?
            .last_insert_id() as i64,
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

    // Re-insert sessions, resolving role_slot_index to actual slot ids. Batched into a
    // single multi-row INSERT so a whole agenda is one round-trip, not one per session.
    if !input.sessions.is_empty() {
        let mut resolved: Vec<(&SessionIn, Option<i64>)> = Vec::with_capacity(input.sessions.len());
        for s in &input.sessions {
            let role_slot_id = match s.role_slot_index {
                Some(i) => Some(*index_to_id.get(i).ok_or_else(|| {
                    AppError::BadRequest("session references an unknown role slot".into())
                })?),
                None => None,
            };
            resolved.push((s, role_slot_id));
        }
        let mut qb = QueryBuilder::new(
            "INSERT INTO `session`(meeting_id, position, group_label, name, duration_minutes, \
             role_slot_id) ",
        );
        qb.push_values(resolved, |mut b, (s, role_slot_id)| {
            b.push_bind(meeting_id)
                .push_bind(s.position)
                .push_bind(s.group_label.trim())
                .push_bind(s.name.trim())
                .push_bind(s.duration_minutes)
                .push_bind(role_slot_id);
        });
        qb.build().execute(&mut *tx).await?;
    }

    tx.commit().await?;

    meetings::meeting_response_by_id(&state.pool, meeting_id)
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

/// Return the meeting response after a section save (shared tail of every handler below).
async fn meeting_dto_response(
    pool: &sqlx::MySqlPool,
    meeting_id: i64,
) -> AppResult<Json<MeetingResponse>> {
    meetings::meeting_response_by_id(pool, meeting_id)
        .await?
        .map(Json)
        .ok_or(AppError::NotFound)
}

async fn resolve_venue_id(conn: &mut MySqlConnection, venue: &str) -> AppResult<Option<i64>> {
    let venue = venue.trim();
    if venue.is_empty() {
        return Ok(None);
    }
    sqlx::query("INSERT IGNORE INTO venue(name) VALUES (?)")
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

// ---------------------------------------------------------------------------
// Venues catalog
// ---------------------------------------------------------------------------

#[derive(FromRow, Serialize)]
pub struct VenueDto {
    pub id: i64,
    pub name: String,
}

pub async fn list_venues(
    State(state): State<AppState>,
    _user: AuthUser,
) -> AppResult<Json<Vec<VenueDto>>> {
    let rows = sqlx::query_as::<_, VenueDto>("SELECT id, name FROM venue ORDER BY name")
        .fetch_all(&state.pool)
        .await?;
    Ok(Json(rows))
}

// ---------------------------------------------------------------------------
// Templates catalog
// ---------------------------------------------------------------------------

#[derive(FromRow, Serialize)]
pub struct TemplateDto {
    pub id: i64,
    pub number: i64,
    pub title: String,
}

/// `GET /api/templates` — meetings marked as reusable templates.
pub async fn list_templates(
    State(state): State<AppState>,
    _user: AuthUser,
) -> AppResult<Json<Vec<TemplateDto>>> {
    let rows = sqlx::query_as::<_, TemplateDto>(
        "SELECT m.id, m.number, m.title \
         FROM template t JOIN meeting m ON m.id = t.meeting_id \
         ORDER BY m.number DESC",
    )
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(rows))
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
) -> AppResult<Json<MeetingResponse>> {
    if input.title.trim().is_empty() {
        return Err(AppError::BadRequest("title is required".into()));
    }
    if input.date.trim().is_empty() {
        return Err(AppError::BadRequest("date is required".into()));
    }

    let mut tx = state.pool.begin().await?;
    let venue_id = resolve_venue_id(&mut tx, &input.venue).await?;

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

// --- Roles section: reconcile the meeting's role_slot list (+ assignees) ---------------

#[derive(Deserialize)]
pub struct SlotBatchIn {
    /// Present for an existing slot (preserves its assignment); absent for a new one.
    pub role_slot_id: Option<i64>,
    pub role_id: Option<i64>,
    pub role_name: Option<String>,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub voting_group: Option<String>,
    #[serde(default)]
    pub is_optional: bool,
    /// Assigned taker; `null` clears the assignment. Reconciled into `role_assignment`.
    #[serde(default)]
    pub taker_id: Option<i64>,
}

#[derive(Deserialize)]
pub struct SlotsIn {
    #[serde(default)]
    pub slots: Vec<SlotBatchIn>,
}

/// `PUT /api/meetings/:id/slots` — replace the whole role-slot list in one batch.
/// Existing slots are matched by `role_slot_id` (so bookings survive), new slots are
/// inserted, removed slots deleted, and each slot's `taker_id` is reconciled into
/// `role_assignment`.
pub async fn put_slots(
    State(state): State<AppState>,
    _user: AuthUser,
    Path(meeting_id): Path<i64>,
    Json(input): Json<SlotsIn>,
) -> AppResult<Json<MeetingResponse>> {
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
    let mut role_group_updates: HashMap<i64, String> = HashMap::new();
    for slot in &input.slots {
        let role_id = match slot.role_id {
            Some(id) => {
                let is_bookable: i64 = sqlx::query_scalar(
                    "SELECT COUNT(*) FROM `role` WHERE id = ? AND is_bookable = 1",
                )
                .bind(id)
                .fetch_one(&mut *tx)
                .await?;
                if is_bookable == 0 {
                    return Err(AppError::BadRequest(
                        "the Roles section only accepts bookable roles".into(),
                    ));
                }
                id
            }
            None => {
                let name = slot
                    .role_name
                    .as_deref()
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .ok_or_else(|| AppError::BadRequest("each role slot needs a role".into()))?;
                let voting_group = default_voting_group_for_role(name).unwrap_or("");
                sqlx::query(
                    "INSERT IGNORE INTO `role`(name, is_bookable, voting_group) VALUES (?, 1, ?)",
                )
                .bind(name)
                .bind(voting_group)
                .execute(&mut *tx)
                .await?;
                sqlx::query_scalar::<_, i64>("SELECT id FROM `role` WHERE name = ?")
                    .bind(name)
                    .fetch_one(&mut *tx)
                    .await?
            }
        };
        let voting_group = slot
            .voting_group
            .as_deref()
            .map(str::trim)
            .unwrap_or("")
            .to_string();
        if let Some(prev) = role_group_updates.get(&role_id) {
            if prev != &voting_group {
                return Err(AppError::BadRequest(
                    "the same role cannot have conflicting voting groups in one save".into(),
                ));
            }
        } else {
            role_group_updates.insert(role_id, voting_group);
        }
        role_ids.push(role_id);
    }

    for (role_id, voting_group) in role_group_updates {
        sqlx::query("UPDATE `role` SET voting_group = ? WHERE id = ?")
            .bind(voting_group)
            .bind(role_id)
            .execute(&mut *tx)
            .await?;
    }

    let existing_slots: Vec<i64> = sqlx::query_scalar(
        "SELECT rs.id FROM role_slot rs \
         JOIN `role` r ON r.id = rs.role_id \
         WHERE rs.meeting_id = ? AND r.is_bookable = 1",
    )
    .bind(meeting_id)
    .fetch_all(&mut *tx)
    .await?;
    let existing_set: HashSet<i64> = existing_slots.iter().copied().collect();

    let mut keep: HashSet<i64> = HashSet::new();
    for (index, (slot, role_id)) in input.slots.iter().zip(role_ids.iter()).enumerate() {
        let position = index as i64;
        let label = slot
            .label
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty());
        let slot_id = match slot.role_slot_id {
            Some(id) if existing_set.contains(&id) => {
                sqlx::query(
                    "UPDATE role_slot SET role_id = ?, label = ?, is_optional = ?, position = ? \
                     WHERE id = ?",
                )
                .bind(role_id)
                .bind(label)
                .bind(slot.is_optional as i64)
                .bind(position)
                .bind(id)
                .execute(&mut *tx)
                .await?;
                id
            }
            _ => sqlx::query(
                "INSERT INTO role_slot(meeting_id, role_id, label, is_optional, position) \
                 VALUES (?, ?, ?, ?, ?)",
            )
            .bind(meeting_id)
            .bind(role_id)
            .bind(label)
            .bind(slot.is_optional as i64)
            .bind(position)
            .execute(&mut *tx)
            .await?
            .last_insert_id() as i64,
        };
        keep.insert(slot_id);

        // Reconcile the taker into role_assignment.
        match slot.taker_id {
            Some(taker) => {
                let user_exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM user WHERE id = ?")
                    .bind(taker)
                    .fetch_one(&mut *tx)
                    .await?;
                if user_exists == 0 {
                    return Err(AppError::BadRequest("taker does not exist".into()));
                }
                sqlx::query(
                    "INSERT INTO role_assignment(role_slot_id, taker_id) VALUES (?, ?) \
                     ON DUPLICATE KEY UPDATE taker_id = VALUES(taker_id)",
                )
                .bind(slot_id)
                .bind(taker)
                .execute(&mut *tx)
                .await?;
                // A different speaker invalidates any speech details already on the slot.
                sqlx::query("DELETE FROM speech WHERE role_slot_id = ? AND speaker_id <> ?")
                    .bind(slot_id)
                    .bind(taker)
                    .execute(&mut *tx)
                    .await?;
            }
            None => {
                // Clear any assignment; the row structure stays clean.
                sqlx::query("UPDATE role_assignment SET taker_id = NULL WHERE role_slot_id = ?")
                    .bind(slot_id)
                    .execute(&mut *tx)
                    .await?;
                // No speaker means no speech.
                sqlx::query("DELETE FROM speech WHERE role_slot_id = ?")
                    .bind(slot_id)
                    .execute(&mut *tx)
                    .await?;
            }
        }
    }

    // Remove slots dropped in the editor: detach sessions, drop assignment, delete slot.
    for old in existing_slots {
        if !keep.contains(&old) {
            sqlx::query("UPDATE `session` SET role_slot_id = NULL WHERE role_slot_id = ?")
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
) -> AppResult<Json<MeetingResponse>> {
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

    sqlx::query("DELETE FROM `session` WHERE meeting_id = ?")
        .bind(meeting_id)
        .execute(&mut *tx)
        .await?;

    for s in &input.sessions {
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
    }

    // One multi-row INSERT for the whole agenda instead of a round-trip per session.
    if !input.sessions.is_empty() {
        let mut qb = QueryBuilder::new(
            "INSERT INTO `session`(meeting_id, position, group_label, name, duration_minutes, \
             role_slot_id) ",
        );
        qb.push_values(input.sessions.iter().enumerate(), |mut b, (idx, s)| {
            b.push_bind(meeting_id)
                .push_bind(idx as i64)
                .push_bind(s.group_label.trim())
                .push_bind(s.name.trim())
                .push_bind(s.duration_minutes)
                .push_bind(s.role_slot_id);
        });
        qb.build().execute(&mut *tx).await?;
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
) -> AppResult<Json<MeetingResponse>> {
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
    pub is_bookable: bool,
    pub voting_group: String,
}

pub async fn list_roles(
    State(state): State<AppState>,
    _user: AuthUser,
) -> AppResult<Json<Vec<RoleDto>>> {
    let rows = sqlx::query_as::<_, RoleDto>(
        "SELECT id, name, is_bookable, voting_group FROM `role` ORDER BY name",
    )
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
    let voting_group = default_voting_group_for_role(name).unwrap_or("");
    sqlx::query("INSERT IGNORE INTO `role`(name, is_bookable, voting_group) VALUES (?, 1, ?)")
        .bind(name)
        .bind(voting_group)
        .execute(&state.pool)
        .await?;
    let row = sqlx::query_as::<_, RoleDto>(
        "SELECT id, name, is_bookable, voting_group FROM `role` WHERE name = ?",
    )
    .bind(name)
    .fetch_one(&state.pool)
    .await?;
    Ok(Json(row))
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

#[derive(FromRow, Serialize)]
pub struct UserRowDto {
    pub id: i64,
    pub display_name: String,
}

pub async fn list_users(
    State(state): State<AppState>,
    _user: AuthUser,
) -> AppResult<Json<Vec<UserRowDto>>> {
    let rows =
        sqlx::query_as::<_, UserRowDto>("SELECT u.id, u.display_name FROM user u ORDER BY u.id")
            .fetch_all(&state.pool)
            .await?;
    Ok(Json(rows))
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
    let id = sqlx::query("INSERT INTO user(display_name) VALUES (?)")
        .bind(name)
        .execute(&state.pool)
        .await?
        .last_insert_id() as i64;
    Ok(Json(UserRowDto {
        id,
        display_name: name.to_string(),
    }))
}

// ---------------------------------------------------------------------------
// Meeting attendees
// ---------------------------------------------------------------------------

/// Checked-in users available for meeting-specific assignments.
pub async fn list_attendees(
    State(state): State<AppState>,
    _user: AuthUser,
    Path(meeting_id): Path<i64>,
) -> AppResult<Json<Vec<UserRowDto>>> {
    let exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM meeting WHERE id = ?")
        .bind(meeting_id)
        .fetch_one(&state.pool)
        .await?;
    if exists == 0 {
        return Err(AppError::NotFound);
    }

    let attendees = sqlx::query_as::<_, UserRowDto>(
        "SELECT u.id, u.display_name \
         FROM attendance a \
         JOIN user u ON u.id = a.user_id \
         WHERE a.meeting_id = ? \
         ORDER BY a.checked_in_at, a.id",
    )
    .bind(meeting_id)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(attendees))
}

/// Create an identity-less walk-in user and check them into this meeting.
pub async fn create_walk_in(
    State(state): State<AppState>,
    _user: AuthUser,
    Path(meeting_id): Path<i64>,
    Json(input): Json<NewUserIn>,
) -> AppResult<Json<UserRowDto>> {
    let name = input.display_name.trim();
    if name.is_empty() {
        return Err(AppError::BadRequest("display_name is required".into()));
    }

    let mut tx = state.pool.begin().await?;
    let exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM meeting WHERE id = ?")
        .bind(meeting_id)
        .fetch_one(&mut *tx)
        .await?;
    if exists == 0 {
        return Err(AppError::NotFound);
    }

    let user_id = sqlx::query("INSERT INTO user(display_name) VALUES (?)")
        .bind(name)
        .execute(&mut *tx)
        .await?
        .last_insert_id() as i64;
    sqlx::query(
        "INSERT INTO attendance(meeting_id, user_id, checked_in_at, source) \
         VALUES (?, ?, UTC_TIMESTAMP(), 'admin')",
    )
    .bind(meeting_id)
    .bind(user_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    Ok(Json(UserRowDto {
        id: user_id,
        display_name: name.to_string(),
    }))
}

// ---------------------------------------------------------------------------
// Table Topics section: checked-in users assigned to non-bookable role slots
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct TableTopicParticipantIn {
    #[serde(default)]
    pub role_slot_id: Option<i64>,
    pub user_id: i64,
}

#[derive(Deserialize)]
pub struct TableTopicsIn {
    /// Ordered list of checked-in users and their stable slots, when already saved.
    #[serde(default)]
    pub participants: Vec<TableTopicParticipantIn>,
}

const TABLE_TOPICS_SPEAKER_ROLE: &str = "Table Topics Speaker";

/// `PUT /api/meetings/:id/table-topics`
/// Synchronizes non-bookable Table Topics slots while preserving existing slot IDs.
/// Every participant must be checked in and is stored as a role assignment.
pub async fn put_table_topics(
    State(state): State<AppState>,
    _user: AuthUser,
    Path(meeting_id): Path<i64>,
    Json(input): Json<TableTopicsIn>,
) -> AppResult<Json<MeetingResponse>> {
    let mut tx = state.pool.begin().await?;

    let exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM meeting WHERE id = ?")
        .bind(meeting_id)
        .fetch_one(&mut *tx)
        .await?;
    if exists == 0 {
        return Err(AppError::NotFound);
    }

    // Ensure the non-bookable role exists (auto-create once).
    sqlx::query(
        "INSERT IGNORE INTO `role`(name, is_bookable, voting_group) VALUES (?, 0, 'Best table topic speaker')",
    )
        .bind(TABLE_TOPICS_SPEAKER_ROLE)
        .execute(&mut *tx)
        .await?;
    let role_id: i64 = sqlx::query_scalar("SELECT id FROM `role` WHERE name = ?")
        .bind(TABLE_TOPICS_SPEAKER_ROLE)
        .fetch_one(&mut *tx)
        .await?;

    let mut seen_users: HashSet<i64> = HashSet::new();
    let mut seen_slots: HashSet<i64> = HashSet::new();
    for participant in &input.participants {
        if !seen_users.insert(participant.user_id) {
            return Err(AppError::BadRequest(
                "a Table Topics participant can only be added once".into(),
            ));
        }
        let checked_in: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM attendance WHERE meeting_id = ? AND user_id = ?",
        )
        .bind(meeting_id)
        .bind(participant.user_id)
        .fetch_one(&mut *tx)
        .await?;
        if checked_in == 0 {
            return Err(AppError::BadRequest(
                "all Table Topics participants must be checked in".into(),
            ));
        }

        if let Some(slot_id) = participant.role_slot_id {
            if !seen_slots.insert(slot_id) {
                return Err(AppError::BadRequest(
                    "a Table Topics role slot can only be used once".into(),
                ));
            }
            let valid_slot: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM role_slot rs \
                 JOIN `role` r ON r.id = rs.role_id \
                 WHERE rs.id = ? AND rs.meeting_id = ? AND r.is_bookable = 0",
            )
            .bind(slot_id)
            .bind(meeting_id)
            .fetch_one(&mut *tx)
            .await?;
            if valid_slot == 0 {
                return Err(AppError::BadRequest(
                    "Table Topics role slot does not belong to this meeting".into(),
                ));
            }
        }
    }

    // Track current slots so removed participants can be deleted after retained slots
    // are updated. Votes attached to retained slots therefore keep stable references.
    let old_ids: Vec<i64> = sqlx::query_scalar(
        "SELECT rs.id FROM role_slot rs \
             JOIN `role` r ON r.id = rs.role_id \
             WHERE rs.meeting_id = ? AND r.is_bookable = 0",
    )
    .bind(meeting_id)
    .fetch_all(&mut *tx)
    .await?;

    // Get current max position for bookable slots so TT slots follow them.
    let base_position: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(rs.position), -1) FROM role_slot rs \
         JOIN `role` r ON r.id = rs.role_id \
         WHERE rs.meeting_id = ? AND r.is_bookable = 1",
    )
    .bind(meeting_id)
    .fetch_one(&mut *tx)
    .await?;

    let mut keep_ids: HashSet<i64> = HashSet::new();
    for (idx, participant) in input.participants.iter().enumerate() {
        let position = base_position + 1 + idx as i64;
        let slot_id = if let Some(slot_id) = participant.role_slot_id {
            let old_taker: Option<i64> = sqlx::query_scalar(
                "SELECT ra.taker_id FROM role_slot rs \
                 LEFT JOIN role_assignment ra ON ra.role_slot_id = rs.id \
                 WHERE rs.id = ?",
            )
            .bind(slot_id)
            .fetch_one(&mut *tx)
            .await?;
            if old_taker != Some(participant.user_id) {
                // Never carry votes over when an existing slot changes candidate.
                sqlx::query("DELETE FROM meeting_vote WHERE meeting_id = ? AND role_slot_id = ?")
                    .bind(meeting_id)
                    .bind(slot_id)
                    .execute(&mut *tx)
                    .await?;
            }
            sqlx::query(
                "UPDATE role_slot SET role_id = ?, label = NULL, is_optional = 0, position = ? \
                 WHERE id = ?",
            )
            .bind(role_id)
            .bind(position)
            .bind(slot_id)
            .execute(&mut *tx)
            .await?;
            slot_id
        } else {
            sqlx::query(
                "INSERT INTO role_slot(meeting_id, role_id, label, is_optional, position) \
                 VALUES (?, ?, NULL, 0, ?)",
            )
            .bind(meeting_id)
            .bind(role_id)
            .bind(position)
            .execute(&mut *tx)
            .await?
            .last_insert_id() as i64
        };

        sqlx::query(
            "INSERT INTO role_assignment(role_slot_id, taker_id) VALUES (?, ?) \
             ON DUPLICATE KEY UPDATE taker_id = VALUES(taker_id)",
        )
        .bind(slot_id)
        .bind(participant.user_id)
        .execute(&mut *tx)
        .await?;
        keep_ids.insert(slot_id);
    }

    for old_id in old_ids {
        if keep_ids.contains(&old_id) {
            continue;
        }
        sqlx::query("UPDATE `session` SET role_slot_id = NULL WHERE role_slot_id = ?")
            .bind(old_id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("DELETE FROM role_slot WHERE id = ?")
            .bind(old_id)
            .execute(&mut *tx)
            .await?;
    }

    tx.commit().await?;
    meeting_dto_response(&state.pool, meeting_id).await
}
