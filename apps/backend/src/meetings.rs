use std::collections::HashMap;

use sqlx::{FromRow, MySqlPool};

use crate::error::{AppError, AppResult};
use crate::models::{MeetingResponse, RoleTakerResponse, SessionResponse, SpeechResponse};

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
    label: Option<String>,
    voting_group: String,
    is_optional: i64,
    is_bookable: i64,
    position: i64,
    taker_id: Option<i64>,
    taker_name: Option<String>,
    speech_id: Option<i64>,
    speech_title: Option<String>,
    speech_pathway: Option<String>,
    speech_level: Option<i64>,
    speech_purpose: Option<String>,
    speech_description: Option<String>,
    speech_updated_at: Option<String>,
}

fn is_prepared_speech(role_name: &str) -> bool {
    let name = role_name.to_ascii_lowercase();
    name.contains("speaker") || name.contains("prepared speech")
}

fn role_taker_response(
    row: RoleTakerRow,
    label: String,
    custom_label: Option<String>,
) -> RoleTakerResponse {
    // Prepared-speech slots carry their details in the `speech` table.
    let speech = row.speech_id.map(|_| SpeechResponse {
        title: row.speech_title.clone().unwrap_or_default(),
        pathway: row.speech_pathway.clone().unwrap_or_default(),
        level: row.speech_level,
        purpose: row.speech_purpose.clone().unwrap_or_default(),
        description: row.speech_description.clone().unwrap_or_default(),
        updated_at: row.speech_updated_at.clone(),
    });
    RoleTakerResponse {
        id: row.id,
        role_id: row.role_id,
        role_name: row.role_name,
        label,
        custom_label,
        voting_group: row.voting_group,
        position: row.position,
        is_optional: row.is_optional != 0,
        is_bookable: row.is_bookable != 0,
        taker_id: row.taker_id,
        taker_name: row.taker_name,
        speech,
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
        .and_then(|slot| slot.speech.as_ref())
        .map(|speech| speech.title.trim())
        .filter(|title| !title.is_empty())
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
        sessions,
        role_takers,
    }
}

