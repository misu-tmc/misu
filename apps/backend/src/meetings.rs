use std::collections::HashMap;

use sqlx::{FromRow, SqlitePool};

use crate::error::AppResult;
use crate::models::{MeetingResponse, PrepFieldResponse, RoleTakerResponse, SessionResponse};

#[derive(FromRow)]
struct MeetingRow {
    id: i64,
    number: i64,
    title: String,
    theme: String,
    keyword: String,
    date: String,
    start_time: String,
    end_time: String,
    venue: String,
    status: String,
    is_template: bool,
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
struct RoleTakerRow {
    id: i64,
    role_id: i64,
    role_name: String,
    properties: Option<String>,
    label: Option<String>,
    is_optional: i64,
    booker_id: Option<i64>,
    booker_name: Option<String>,
    taker_id: Option<i64>,
    prep_data: String,
    prep_updated_at: Option<String>,
}

/// Derived lifecycle phase for a meeting: `draft`, `open`, `ongoing`, or `archived`.
pub fn meeting_phase(status: &str, date: &str, start_time: &str) -> &'static str {
    if status != "published" {
        return "draft";
    }
    let today = chrono::Local::now().date_naive();
    let meeting_date = match chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d") {
        Ok(date) => date,
        Err(_) => return "open",
    };
    if meeting_date < today {
        return "archived";
    }
    if meeting_date > today {
        return "open";
    }
    match chrono::NaiveTime::parse_from_str(start_time, "%H:%M") {
        Ok(start) if chrono::Local::now().time() >= start => "ongoing",
        _ => "open",
    }
}

fn is_prepared_speech(role_name: &str) -> bool {
    let name = role_name.to_ascii_lowercase();
    name.contains("speaker") || name.contains("prepared speech")
}

/// Non-empty title entered by a prepared-speech taker, if any.
fn prep_title(prep_data: &serde_json::Value) -> Option<&str> {
    prep_data
        .get("title")?
        .as_str()
        .map(str::trim)
        .filter(|title| !title.is_empty())
}

fn parse_prep_fields(properties: Option<&str>) -> Vec<PrepFieldResponse> {
    let Some(raw) = properties.map(str::trim).filter(|s| !s.is_empty()) else {
        return Vec::new();
    };
    serde_json::from_str::<Vec<PrepFieldResponse>>(raw).unwrap_or_default()
}

fn parse_prep_data(raw: &str) -> serde_json::Value {
    serde_json::from_str(raw).unwrap_or_else(|_| serde_json::json!({}))
}

fn role_taker_response(
    row: RoleTakerRow,
    label: String,
    custom_label: Option<String>,
) -> RoleTakerResponse {
    RoleTakerResponse {
        id: row.id,
        role_id: row.role_id,
        role_name: row.role_name,
        label,
        custom_label,
        is_optional: row.is_optional != 0,
        booker_id: row.booker_id,
        booker_name: row.booker_name,
        taker_id: row.taker_id,
        prep_fields: parse_prep_fields(row.properties.as_deref()),
        prep_data: parse_prep_data(&row.prep_data),
        prep_updated_at: row.prep_updated_at,
    }
}

/// Build the role-slot views, deriving a display label: the custom label when set,
/// otherwise the role name with an ordinal suffix when a role appears more than once.
fn role_taker_responses(rows: Vec<RoleTakerRow>) -> Vec<RoleTakerResponse> {
    let mut counts: HashMap<i64, i64> = HashMap::new();
    for row in &rows {
        *counts.entry(row.role_id).or_insert(0) += 1;
    }

    let mut seen: HashMap<i64, i64> = HashMap::new();
    rows.into_iter()
        .map(|row| {
            let ordinal = {
                let next = seen.entry(row.role_id).or_insert(0);
                *next += 1;
                *next
            };
            let derived_label = if counts.get(&row.role_id).copied().unwrap_or(0) > 1 {
                format!("{} {}", row.role_name, ordinal)
            } else {
                row.role_name.clone()
            };
            let custom_label = row
                .label
                .as_deref()
                .map(str::trim)
                .filter(|label| !label.is_empty())
                .map(str::to_string);
            let label = custom_label.clone().unwrap_or(derived_label);
            role_taker_response(row, label, custom_label)
        })
        .collect()
}

fn session_response(row: SessionRow, slot: Option<&RoleTakerResponse>) -> SessionResponse {
    // For a prepared-speech session, show the speech title (when the taker entered one)
    // in place of the generic session name.
    let agenda_name = slot
        .filter(|slot| is_prepared_speech(&slot.role_name))
        .and_then(|slot| prep_title(&slot.prep_data))
        .map(str::to_string)
        .unwrap_or_else(|| row.name.clone());
    SessionResponse {
        id: row.id,
        position: row.position,
        group_label: row.group_label,
        name: row.name,
        agenda_name,
        duration_minutes: row.duration_minutes,
        role_slot_id: row.role_slot_id,
    }
}

