#![allow(dead_code)]

pub trait SqlRecord {
    fn id(&self) -> Option<i64>;
    fn set_id(&mut self, id: i64);

    fn should_update(&self) -> bool {
        self.id().is_some()
    }
}

#[derive(Clone, Debug)]
pub struct User {
    pub id: Option<i64>,
    pub display_name: String,
}

impl SqlRecord for User {
    fn id(&self) -> Option<i64> {
        self.id
    }

    fn set_id(&mut self, id: i64) {
        self.id = Some(id);
    }
}

#[derive(Clone, Debug)]
pub struct PrepField {
    pub key: String,
    pub field_type: String,
}

#[derive(Clone, Debug)]
pub struct PrepData {
    pub raw: serde_json::Value,
}

impl Default for PrepData {
    fn default() -> Self {
        Self {
            raw: serde_json::json!({}),
        }
    }
}

impl PrepData {
    pub fn from_json(raw: serde_json::Value) -> Self {
        Self { raw }
    }

    pub fn text(&self, key: &str) -> Option<&str> {
        self.raw
            .get(key)?
            .as_str()
            .map(str::trim)
            .filter(|s| !s.is_empty())
    }

    pub fn title(&self) -> Option<&str> {
        self.text("title")
    }

    pub fn pathway(&self) -> Option<&str> {
        self.text("pathway")
    }

    pub fn level(&self) -> Option<i64> {
        self.raw
            .get("level")
            .and_then(|v| v.as_i64().or_else(|| v.as_str()?.trim().parse().ok()))
    }

    pub fn purpose(&self) -> Option<&str> {
        self.text("purpose")
    }

    pub fn description(&self) -> Option<&str> {
        self.text("description")
    }
}

#[derive(Clone, Debug)]
pub struct Role {
    pub id: Option<i64>,
    pub name: String,
    pub prep_fields: Vec<PrepField>,
}

impl SqlRecord for Role {
    fn id(&self) -> Option<i64> {
        self.id
    }

    fn set_id(&mut self, id: i64) {
        self.id = Some(id);
    }
}

impl Role {
    pub fn is_prepared_speech(&self) -> bool {
        let name = self.name.to_ascii_lowercase();
        name.contains("speaker") || name.contains("prepared speech")
    }
}

#[derive(Clone, Debug)]
pub struct RoleTaker {
    pub id: Option<i64>,
    pub role: Role,
    pub label: String,
    pub custom_label: Option<String>,
    pub is_optional: bool,
    pub booker: Option<User>,
    pub taker: Option<User>,
    pub prep_data: PrepData,
    pub prep_updated_at: Option<String>,
}

impl SqlRecord for RoleTaker {
    fn id(&self) -> Option<i64> {
        self.id
    }

    fn set_id(&mut self, id: i64) {
        self.id = Some(id);
    }
}

impl RoleTaker {
    pub fn is_prepared_speech(&self) -> bool {
        self.role.is_prepared_speech()
    }

    pub fn prepared_speech_title(&self) -> Option<&str> {
        self.is_prepared_speech()
            .then(|| self.prep_data.title())
            .flatten()
    }

    pub fn agenda_taker(&self) -> Option<&str> {
        self.taker
            .as_ref()
            .or(self.booker.as_ref())
            .map(|user| user.display_name.as_str())
            .filter(|name| !name.trim().is_empty())
    }
}

#[derive(Clone, Debug)]
pub struct RoleTakerRef {
    pub id: Option<i64>,
    pub role_name: String,
    pub is_optional: bool,
    pub booker_name: Option<String>,
    pub taker_name: Option<String>,
    pub prep_data: PrepData,
}

impl From<&RoleTaker> for RoleTakerRef {
    fn from(role_taker: &RoleTaker) -> Self {
        Self {
            id: role_taker.id,
            role_name: role_taker.role.name.clone(),
            is_optional: role_taker.is_optional,
            booker_name: role_taker
                .booker
                .as_ref()
                .map(|user| user.display_name.clone()),
            taker_name: role_taker
                .taker
                .as_ref()
                .map(|user| user.display_name.clone()),
            prep_data: role_taker.prep_data.clone(),
        }
    }
}

impl RoleTakerRef {
    pub fn is_prepared_speech(&self) -> bool {
        let role = self.role_name.to_ascii_lowercase();
        role.contains("speaker") || role.contains("prepared speech")
    }

    pub fn prepared_speech_title(&self) -> Option<&str> {
        self.is_prepared_speech()
            .then(|| self.prep_data.title())
            .flatten()
    }

    pub fn agenda_taker(&self) -> Option<&str> {
        self.taker_name
            .as_deref()
            .or(self.booker_name.as_deref())
            .map(str::trim)
            .filter(|name| !name.is_empty())
    }
}

#[derive(Clone, Debug)]
pub struct Session {
    pub id: Option<i64>,
    pub position: i64,
    pub group: String,
    pub name: String,
    pub duration_minutes: i64,
    pub role: Option<RoleTakerRef>,
}

impl SqlRecord for Session {
    fn id(&self) -> Option<i64> {
        self.id
    }

    fn set_id(&mut self, id: i64) {
        self.id = Some(id);
    }
}

impl Session {
    pub fn agenda_name(&self) -> String {
        self.role
            .as_ref()
            .and_then(RoleTakerRef::prepared_speech_title)
            .unwrap_or(&self.name)
            .to_string()
    }

    pub fn agenda_taker(&self) -> String {
        match &self.role {
            Some(role) => role.agenda_taker().unwrap_or("").to_string(),
            None => "All".to_string(),
        }
    }

    pub fn is_optional(&self) -> bool {
        self.role.as_ref().is_some_and(|role| role.is_optional)
    }
}

#[derive(Clone, Debug)]
pub struct Meeting {
    pub id: Option<i64>,
    pub number: i64,
    pub title: String,
    pub theme: String,
    pub keyword: String,
    pub date: String,
    pub start_time: String,
    pub end_time: String,
    pub venue: String,
    pub status: String,
    pub is_template: bool,
    pub sessions: Vec<Session>,
    pub role_takers: Vec<RoleTaker>,
}

impl SqlRecord for Meeting {
    fn id(&self) -> Option<i64> {
        self.id
    }

    fn set_id(&mut self, id: i64) {
        self.id = Some(id);
    }
}

impl Meeting {
    pub fn phase(&self) -> &'static str {
        meeting_phase(&self.status, &self.date, &self.start_time)
    }

    pub fn prepared_speeches(&self) -> impl Iterator<Item = &RoleTaker> {
        self.role_takers
            .iter()
            .filter(|role_taker| role_taker.is_prepared_speech())
    }
}

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