async fn load_meeting(pool: &MySqlPool, meeting: MeetingRow) -> AppResult<MeetingResponse> {
    let session_rows = sqlx::query_as::<_, SessionRow>(
        "SELECT id, position, group_label, name, duration_minutes, role_slot_id \
         FROM `session` WHERE meeting_id = ? ORDER BY position",
    )
    .bind(meeting.id)
    .fetch_all(pool)
    .await?;

    let role_taker_rows = sqlx::query_as::<_, RoleTakerRow>(
        "SELECT rs.id, rs.role_id, r.name AS role_name, rs.label, r.voting_group, rs.is_optional, r.is_bookable, \
            rs.position, \
            ra.taker_id, taker.display_name AS taker_name, \
            sp.id AS speech_id, sp.title AS speech_title, sp.pathway AS speech_pathway, \
            sp.level AS speech_level, sp.purpose AS speech_purpose, \
            sp.description AS speech_description, sp.updated_at AS speech_updated_at \
         FROM role_slot rs \
         JOIN `role` r ON r.id = rs.role_id \
         LEFT JOIN role_assignment ra ON ra.role_slot_id = rs.id \
         LEFT JOIN user taker ON taker.id = ra.taker_id \
         LEFT JOIN speech sp ON sp.role_slot_id = rs.id \
         WHERE rs.meeting_id = ? ORDER BY rs.position, rs.id",
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

pub async fn upcoming_published(pool: &MySqlPool) -> AppResult<Vec<MeetingResponse>> {
    let today = chrono::Local::now().date_naive().to_string();
    let rows = sqlx::query_as::<_, MeetingRow>(
        "SELECT m.id, m.number, m.title, m.theme, m.keyword, m.date, m.start_time, m.end_time, \
            COALESCE(v.name, '') AS venue, m.status \
         FROM meeting m \
         LEFT JOIN venue v ON v.id = m.venue_id \
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
    pool: &MySqlPool,
    meeting_id: i64,
) -> AppResult<Option<MeetingResponse>> {
    let meeting = sqlx::query_as::<_, MeetingRow>(
        "SELECT m.id, m.number, m.title, m.theme, m.keyword, m.date, m.start_time, m.end_time, \
            COALESCE(v.name, '') AS venue, m.status \
         FROM meeting m \
         LEFT JOIN venue v ON v.id = m.venue_id \
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

// ---------------------------------------------------------------------------
// Umbrella check-in meeting resolution (see design/functionalities/check_in.md)
// ---------------------------------------------------------------------------

/// Does `now` fall in the inclusive check-in window `[start - 30 minutes, end]`?
fn checkin_window_contains(
    start: chrono::NaiveDateTime,
    end: chrono::NaiveDateTime,
    now: chrono::NaiveDateTime,
) -> bool {
    now >= start - chrono::Duration::minutes(30) && now <= end
}

/// One published meeting's raw (unparsed) schedule, loaded for candidate
/// window resolution. `date`/`start_time` are ISO (`YYYY-MM-DD`/`HH:MM`, the
/// `meeting` table's own format); `end_time` may be blank (`DEFAULT ''`).
#[derive(Debug, Clone, FromRow)]
struct CandidateMeetingRow {
    id: i64,
    date: String,
    start_time: String,
    end_time: String,
}

/// Parse one candidate's scheduled `[start, end]` window in local naive time.
/// A blank `end_time` is treated as `start` — no invented duration. A
/// nonblank `end_time` that parses earlier than `start_time` is treated as
/// ending the next calendar day (an overnight meeting, e.g. 23:00-00:30).
/// Malformed `date`/`start_time`/`end_time` is an explicit `AppError::Internal`
/// — a published meeting with unparsable scheduling data is a data-integrity
/// bug worth surfacing, never a silent skip.
fn parse_candidate_window(
    row: &CandidateMeetingRow,
) -> AppResult<(chrono::NaiveDateTime, chrono::NaiveDateTime)> {
    let date = chrono::NaiveDate::parse_from_str(&row.date, "%Y-%m-%d").map_err(|e| {
        AppError::Internal(anyhow::anyhow!(
            "meeting {}: invalid date {:?}: {e}",
            row.id,
            row.date
        ))
    })?;
    let start_time = chrono::NaiveTime::parse_from_str(&row.start_time, "%H:%M").map_err(|e| {
        AppError::Internal(anyhow::anyhow!(
            "meeting {}: invalid start_time {:?}: {e}",
            row.id,
            row.start_time
        ))
    })?;
    let start = date.and_time(start_time);

    let end = if row.end_time.trim().is_empty() {
        start
    } else {
        let end_time =
            chrono::NaiveTime::parse_from_str(row.end_time.trim(), "%H:%M").map_err(|e| {
                AppError::Internal(anyhow::anyhow!(
                    "meeting {}: invalid end_time {:?}: {e}",
                    row.id,
                    row.end_time
                ))
            })?;
        let same_day_end = date.and_time(end_time);
        if end_time < start_time {
            same_day_end + chrono::Duration::days(1)
        } else {
            same_day_end
        }
    };

    Ok((start, end))
}

/// Earliest published candidate whose check-in window `[start - 30 minutes,
/// end]` (see `checkin_window_contains`) contains `now`, ordered by scheduled
/// start then meeting ID. Pure and DB-free, so every boundary/blank/overnight/
/// tie-break/malformed-data case is exercised directly by the unit tests
/// above — this is the exact logic `incoming_published_id` ships below.
///
/// A candidate whose stored schedule fails to parse is a data-integrity bug
/// in exactly that row, not a reason to fail check-in for every attendee:
/// it is logged via `tracing::error!` (with the meeting ID and parse error,
/// so the log carries enough detail to fix the row) and excluded from
/// selection, while every other, well-formed open candidate is still
/// considered. If no candidate is open (including because all of them are
/// unschedulable), this returns `None`, never an error.
fn resolve_incoming_meeting(
    candidates: Vec<CandidateMeetingRow>,
    now: chrono::NaiveDateTime,
) -> Option<i64> {
    let mut open = Vec::new();
    for row in &candidates {
        match parse_candidate_window(row) {
            Ok((start, end)) => {
                if checkin_window_contains(start, end, now) {
                    open.push((start, row.id));
                }
            }
            Err(err) => {
                tracing::error!(
                    meeting_id = row.id,
                    error = ?err,
                    "excluding unschedulable check-in candidate: failed to parse its schedule"
                );
            }
        }
    }
    open.into_iter().min().map(|(_, id)| id)
}

/// Load every `published` meeting scheduled from yesterday through tomorrow
/// — a generous date-only prefilter; `resolve_incoming_meeting` does the
/// exact time-window math, including overnight rollover, in Rust.
async fn incoming_published_candidates(
    pool: &MySqlPool,
    today: chrono::NaiveDate,
) -> AppResult<Vec<CandidateMeetingRow>> {
    sqlx::query_as::<_, CandidateMeetingRow>(
        "SELECT id, date, start_time, end_time FROM meeting \
         WHERE status = 'published' AND date BETWEEN ? AND ?",
    )
    .bind((today - chrono::Duration::days(1)).to_string())
    .bind((today + chrono::Duration::days(1)).to_string())
    .fetch_all(pool)
    .await
    .map_err(Into::into)
}

/// Earliest published meeting whose check-in window contains `now`, if any —
/// fetches yesterday-through-tomorrow candidates, then defers to the pure,
/// unit-tested `resolve_incoming_meeting` for the actual selection. Only the
/// candidate fetch can fail here: `resolve_incoming_meeting` itself is
/// infallible, logging and excluding any unschedulable row instead of
/// erroring, so a single meeting's malformed schedule can never turn this
/// into a 500 for every umbrella check-in — it falls back to `None`, which
/// the umbrella handler turns into a normal "no meeting open" conflict.
pub async fn incoming_published_id(
    pool: &MySqlPool,
    now: chrono::NaiveDateTime,
) -> AppResult<Option<i64>> {
    let candidates = incoming_published_candidates(pool, now.date()).await?;
    Ok(resolve_incoming_meeting(candidates, now))
}

/// Load a meeting's lifecycle status by ID, or `None` if it does not exist.
/// Used only by the umbrella endpoint's explicit-ID path — the existing
/// meeting-specific `checkin` handler keeps its own existence-only check.
pub async fn load_status(pool: &MySqlPool, meeting_id: i64) -> AppResult<Option<String>> {
    sqlx::query_scalar("SELECT status FROM meeting WHERE id = ?")
        .bind(meeting_id)
        .fetch_optional(pool)
        .await
        .map_err(Into::into)
}

/// Validate a loaded status for an explicit umbrella check-in request: a
/// missing meeting is `NotFound`, a `published` meeting is `Ok`, and any
/// other status (for example `draft`) is a `Conflict`. The automatic
/// (no-ID) path never calls this — `incoming_published_id` already filters
/// to `status = 'published'`.
pub fn ensure_open_for_checkin(status: Option<&str>) -> AppResult<()> {
    match status {
        None => Err(AppError::NotFound),
        Some("published") => Ok(()),
        Some(_) => Err(AppError::Conflict(
            "This meeting is not open for check-in.".into(),
        )),
    }
}

/// Record (or refresh) one self-check-in attendance row. Shared by the
/// existing meeting-specific handler and the new umbrella handler; callers
/// remain responsible for any existence/status validation before calling
/// this — it performs no such checks itself.
pub async fn record_attendance(pool: &MySqlPool, user_id: i64, meeting_id: i64) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO attendance(meeting_id, user_id, checked_in_at, source) \
         VALUES (?, ?, UTC_TIMESTAMP(), 'self') \
         ON DUPLICATE KEY UPDATE checked_in_at = VALUES(checked_in_at)",
    )
    .bind(meeting_id)
    .bind(user_id)
    .execute(pool)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{Duration, NaiveDate, NaiveDateTime, NaiveTime};

    fn dt(date: &str, time: &str) -> NaiveDateTime {
        NaiveDate::parse_from_str(date, "%Y-%m-%d")
            .unwrap()
            .and_time(NaiveTime::parse_from_str(time, "%H:%M").unwrap())
    }

    fn candidate(id: i64, date: &str, start_time: &str, end_time: &str) -> CandidateMeetingRow {
        CandidateMeetingRow {
            id,
            date: date.into(),
            start_time: start_time.into(),
            end_time: end_time.into(),
        }
    }

    #[test]
    fn window_boundaries() {
        let start = dt("2026-08-19", "19:00");
        let end = dt("2026-08-19", "21:00");
        assert!(!checkin_window_contains(
            start,
            end,
            start - Duration::minutes(31)
        ));
        assert!(checkin_window_contains(
            start,
            end,
            start - Duration::minutes(30)
        ));
        assert!(checkin_window_contains(start, end, start));
        assert!(checkin_window_contains(start, end, end));
        assert!(!checkin_window_contains(
            start,
            end,
            end + Duration::minutes(1)
        ));
    }

    #[test]
    fn blank_end_time_is_treated_as_start_with_no_invented_duration() {
        let start = dt("2026-08-19", "19:00");
        let candidates = vec![candidate(1, "2026-08-19", "19:00", "")];
        assert_eq!(
            resolve_incoming_meeting(candidates.clone(), start - Duration::minutes(31)),
            None
        );
        assert_eq!(
            resolve_incoming_meeting(candidates.clone(), start - Duration::minutes(30)),
            Some(1)
        );
        assert_eq!(resolve_incoming_meeting(candidates.clone(), start), Some(1));
        assert_eq!(
            resolve_incoming_meeting(candidates, start + Duration::minutes(1)),
            None
        );
    }

    #[test]
    fn end_earlier_than_start_rolls_over_to_the_next_day() {
        // Scheduled 23:00 -> 00:30: an overnight meeting.
        let candidates = vec![candidate(1, "2026-08-19", "23:00", "00:30")];
        assert_eq!(
            resolve_incoming_meeting(candidates.clone(), dt("2026-08-20", "00:30")),
            Some(1)
        );
        assert_eq!(
            resolve_incoming_meeting(candidates, dt("2026-08-20", "00:31")),
            None
        );
    }

    #[test]
    fn earliest_start_then_lowest_id_wins_overlapping_matches() {
        let now = dt("2026-08-19", "19:30");
        let candidates = vec![
            candidate(20, "2026-08-19", "19:00", "20:00"),
            candidate(10, "2026-08-19", "19:00", "20:00"),
        ];
        assert_eq!(resolve_incoming_meeting(candidates, now), Some(10));
    }

    #[test]
    fn parse_candidate_window_surfaces_malformed_scheduling_data_as_an_explicit_error() {
        // `resolve_incoming_meeting` no longer propagates this — it logs and
        // excludes the row instead — but `parse_candidate_window` itself must
        // keep returning a detailed error so that log has something to report.
        let row = candidate(1, "not-a-date", "19:00", "");
        let err = parse_candidate_window(&row).unwrap_err();
        assert!(matches!(err, AppError::Internal(_)));
    }

    #[test]
    fn malformed_candidates_are_logged_and_excluded_valid_open_candidate_still_selected() {
        let now = dt("2026-08-19", "19:00");
        let candidates = vec![
            candidate(1, "2026-08-19", "", ""),      // blank start_time
            candidate(2, "not-a-date", "19:00", ""), // malformed date
            candidate(3, "2026-08-19", "19:00", ""), // valid and open
        ];
        assert_eq!(resolve_incoming_meeting(candidates, now), Some(3));
    }

    #[test]
    fn malformed_only_candidates_resolve_to_none_not_an_error() {
        let candidates = vec![
            candidate(1, "2026-08-19", "", ""),      // blank start_time
            candidate(2, "not-a-date", "19:00", ""), // malformed date
        ];
        assert_eq!(
            resolve_incoming_meeting(candidates, dt("2026-08-19", "19:00")),
            None
        );
    }

    #[test]
    fn explicit_status_is_validated() {
        assert!(matches!(
            ensure_open_for_checkin(None),
            Err(AppError::NotFound)
        ));
        assert!(ensure_open_for_checkin(Some("published")).is_ok());
        assert!(matches!(
            ensure_open_for_checkin(Some("draft")),
            Err(AppError::Conflict(_))
        ));
    }
}
