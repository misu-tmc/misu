use axum::{
    extract::{Path, State},
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::FromRow;
use std::collections::{BTreeMap, HashMap, HashSet};

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
// Check-in (presence only; see design/functionalities/check_in.md)
// ---------------------------------------------------------------------------

/// `GET /api/meetings/:id/checkin` — whether the current user has checked in.
pub async fn checkin_status(
    State(state): State<AppState>,
    user: AuthUser,
    Path(meeting_id): Path<i64>,
) -> AppResult<Json<serde_json::Value>> {
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM attendance WHERE meeting_id = ? AND user_id = ?",
    )
    .bind(meeting_id)
    .bind(user.id)
    .fetch_one(&state.pool)
    .await?;
    Ok(Json(json!({ "checked_in": count > 0 })))
}

/// `POST /api/meetings/:id/checkin` — record the current user's attendance (presence only).
/// Idempotent: re-checking in just refreshes the timestamp. No role is involved.
pub async fn checkin(
    State(state): State<AppState>,
    user: AuthUser,
    Path(meeting_id): Path<i64>,
) -> AppResult<Json<serde_json::Value>> {
    let exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM meeting WHERE id = ?")
        .bind(meeting_id)
        .fetch_one(&state.pool)
        .await?;
    if exists == 0 {
        return Err(AppError::NotFound);
    }

    sqlx::query(
        "INSERT INTO attendance(meeting_id, user_id, checked_in_at, source) \
         VALUES (?, ?, UTC_TIMESTAMP(), 'self') \
         ON DUPLICATE KEY UPDATE checked_in_at = VALUES(checked_in_at)",
    )
    .bind(meeting_id)
    .bind(user.id)
    .execute(&state.pool)
    .await?;

    Ok(Json(json!({ "checked_in": true })))
}

// ---------------------------------------------------------------------------
// Voting
// ---------------------------------------------------------------------------

#[derive(FromRow)]
struct VoteOptionRow {
    role_slot_id: i64,
    voting_group: String,
    role_name: String,
    candidate_name: String,
}

#[derive(FromRow)]
struct VotePickRow {
    voting_group: String,
    role_slot_id: i64,
}

#[derive(Serialize)]
pub struct VoteOption {
    pub role_slot_id: i64,
    pub role_name: String,
    pub candidate_name: String,
}

#[derive(Serialize)]
pub struct VoteGroup {
    pub voting_group: String,
    pub options: Vec<VoteOption>,
}

#[derive(Serialize)]
pub struct VoteStateResp {
    pub meeting_id: i64,
    pub groups: Vec<VoteGroup>,
    pub selections: HashMap<String, i64>,
}

#[derive(Serialize)]
pub struct VoteResultOption {
    pub role_slot_id: i64,
    pub role_name: String,
    pub candidate_name: String,
    pub votes: i64,
}

#[derive(Serialize)]
pub struct VoteResultGroup {
    pub voting_group: String,
    pub total_votes: i64,
    pub options: Vec<VoteResultOption>,
}

#[derive(Serialize)]
pub struct VoteResultResp {
    pub meeting_id: i64,
    pub groups: Vec<VoteResultGroup>,
}

#[derive(Deserialize)]
pub struct VoteIn {
    #[serde(default)]
    pub ballots: Vec<VoteBallotIn>,
}

#[derive(Deserialize)]
pub struct VoteBallotIn {
    pub voting_group: String,
    pub role_slot_id: i64,
}

/// `GET /api/meetings/:id/vote` — voteable options and this user's current selections.
pub async fn vote_state(
    State(state): State<AppState>,
    user: AuthUser,
    Path(meeting_id): Path<i64>,
) -> AppResult<Json<VoteStateResp>> {
    let exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM meeting WHERE id = ?")
        .bind(meeting_id)
        .fetch_one(&state.pool)
        .await?;
    if exists == 0 {
        return Err(AppError::NotFound);
    }

    let rows = sqlx::query_as::<_, VoteOptionRow>(
        "SELECT rs.id AS role_slot_id, r.voting_group, r.name AS role_name, \
            COALESCE(NULLIF(u.display_name, ''), NULLIF(rs.label, ''), r.name) AS candidate_name \
         FROM role_slot rs \
         JOIN `role` r ON r.id = rs.role_id \
         LEFT JOIN role_assignment ra ON ra.role_slot_id = rs.id \
         LEFT JOIN user u ON u.id = ra.taker_id \
         WHERE rs.meeting_id = ? AND COALESCE(r.voting_group, '') <> '' \
                     AND ra.taker_id IS NOT NULL \
         ORDER BY r.voting_group, rs.position, rs.id",
    )
    .bind(meeting_id)
    .fetch_all(&state.pool)
    .await?;

    let mut by_group: BTreeMap<String, Vec<VoteOption>> = BTreeMap::new();
    for row in rows {
        by_group
            .entry(row.voting_group)
            .or_default()
            .push(VoteOption {
                role_slot_id: row.role_slot_id,
                role_name: row.role_name,
                candidate_name: row.candidate_name,
            });
    }
    let groups = by_group
        .into_iter()
        .map(|(voting_group, options)| VoteGroup {
            voting_group,
            options,
        })
        .collect();

    let picks = sqlx::query_as::<_, VotePickRow>(
        "SELECT voting_group, role_slot_id FROM meeting_vote WHERE meeting_id = ? AND voter_id = ?",
    )
    .bind(meeting_id)
    .bind(user.id)
    .fetch_all(&state.pool)
    .await?;
    let selections = picks
        .into_iter()
        .map(|p| (p.voting_group, p.role_slot_id))
        .collect();

    Ok(Json(VoteStateResp {
        meeting_id,
        groups,
        selections,
    }))
}

