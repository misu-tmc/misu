use serde::{Deserialize, Serialize};

#[derive(Serialize)]
pub struct UserResponse {
    pub id: i64,
    pub display_name: String,
}

#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct PrepFieldResponse {
    pub key: String,
    #[serde(rename = "type")]
    pub field_type: String,
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
    pub sessions: Vec<SessionResponse>,
    #[serde(rename = "role_slots")]
    pub role_takers: Vec<RoleTakerResponse>,
}
