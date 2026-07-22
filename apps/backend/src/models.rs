use serde::{Deserialize, Serialize};

use crate::domain::{Meeting, PrepField, RoleTaker, Session, User};

fn persisted_id(id: Option<i64>, object: &str) -> i64 {
    id.unwrap_or_else(|| panic!("{object} response requires a persisted id"))
}

#[derive(Serialize)]
pub struct UserResponse {
    pub id: i64,
    pub display_name: String,
}

impl From<&User> for UserResponse {
    fn from(user: &User) -> Self {
        Self {
            id: persisted_id(user.id, "user"),
            display_name: user.display_name.clone(),
        }
    }
}

#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct PrepFieldResponse {
    pub key: String,
    #[serde(rename = "type")]
    pub field_type: String,
}

impl From<&PrepField> for PrepFieldResponse {
    fn from(field: &PrepField) -> Self {
        Self {
            key: field.key.clone(),
            field_type: field.field_type.clone(),
        }
    }
}

#[derive(Serialize)]
pub struct SessionResponse {
    pub id: i64,
    pub position: i64,
    pub group_label: String,
    pub name: String,
    pub agenda_name: String,
    pub duration_minutes: i64,
    pub role_slot_id: Option<i64>,
}

impl From<&Session> for SessionResponse {
    fn from(session: &Session) -> Self {
        Self {
            id: persisted_id(session.id, "session"),
            position: session.position,
            group_label: session.group.clone(),
            name: session.name.clone(),
            agenda_name: session.agenda_name(),
            duration_minutes: session.duration_minutes,
            role_slot_id: session.role.as_ref().and_then(|role| role.id),
        }
    }
}

#[derive(Serialize)]
pub struct RoleTakerResponse {
    pub id: i64,
    pub role_id: i64,
    pub role_name: String,
    pub label: String,
    pub custom_label: Option<String>,
    pub is_optional: bool,
    pub booker_id: Option<i64>,
    pub booker_name: Option<String>,
    pub taker_id: Option<i64>,
    pub prep_fields: Vec<PrepFieldResponse>,
    pub prep_data: serde_json::Value,
    pub prep_updated_at: Option<String>,
}

impl From<&RoleTaker> for RoleTakerResponse {
    fn from(role_taker: &RoleTaker) -> Self {
        Self {
            id: persisted_id(role_taker.id, "role taker"),
            role_id: persisted_id(role_taker.role.id, "role"),
            role_name: role_taker.role.name.clone(),
            label: role_taker.label.clone(),
            custom_label: role_taker.custom_label.clone(),
            is_optional: role_taker.is_optional,
            booker_id: role_taker.booker.as_ref().and_then(|user| user.id),
            booker_name: role_taker
                .booker
                .as_ref()
                .map(|user| user.display_name.clone()),
            taker_id: role_taker.taker.as_ref().and_then(|user| user.id),
            prep_fields: role_taker
                .role
                .prep_fields
                .iter()
                .map(PrepFieldResponse::from)
                .collect(),
            prep_data: role_taker.prep_data.raw.clone(),
            prep_updated_at: role_taker.prep_updated_at.clone(),
        }
    }
}

#[derive(Serialize)]
pub struct MeetingResponse {
    pub id: i64,
    pub number: i64,
    pub title: String,
    pub theme: String,
    pub keyword: String,
    pub date: String,
    pub start_time: String,
    pub end_time: String,
    pub venue: String,
    pub status: String,
    pub phase: String,
    pub is_template: bool,
    pub sessions: Vec<SessionResponse>,
    #[serde(rename = "role_slots")]
    pub role_takers: Vec<RoleTakerResponse>,
}

impl From<&Meeting> for MeetingResponse {
    fn from(meeting: &Meeting) -> Self {
        Self {
            id: persisted_id(meeting.id, "meeting"),
            number: meeting.number,
            title: meeting.title.clone(),
            theme: meeting.theme.clone(),
            keyword: meeting.keyword.clone(),
            date: meeting.date.clone(),
            start_time: meeting.start_time.clone(),
            end_time: meeting.end_time.clone(),
            venue: meeting.venue.clone(),
            status: meeting.status.clone(),
            phase: meeting.phase().to_string(),
            is_template: meeting.is_template,
            sessions: meeting.sessions.iter().map(SessionResponse::from).collect(),
            role_takers: meeting
                .role_takers
                .iter()
                .map(RoleTakerResponse::from)
                .collect(),
        }
    }
}
