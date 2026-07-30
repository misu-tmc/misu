use serde::Serialize;

#[derive(Serialize)]
pub struct UserResponse {
    pub id: i64,
    pub display_name: String,
}

#[derive(Serialize)]
pub struct SpeechResponse {
    pub title: String,
    pub pathway: String,
    pub level: Option<i64>,
    pub purpose: String,
    pub description: String,
    pub updated_at: Option<String>,
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
    pub voting_group: String,
    pub position: i64,
    pub is_optional: bool,
    pub is_bookable: bool,
    pub taker_id: Option<i64>,
    pub taker_name: Option<String>,
    pub speech: Option<SpeechResponse>,
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