fn meeting_response(
    meeting: MeetingRow,
    sessions: Vec<SessionResponse>,
    role_takers: Vec<RoleTakerResponse>,
) -> MeetingResponse {
    let phase = meeting_phase(&meeting.status, &meeting.date, &meeting.start_time).to_string();
    MeetingResponse {
        id: meeting.id,
        number: meeting.number,
        title: meeting.title,
        theme: meeting.theme,
        keyword: meeting.keyword,
        date: meeting.date,
        start_time: meeting.start_time,
        end_time: meeting.end_time,
        venue: meeting.venue,
        status: meeting.status,
        phase,
        is_template: meeting.is_template,
        sessions,
        role_takers,
    }
}

async fn load_meeting(pool: &SqlitePool, meeting: MeetingRow) -> AppResult<MeetingResponse> {
    let session_rows = sqlx::query_as::<_, SessionRow>(
        "SELECT id, position, group_label, name, duration_minutes, role_slot_id \
         FROM session WHERE meeting_id = ? ORDER BY position",
    )
    .bind(meeting.id)
    .fetch_all(pool)
    .await?;

    let role_taker_rows = sqlx::query_as::<_, RoleTakerRow>(
        "SELECT rs.id, rs.role_id, r.name AS role_name, r.properties, rs.label, rs.is_optional, \
            ra.booker_id, booker.display_name AS booker_name, ra.taker_id, \
            COALESCE(ra.prep_data, '{}') AS prep_data, ra.prep_updated_at \
         FROM role_slot rs \
         JOIN role r ON r.id = rs.role_id \
         LEFT JOIN role_assignment ra ON ra.role_slot_id = rs.id \
         LEFT JOIN user booker ON booker.id = ra.booker_id \
         WHERE rs.meeting_id = ? ORDER BY rs.id",
    )
    .bind(meeting.id)
    .fetch_all(pool)
    .await?;

    let role_takers = role_taker_responses(role_taker_rows);
    let slot_by_id: HashMap<i64, &RoleTakerResponse> =
        role_takers.iter().map(|slot| (slot.id, slot)).collect();

    let sessions = session_rows
        .into_iter()
        .map(|row| {
            let slot = row.role_slot_id.and_then(|id| slot_by_id.get(&id).copied());
            session_response(row, slot)
        })
        .collect();
    drop(slot_by_id);

    Ok(meeting_response(meeting, sessions, role_takers))
}

pub async fn upcoming_published(pool: &SqlitePool) -> AppResult<Vec<MeetingResponse>> {
    let today = chrono::Local::now().date_naive().to_string();
    let rows = sqlx::query_as::<_, MeetingRow>(
        "SELECT m.id, m.number, m.title, m.theme, m.keyword, m.date, m.start_time, m.end_time, \
            COALESCE(v.name, '') AS venue, m.status, \
            CASE WHEN t.meeting_id IS NULL THEN 0 ELSE 1 END AS is_template \
         FROM meeting m \
         LEFT JOIN venue v ON v.id = m.venue_id \
         LEFT JOIN template t ON t.meeting_id = m.id \
         WHERE m.status = 'published' AND m.date >= ? \
         ORDER BY m.date ASC, m.number ASC",
    )
    .bind(&today)
    .fetch_all(pool)
    .await?;

    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        out.push(load_meeting(pool, row).await?);
    }
    Ok(out)
}

pub async fn meeting_response_by_id(
    pool: &SqlitePool,
    meeting_id: i64,
) -> AppResult<Option<MeetingResponse>> {
    let meeting = sqlx::query_as::<_, MeetingRow>(
        "SELECT m.id, m.number, m.title, m.theme, m.keyword, m.date, m.start_time, m.end_time, \
            COALESCE(v.name, '') AS venue, m.status, \
            CASE WHEN t.meeting_id IS NULL THEN 0 ELSE 1 END AS is_template \
         FROM meeting m \
         LEFT JOIN venue v ON v.id = m.venue_id \
         LEFT JOIN template t ON t.meeting_id = m.id \
         WHERE m.id = ?",
    )
    .bind(meeting_id)
    .fetch_optional(pool)
    .await?;

    match meeting {
        Some(meeting) => Ok(Some(load_meeting(pool, meeting).await?)),
        None => Ok(None),
    }
}