#[derive(FromRow)]
struct VoteResultRow {
    voting_group: String,
    role_slot_id: i64,
    role_name: String,
    candidate_name: String,
    votes: i64,
}

/// `GET /api/meetings/:id/vote/result` — aggregated vote counts by voting group.
pub async fn vote_result(
    State(state): State<AppState>,
    _user: AuthUser,
    Path(meeting_id): Path<i64>,
) -> AppResult<Json<VoteResultResp>> {
    let exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM meeting WHERE id = ?")
        .bind(meeting_id)
        .fetch_one(&state.pool)
        .await?;
    if exists == 0 {
        return Err(AppError::NotFound);
    }

    let rows = sqlx::query_as::<_, VoteResultRow>(
        "SELECT r.voting_group, rs.id AS role_slot_id, r.name AS role_name, \
            COALESCE(NULLIF(u.display_name, ''), NULLIF(rs.label, ''), r.name) AS candidate_name, \
            COUNT(mv.id) AS votes \
         FROM role_slot rs \
         JOIN `role` r ON r.id = rs.role_id \
         JOIN role_assignment ra ON ra.role_slot_id = rs.id \
         LEFT JOIN user u ON u.id = ra.taker_id \
         LEFT JOIN meeting_vote mv ON mv.meeting_id = rs.meeting_id AND mv.role_slot_id = rs.id \
         WHERE rs.meeting_id = ? AND COALESCE(r.voting_group, '') <> '' \
           AND ra.taker_id IS NOT NULL \
         GROUP BY r.voting_group, rs.id, r.name, candidate_name, rs.position \
         ORDER BY r.voting_group, votes DESC, rs.position, rs.id",
    )
    .bind(meeting_id)
    .fetch_all(&state.pool)
    .await?;

    let mut by_group: BTreeMap<String, Vec<VoteResultOption>> = BTreeMap::new();
    for row in rows {
        by_group
            .entry(row.voting_group)
            .or_default()
            .push(VoteResultOption {
                role_slot_id: row.role_slot_id,
                role_name: row.role_name,
                candidate_name: row.candidate_name,
                votes: row.votes,
            });
    }

    let groups = by_group
        .into_iter()
        .map(|(voting_group, options)| {
            let total_votes = options.iter().map(|o| o.votes).sum();
            VoteResultGroup {
                voting_group,
                total_votes,
                options,
            }
        })
        .collect();

    Ok(Json(VoteResultResp { meeting_id, groups }))
}

/// `POST /api/meetings/:id/vote` — upsert this user's votes by group.
/// Concurrent voting is safe via the unique key on (meeting_id, voter_id, voting_group).
pub async fn submit_votes(
    State(state): State<AppState>,
    user: AuthUser,
    Path(meeting_id): Path<i64>,
    Json(input): Json<VoteIn>,
) -> AppResult<Json<serde_json::Value>> {
    let exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM meeting WHERE id = ?")
        .bind(meeting_id)
        .fetch_one(&state.pool)
        .await?;
    if exists == 0 {
        return Err(AppError::NotFound);
    }

    let mut seen_groups: HashSet<String> = HashSet::new();
    for b in &input.ballots {
        let group = b.voting_group.trim();
        if group.is_empty() {
            return Err(AppError::BadRequest("voting_group is required".into()));
        }
        if !seen_groups.insert(group.to_string()) {
            return Err(AppError::BadRequest(
                "duplicate voting_group in ballots".into(),
            ));
        }

        let valid: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) \
             FROM role_slot rs \
             JOIN `role` r ON r.id = rs.role_id \
             LEFT JOIN role_assignment ra ON ra.role_slot_id = rs.id \
             WHERE rs.id = ? AND rs.meeting_id = ? AND r.voting_group = ? \
             AND ra.taker_id IS NOT NULL",
        )
        .bind(b.role_slot_id)
        .bind(meeting_id)
        .bind(group)
        .fetch_one(&state.pool)
        .await?;
        if valid == 0 {
            return Err(AppError::BadRequest(
                "ballot has an invalid candidate for its voting group".into(),
            ));
        }
    }

    let mut tx = state.pool.begin().await?;
    for b in &input.ballots {
        let group = b.voting_group.trim();
        sqlx::query(
            "INSERT INTO meeting_vote(meeting_id, voter_id, voting_group, role_slot_id, created_at, updated_at) \
             VALUES (?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP()) \
             ON DUPLICATE KEY UPDATE role_slot_id = VALUES(role_slot_id), updated_at = VALUES(updated_at)",
        )
        .bind(meeting_id)
        .bind(user.id)
        .bind(group)
        .bind(b.role_slot_id)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;

    Ok(Json(json!({ "ok": true, "saved": input.ballots.len() })))
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
