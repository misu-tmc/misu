use std::collections::HashMap;

use sqlx::{FromRow, SqlitePool};

use crate::domain::{Meeting, PrepData, PrepField, Role, RoleTaker, RoleTakerRef, Session, User};
use crate::error::AppResult;
use crate::models::MeetingResponse;

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
    taker_name: Option<String>,
    prep_data: String,
    prep_updated_at: Option<String>,
}

impl MeetingRow {
    fn into_meeting(self, sessions: Vec<Session>, role_takers: Vec<RoleTaker>) -> Meeting {
        Meeting {
            id: Some(self.id),
            number: self.number,
            title: self.title,
            theme: self.theme,
            keyword: self.keyword,
            date: self.date,
            start_time: self.start_time,
            end_time: self.end_time,
            venue: self.venue,
            status: self.status,
            is_template: self.is_template,
            sessions,
            role_takers,
        }
    }
}

impl SessionRow {
    fn into_session(self, role: Option<RoleTakerRef>) -> Session {
        Session {
            id: Some(self.id),
            position: self.position,
            group: self.group_label,
            name: self.name,
            duration_minutes: self.duration_minutes,
            role,
        }
    }
}

impl RoleTakerRow {
    fn into_role_taker(self, label: String, custom_label: Option<String>) -> RoleTaker {
        RoleTaker {
            id: Some(self.id),
            role: Role {
                id: Some(self.role_id),
                name: self.role_name,
                prep_fields: parse_prep_fields(self.properties.as_deref()),
            },
            label,
            custom_label,
            is_optional: self.is_optional != 0,
            booker: user_from_parts(self.booker_id, self.booker_name),
            taker: user_from_parts(self.taker_id, self.taker_name),
            prep_data: parse_prep_data(&self.prep_data),
            prep_updated_at: self.prep_updated_at,
        }
    }
}

pub fn meeting_phase(status: &str, date: &str, start_time: &str) -> &'static str {
    crate::domain::meeting_phase(status, date, start_time)
}

fn user_from_parts(id: Option<i64>, display_name: Option<String>) -> Option<User> {
    id.map(|id| User {
        id: Some(id),
        display_name: display_name.unwrap_or_default(),
    })
}

fn parse_prep_fields(properties: Option<&str>) -> Vec<PrepField> {
    let Some(raw) = properties.map(str::trim).filter(|s| !s.is_empty()) else {
        return Vec::new();
    };
    serde_json::from_str::<Vec<crate::models::PrepFieldResponse>>(raw)
        .unwrap_or_default()
        .into_iter()
        .map(|field| PrepField {
            key: field.key,
            field_type: field.field_type,
        })
        .collect()
}

fn parse_prep_data(raw: &str) -> PrepData {
    PrepData::from_json(serde_json::from_str(raw).unwrap_or_else(|_| serde_json::json!({})))
}

fn role_takers_from_rows(rows: Vec<RoleTakerRow>) -> Vec<RoleTaker> {
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
            row.into_role_taker(label, custom_label)
        })
        .collect()
}

async fn load_meeting(pool: &SqlitePool, meeting: MeetingRow) -> AppResult<Meeting> {
    let session_rows = sqlx::query_as::<_, SessionRow>(
        "SELECT id, position, group_label, name, duration_minutes, role_slot_id \
         FROM session WHERE meeting_id = ? ORDER BY position",
    )
    .bind(meeting.id)
    .fetch_all(pool)
    .await?;

    let role_taker_rows = sqlx::query_as::<_, RoleTakerRow>(
        "SELECT rs.id, rs.role_id, r.name AS role_name, r.properties, rs.label, rs.is_optional, \
            ra.booker_id, booker.display_name AS booker_name, \
            ra.taker_id, taker.display_name AS taker_name, \
            COALESCE(ra.prep_data, '{}') AS prep_data, ra.prep_updated_at \
         FROM role_slot rs \
         JOIN role r ON r.id = rs.role_id \
         LEFT JOIN role_assignment ra ON ra.role_slot_id = rs.id \
         LEFT JOIN user booker ON booker.id = ra.booker_id \
         LEFT JOIN user taker ON taker.id = ra.taker_id \
         WHERE rs.meeting_id = ? ORDER BY rs.id",
    )
    .bind(meeting.id)
    .fetch_all(pool)
    .await?;

    let role_takers = role_takers_from_rows(role_taker_rows);
    let role_by_id: HashMap<i64, RoleTakerRef> = role_takers
        .iter()
        .filter_map(|role_taker| role_taker.id.map(|id| (id, RoleTakerRef::from(role_taker))))
        .collect();

    let sessions = session_rows
        .into_iter()
        .map(|session| {
            let role = session
                .role_slot_id
                .and_then(|role_id| role_by_id.get(&role_id).cloned());
            session.into_session(role)
        })
        .collect();

    Ok(meeting.into_meeting(sessions, role_takers))
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
        let meeting = load_meeting(pool, row).await?;
        out.push(MeetingResponse::from(&meeting));
    }
    Ok(out)
}

pub async fn meeting_by_id(pool: &SqlitePool, meeting_id: i64) -> AppResult<Option<Meeting>> {
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

pub async fn meeting_response_by_id(
    pool: &SqlitePool,
    meeting_id: i64,
) -> AppResult<Option<MeetingResponse>> {
    Ok(meeting_by_id(pool, meeting_id)
        .await?
        .map(|meeting| MeetingResponse::from(&meeting)))
}
