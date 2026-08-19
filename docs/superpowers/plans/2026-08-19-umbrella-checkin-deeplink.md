# Umbrella Check-in Deeplink Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a second, stacked PR that adds an umbrella check-in URL with optional meeting ID and generic authentication redirection, without QR generation.

**Architecture:** The protected SPA route always calls a backend umbrella endpoint. The backend resolves the open incoming meeting when no ID is supplied, records idempotent attendance, and returns the selected ID; login remains generic and only preserves safe return destinations.

**Tech Stack:** Rust 2021, Axum, SQLx/MySQL, Chrono, Preact, Wouter, Vitest/Testing Library, Node test runner.

---

## Task 1: Create the Stacked Deeplink Branch

**Files:**
- Create: `docs/superpowers/specs/2026-08-19-umbrella-checkin-deeplink-design.md`
- Create: `docs/superpowers/plans/2026-08-19-umbrella-checkin-deeplink.md`

- [x] **Step 1: Branch from the completed optional-club branch**

```powershell
git switch -c agents/umbrella-checkin-deeplink
git checkout agents/deeplink-checkin-full-backup -- `
  docs/superpowers/specs/2026-08-19-umbrella-checkin-deeplink-design.md `
  docs/superpowers/plans/2026-08-19-umbrella-checkin-deeplink.md
git add docs/superpowers/specs/2026-08-19-umbrella-checkin-deeplink-design.md `
  docs/superpowers/plans/2026-08-19-umbrella-checkin-deeplink.md
git commit -m "docs: design umbrella check-in deeplink" `
  -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

**Task 1 complete. Execution resumes at Task 2.**

## Task 2: Add Backend Meeting Resolution and Umbrella Check-in

**Files:**
- Modify: `apps/backend/src/main.rs`
- Modify: `apps/backend/src/meetings.rs`
- Modify: `apps/backend/src/handlers.rs`

Current state on this branch (verified against `apps/backend/src/handlers.rs`
and `apps/backend/src/meetings.rs`): the meeting-specific handlers are

```rust
/// `GET /api/meetings/:id/checkin` — whether the current user has checked in.
pub async fn checkin_status(...) -> AppResult<Json<serde_json::Value>> { ... }

/// `POST /api/meetings/:id/checkin` — record the current user's attendance.
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
```

`checkin` only requires the meeting to exist (`COUNT(*) > 0`); it does **not**
require `status = 'published'`. That existence-only behavior must not change.
Only the final INSERT/ON DUPLICATE KEY UPDATE is shared with the new umbrella
endpoint, as `meetings::record_attendance` in Step 3.

Meeting-window selection is service-side Rust logic, not a single SQL
date/time expression: the backend loads `published` candidates' raw
(unparsed) schedules for a generous yesterday-through-tomorrow date range,
then a pure, unit-tested Rust function parses each candidate and picks the
match. This keeps every boundary/blank-end/overnight/tie-break/malformed-data
case exercised directly by fast, DB-free unit tests, rather than only
conceptually mirrored in an untested SQL expression.

- [ ] **Step 1: Write failing meeting-window and candidate-resolution tests**

Add to `apps/backend/src/meetings.rs` a new test module — none of
`checkin_window_contains`, `CandidateMeetingRow`, or `resolve_incoming_meeting`
exist yet, so this does not compile until Step 3 implements them:

```rust
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
        assert!(!checkin_window_contains(start, end, start - Duration::minutes(31)));
        assert!(checkin_window_contains(start, end, start - Duration::minutes(30)));
        assert!(checkin_window_contains(start, end, start));
        assert!(checkin_window_contains(start, end, end));
        assert!(!checkin_window_contains(start, end, end + Duration::minutes(1)));
    }

    #[test]
    fn blank_end_time_is_treated_as_start_with_no_invented_duration() {
        let start = dt("2026-08-19", "19:00");
        let candidates = vec![candidate(1, "2026-08-19", "19:00", "")];
        assert_eq!(resolve_incoming_meeting(candidates.clone(), start - Duration::minutes(31)), None);
        assert_eq!(resolve_incoming_meeting(candidates.clone(), start - Duration::minutes(30)), Some(1));
        assert_eq!(resolve_incoming_meeting(candidates.clone(), start), Some(1));
        assert_eq!(resolve_incoming_meeting(candidates, start + Duration::minutes(1)), None);
    }

    #[test]
    fn end_earlier_than_start_rolls_over_to_the_next_day() {
        // Scheduled 23:00 -> 00:30: an overnight meeting.
        let candidates = vec![candidate(1, "2026-08-19", "23:00", "00:30")];
        assert_eq!(resolve_incoming_meeting(candidates.clone(), dt("2026-08-20", "00:30")), Some(1));
        assert_eq!(resolve_incoming_meeting(candidates, dt("2026-08-20", "00:31")), None);
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
        // `resolve_incoming_meeting` does not propagate this — it logs and
        // excludes the row instead — but `parse_candidate_window` itself
        // must keep returning a detailed error so that log has something to
        // report.
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
        assert_eq!(resolve_incoming_meeting(candidates, dt("2026-08-19", "19:00")), None);
    }
}
```

- [ ] **Step 2: Verify RED**

```powershell
Set-Location apps\backend
cargo test meetings::tests
```

Expected: compile error — `checkin_window_contains`, `CandidateMeetingRow`,
and `resolve_incoming_meeting` do not exist yet.

- [ ] **Step 3: Implement the candidate resolver and shared helpers**

Add to `apps/backend/src/meetings.rs`, above the `mod tests` block added in
Step 1 (update the file's `use` line to
`use crate::error::{AppError, AppResult};`):

```rust
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
        let end_time = chrono::NaiveTime::parse_from_str(row.end_time.trim(), "%H:%M").map_err(|e| {
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
/// in exactly that row, not a reason to fail check-in for every attendee: it
/// is logged via `tracing::error!` (with the meeting ID and parse error, so
/// the log carries enough detail to fix the row) and excluded from
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
```

`load_status` and `incoming_published_candidates` hit the database, so,
matching this crate's existing convention (see `handlers.rs`'s
`ensure_self`/`resolve_club_name` tests), they are not unit-tested directly —
only the pure `resolve_incoming_meeting` (already covered above) and
`ensure_open_for_checkin` are. Add this test to the same `mod tests` block
from Step 1:

```rust
#[test]
fn explicit_status_is_validated() {
    assert!(matches!(ensure_open_for_checkin(None), Err(AppError::NotFound)));
    assert!(ensure_open_for_checkin(Some("published")).is_ok());
    assert!(matches!(ensure_open_for_checkin(Some("draft")), Err(AppError::Conflict(_))));
}
```

- [ ] **Step 4: Update the existing meeting-specific handler**

In `apps/backend/src/handlers.rs`, replace `checkin`'s inline INSERT with the
shared helper, keeping its existence-only check unchanged:

```rust
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

    meetings::record_attendance(&state.pool, user.id, meeting_id).await?;
    Ok(Json(json!({ "checked_in": true })))
}
```

- [ ] **Step 5: Write failing umbrella request tests**

Add to `handlers.rs`'s existing `#[cfg(test)] mod tests` block (the one
already covering `ensure_self`/`resolve_club_name` — see Task 2's intro) a
new import and test. `resolve_requested_meeting_id` does not exist yet, so
this does not compile until Step 7 implements it:

```rust
use super::{ensure_self, resolve_club_name, resolve_requested_meeting_id};
```

```rust
#[test]
fn requested_meeting_id_is_normalized() {
    assert_eq!(resolve_requested_meeting_id(None).unwrap(), None);
    assert_eq!(resolve_requested_meeting_id(Some(42)).unwrap(), Some(42));
    assert!(matches!(resolve_requested_meeting_id(Some(0)), Err(AppError::BadRequest(_))));
    assert!(matches!(resolve_requested_meeting_id(Some(-1)), Err(AppError::BadRequest(_))));
}
```

- [ ] **Step 6: Verify RED**

```powershell
Set-Location apps\backend
cargo test resolve_requested_meeting_id
```

Expected: compile error — `resolve_requested_meeting_id` does not exist yet.

- [ ] **Step 7: Implement request parsing and the umbrella endpoint**

In `handlers.rs`:

```rust
#[derive(serde::Deserialize)]
pub struct CheckinReq {
    pub meeting_id: Option<i64>,
}

/// Normalize the requested meeting ID: a positive ID is used as-is, zero or
/// negative is a bad request, and a missing ID defers to automatic selection.
fn resolve_requested_meeting_id(meeting_id: Option<i64>) -> AppResult<Option<i64>> {
    match meeting_id {
        Some(id) if id > 0 => Ok(Some(id)),
        Some(_) => Err(AppError::BadRequest("invalid meeting id".into())),
        None => Ok(None),
    }
}

/// `POST /api/checkin` — resolve the incoming meeting (explicit ID or the
/// currently open published meeting) and record attendance for it.
pub async fn umbrella_checkin(
    State(state): State<AppState>,
    user: AuthUser,
    Json(req): Json<CheckinReq>,
) -> AppResult<Json<serde_json::Value>> {
    let meeting_id = match resolve_requested_meeting_id(req.meeting_id)? {
        Some(id) => {
            let status = meetings::load_status(&state.pool, id).await?;
            meetings::ensure_open_for_checkin(status.as_deref())?;
            id
        }
        None => meetings::incoming_published_id(&state.pool, chrono::Local::now().naive_local())
            .await?
            .ok_or_else(|| AppError::Conflict("No meeting is currently open for check-in.".into()))?,
    };
    meetings::record_attendance(&state.pool, user.id, meeting_id).await?;
    Ok(Json(json!({ "checked_in": true, "meeting_id": meeting_id })))
}
```

In `apps/backend/src/main.rs`, register the route next to the existing
`/api/meetings/:meeting_id/checkin` route:

```rust
.route("/api/checkin", post(handlers::umbrella_checkin))
```

- [ ] **Step 8: Verify and commit backend deeplink support**

```powershell
Set-Location apps\backend
cargo fmt
cargo fmt --check
cargo test
Set-Location ..\..
git add apps/backend/src/main.rs apps/backend/src/meetings.rs `
  apps/backend/src/handlers.rs
git commit -m "feat(backend): resolve umbrella check-ins" `
  -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 3: Make Authentication Redirection Generic

**Files:**
- Modify: `apps/spa/src/App.jsx`
- Modify: `apps/spa/src/pages/LoginPage.jsx`
- Modify: `apps/spa/src/pages/LoginPage.test.jsx`
- Create: `apps/spa/src/lib/safeNextPath.js`
- Create: `apps/spa/src/lib/safeNextPath.test.js`

Current state on this branch (verified against `apps/spa/src/pages/LoginPage.jsx`
and `apps/spa/src/App.jsx`): `LoginPage.jsx` already defines and exports a
naive `safeNextPath`, used only for the account view's "Continue" link —

```javascript
export function safeNextPath(search) {
  const value = new URLSearchParams(search).get('next');
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/app/booking';
}
```

— and is imported and tested only by `LoginPage.test.jsx`. `App.jsx`'s
`LoginRedirect` builds the login target from Wouter's `location` alone,
**dropping the query string**:

```javascript
function LoginRedirect({ location }) {
  useEffect(() => {
    const loginPath = import.meta.env.DEV ? '/app/login' : '/login';
    window.location.assign(`${loginPath}?next=${encodeURIComponent(location)}`);
  }, [location]);
  return <PageLoading label="Opening sign in…" />;
}
```

Neither file contains `isCheckinPath`, `checkinIntent`, a `guest` view, or any
check-in-specific copy or branching — there is nothing check-in-specific to
remove. This task (a) moves and hardens `safeNextPath` into the shared
`apps/spa/src/lib/safeNextPath.js`, (b) fixes the dropped-query-string bug in
`LoginRedirect`, and (c) makes `finish` auto-redirect only when the login
query explicitly carried a `next`.

- [ ] **Step 1: Write failing full-query redirect test**

In `apps/spa/src/lib/safeNextPath.test.js`, test the new pure redirect-URL
builder exactly — this is the sole test for the redirect-URL construction.
Production `LoginRedirect` (Step 4) calls this exported, pure
`loginRedirectUrl(pathname, search, isDev)` directly, so there is no need for
a separate component-level integration test that spies on
`window.location.assign`: jsdom's `Location` methods are not reliably
mockable/forgeable across environments, and the full pathname+query encoding
behavior that such a spy would be checking is already covered exhaustively,
and more simply, here:

```javascript
import { describe, expect, it } from 'vitest';
import { hasExplicitNext, loginRedirectUrl, safeNextPath } from './safeNextPath.js';

describe('loginRedirectUrl', () => {
  it('encodes the full pathname and query as next', () => {
    expect(loginRedirectUrl('/app/checkin', '?meetingId=42', false))
      .toBe('/login?next=%2Fapp%2Fcheckin%3FmeetingId%3D42');
  });

  it('targets the development login route', () => {
    expect(loginRedirectUrl('/app/checkin', '', true)).toBe('/app/login?next=%2Fapp%2Fcheckin');
  });
});
```

- [ ] **Step 2: Verify RED**

```powershell
Set-Location apps\spa
npm test -- src/lib/safeNextPath.test.js
Set-Location ..\..
```

Expected: `safeNextPath.js` does not exist yet, so `loginRedirectUrl` is
undefined.

- [ ] **Step 3: Create the shared safe-next-path helper**

Create `apps/spa/src/lib/safeNextPath.js`:

```javascript
const FALLBACK_PATH = '/app/booking';

/**
 * Validate an untrusted `next` query value as a safe, same-origin redirect
 * target. Parses it against the current origin (so the browser normalizes
 * backslashes, dot-segments, and stray control characters the way it will
 * when the value is later used again), requires the resulting origin to be
 * unchanged, and requires the resulting pathname to start with exactly one
 * slash — rejecting protocol-relative values and dot-segment resolutions
 * that collapse to a `//`-prefixed path. Falls back to `/app/booking` for a
 * missing, malformed, or unsafe value.
 */
export function safeNextPath(search) {
  const raw = new URLSearchParams(search).get('next');
  if (!raw) return FALLBACK_PATH;
  let url;
  try {
    url = new URL(raw, window.location.origin);
  } catch (_) {
    return FALLBACK_PATH;
  }
  if (url.origin !== window.location.origin) return FALLBACK_PATH;
  if (!url.pathname.startsWith('/') || url.pathname.startsWith('//')) return FALLBACK_PATH;
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Whether the query string explicitly supplied a `next` destination. */
export function hasExplicitNext(search) {
  return new URLSearchParams(search).has('next');
}

/**
 * Build the login redirect target, preserving the complete, same-origin
 * destination (pathname + search) as an encoded `next` parameter.
 */
export function loginRedirectUrl(pathname, search, isDev) {
  const loginPath = isDev ? '/app/login' : '/login';
  return `${loginPath}?next=${encodeURIComponent(`${pathname}${search}`)}`;
}
```

Add the rest of `safeNextPath.test.js` (moved and hardened from
`LoginPage.test.jsx`; verified against real `URL` parsing behavior):

```javascript
describe('safeNextPath', () => {
  it('keeps a local return path', () => {
    expect(safeNextPath('?next=%2Fapp%2Fmeeting')).toBe('/app/meeting');
  });

  it('defaults to booking when next is missing', () => {
    expect(safeNextPath('')).toBe('/app/booking');
  });

  it('rejects a protocol-relative redirect', () => {
    expect(safeNextPath('?next=%2F%2Fevil.example')).toBe('/app/booking');
  });

  it('rejects a backslash-normalized off-origin redirect', () => {
    expect(safeNextPath(`?next=${encodeURIComponent('\\\\evil.example')}`)).toBe('/app/booking');
  });

  it('rejects a control-character off-origin redirect', () => {
    expect(safeNextPath(`?next=${encodeURIComponent('/\n/evil.example')}`)).toBe('/app/booking');
  });

  it('rejects a dot-segment resolution that collapses to a protocol-relative path', () => {
    const value = '/%2e%2e/%2e%2e//evil.example';
    expect(safeNextPath(`?next=${encodeURIComponent(value)}`)).toBe('/app/booking');
  });
});

describe('hasExplicitNext', () => {
  it('is true only when next is present', () => {
    expect(hasExplicitNext('?next=%2Fapp%2Fmeeting')).toBe(true);
    expect(hasExplicitNext('')).toBe(false);
  });
});
```

- [ ] **Step 4: Fix the login redirect and wire up the shared helper**

In `apps/spa/src/App.jsx`, use `loginRedirectUrl` so the full query survives:

```javascript
import { loginRedirectUrl } from './lib/safeNextPath.js';

function LoginRedirect({ location }) {
  useEffect(() => {
    window.location.assign(loginRedirectUrl(location, window.location.search, import.meta.env.DEV));
  }, [location]);
  return <PageLoading label="Opening sign in…" />;
}
```

In `apps/spa/src/pages/LoginPage.jsx`, remove the local `safeNextPath`
definition, import it (and `hasExplicitNext`) from the shared module, add
`useLocation` for `navigate`, and auto-redirect in `finish` only when the
query explicitly carried `next`:

```javascript
import { useLocation } from 'wouter-preact';
import { hasExplicitNext, safeNextPath } from '../lib/safeNextPath.js';
// ... existing imports ...

export function LoginPage() {
  const [, navigate] = useLocation();
  // ... existing state ...

  function finish(nextUser) {
    authUser.value = nextUser;
    authReady.value = true;
    setUser(nextUser);
    setError('');
    if (hasExplicitNext(window.location.search)) {
      navigate(safeNextPath(window.location.search), { replace: true });
      return;
    }
    setView('account');
  }
  // ... rest unchanged; the account view's Continue link keeps
  // `href={safeNextPath(window.location.search)}` for the no-`next` case ...
}
```

`LoginPage` already contains no check-in-specific view, copy, or branching
(there is no `isCheckinPath`, `checkinIntent`, or `guest` view to remove); the
generic create form continues collecting name and optional club unchanged.

- [ ] **Step 5: Write failing generic return tests**

In `apps/spa/src/pages/LoginPage.test.jsx`: remove the top-level
`describe('safeNextPath', ...)` block and the `safeNextPath` import (moved to
`safeNextPath.test.js` in Step 3), mock `wouter-preact`'s `useLocation` the
same way `EditorPage.test.jsx` does, and add the new tests **nested inside
the existing `describe('LoginPage generic account creation', ...)` block**
(immediately after its two existing `it(...)` cases, before that describe's
closing brace) so they inherit its complete `beforeEach` — `me` rejecting
once with 401 then resolving, `register` resolving, `generateCredential`
resolving, and (via the existing `../lib/authDevice.js` mock at the top of
the file) `trySilentLogin` resolving `null` and `credentialSupportIssue`
returning `null`. Do **not** create a second, sibling top-level `describe`
for these tests — that would leave them without this setup (a "leaky
describe") since none of the existing mocks are configured at the module's
top level. Add only:

```javascript
const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock('wouter-preact', () => ({
  useLocation: () => [`${window.location.pathname}${window.location.search}`, navigate]
}));

import { LoginPage } from './LoginPage.jsx';
// (safeNextPath is no longer imported or re-exported here)
```

near the top (alongside the other `vi.mock` calls / import), then nest inside
the existing outer describe:

```javascript
describe('LoginPage generic account creation', () => {
  // ...existing beforeEach and two existing `it(...)` cases, unchanged...

  describe('generic return destinations', () => {
    beforeEach(() => navigate.mockReset());

    it('auto-redirects to an explicit local next destination after account creation', async () => {
      window.history.pushState({}, '', '/login?next=%2Fapp%2Fcheckin');
      render(<LoginPage />);

      fireEvent.click(await screen.findByRole('button', { name: 'Create an account' }));
      fireEvent.input(await screen.findByLabelText('Your display name'), { target: { value: 'Guest' } });
      fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

      await waitFor(() => expect(navigate).toHaveBeenCalledWith('/app/checkin', { replace: true }));
      expect(screen.queryByText(/Welcome,/)).toBeNull();
    });

    it('shows the generic account confirmation view when next is absent', async () => {
      window.history.pushState({}, '', '/login');
      render(<LoginPage />);

      fireEvent.click(await screen.findByRole('button', { name: 'Create an account' }));
      fireEvent.input(await screen.findByLabelText('Your display name'), { target: { value: 'Guest' } });
      fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

      await screen.findByText(/Welcome,/);
      expect(navigate).not.toHaveBeenCalled();
    });
  });
});
```

The two test bodies push a URL with (and without) `?next=...` before
rendering, overriding the outer `beforeEach`'s plain `/login` push, so each
test still runs against the outer describe's fully independent mock setup.

- [ ] **Step 6: Verify and commit generic auth return**

```powershell
Set-Location apps\spa
npm test -- src/pages/LoginPage.test.jsx src/lib/safeNextPath.test.js
npm run validate
Set-Location ..\..
git add apps/spa/src/App.jsx `
  apps/spa/src/pages/LoginPage.jsx apps/spa/src/pages/LoginPage.test.jsx `
  apps/spa/src/lib/safeNextPath.js apps/spa/src/lib/safeNextPath.test.js
git commit -m "feat(spa): resume safe auth destinations" `
  -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 4: Add the Umbrella Check-in Page

**Files:**
- Modify: `apps/spa/src/lib/api.js`
- Create: `apps/spa/src/lib/checkinLink.js`
- Create: `apps/spa/src/lib/checkinLink.test.js`
- Modify: `apps/spa/src/pages/CheckinPage.jsx`
- Create: `apps/spa/src/pages/CheckinPage.test.jsx`

- [ ] **Step 1: Write failing optional-ID tests**

Test parsing:

```javascript
expect(optionalMeetingId('')).toBeNull();
expect(optionalMeetingId('?meetingId=42')).toBe(42);
expect(() => optionalMeetingId('?meetingId=0')).toThrow('This check-in link is invalid.');
expect(() => optionalMeetingId('?meetingId=nope')).toThrow('This check-in link is invalid.');
```

The implementation (Step 2) and this test must keep using the exact same
message string, `This check-in link is invalid.`, since `CheckinPage` renders
it verbatim as the user-visible error.

- [ ] **Step 2: Implement optional parsing and API**

```javascript
export function optionalMeetingId(search) {
  const raw = new URLSearchParams(search).get('meetingId');
  if (raw === null) return null;
  if (!/^\d+$/.test(raw)) throw new Error('This check-in link is invalid.');
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error('This check-in link is invalid.');
  }
  return id;
}
```

Add:

```javascript
umbrella: (meetingId) => request('/api/checkin', {
  method: 'POST',
  body: meetingId === null ? {} : { meeting_id: meetingId }
})
```

- [ ] **Step 3: Write failing page tests**

Test that no query sends `{}`, explicit ID sends `{meeting_id: 42}`, and both
redirect using the backend response:

```javascript
umbrella.mockResolvedValue({ checked_in: true, meeting_id: 17 });
expect(navigate).toHaveBeenCalledWith('/app/meetings/17', { replace: true });
```

- [ ] **Step 4: Implement the page**

Parse the optional ID, call the umbrella endpoint, store the returned ID in
`sessionStorage`, and redirect to the returned meeting. Show explicit parser or
API errors; do not select upcoming meetings in the browser.

- [ ] **Step 5: Verify and commit the page**

```powershell
Set-Location apps\spa
npm test -- src/lib/checkinLink.test.js src/pages/CheckinPage.test.jsx
npm run validate
Set-Location ..\..
git add apps/spa/src/lib/api.js apps/spa/src/lib/checkinLink.js `
  apps/spa/src/lib/checkinLink.test.js apps/spa/src/pages/CheckinPage.jsx `
  apps/spa/src/pages/CheckinPage.test.jsx
git commit -m "feat(spa): add umbrella check-in link" `
  -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 5: Keep Mini-program Failure Semantics

**Files:**
- Modify: `apps/miniprogram/pages/checkin/checkin.js`
- Create: `apps/miniprogram/pages/checkin/checkin.test.js`

- [ ] **Step 1: Add the regression test**

Using Node's built-in test runner, prove a rejected check-in does not call
`wx.setStorageSync` or `wx.switchTab`, sets loading false, and shows the failure
toast. Prove success still caches and switches tabs.

- [ ] **Step 2: Verify RED**

```powershell
node --test apps\miniprogram\pages\checkin\checkin.test.js
```

Expected: failure path currently caches and navigates.

- [ ] **Step 3: Propagate check-in rejection**

Remove the inner catch that swallows `api.checkin`; let the existing outer catch
handle the failure before cache/navigation.

- [ ] **Step 4: Verify and commit**

```powershell
node --test apps\miniprogram\pages\checkin\checkin.test.js
git add apps/miniprogram/pages/checkin/checkin.js `
  apps/miniprogram/pages/checkin/checkin.test.js
git commit -m "fix(miniprogram): avoid caching failed check-ins" `
  -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 6: Confirm No QR Generation and Align Check-in Documentation

Verified against this branch's actual base — the commit that
`git merge-base HEAD origin/agents/deeplink-checkin-qr-code-integration`
resolves to, i.e. the last commit shared with the remote integration branch
before this branch's own documentation-only planning commits (none of which
touch `apps/spa`, `apps/backend`, or `design/`, so they cannot have changed
this answer) — there is no `qrcode` dependency in `apps/spa/package.json` or
`package-lock.json`, no `apps/spa/src/components/CheckinQrDialog.jsx`, no
`canShareCheckin` anywhere in `apps/spa`, and no QR button/state/render block
in `EditorPage.jsx`. This stacked branch's clean base never introduced any of
that, so there is nothing to uninstall, delete, or edit — this task only
confirms the absence and brings `design/functionalities/check_in.md` (the
real, existing check-in design doc) up to date with the umbrella deeplink.

**Both `agents/optional-club-name` and `agents/deeplink-checkin-qr-code-integration`
are local branches that may have moved or diverged from their remotes by the
time this plan is executed** (either from local commits never pushed, or from
the remote advancing without a local fetch/merge). Never treat either local
branch name as ground truth for "this branch's base" or for isolation/push
diffing — always compare against the fetched `origin/agents/deeplink-checkin-qr-code-integration`,
as this task and Task 7 do.

**Files:**
- Modify: `design/functionalities/check_in.md`

- [ ] **Step 1: Verify absence of QR-generation artifacts**

Scope this to tracked SPA source and manifests only — a broad `rg` across
`apps/spa` would also match `apps/spa/node_modules/qrcode/*` (a transitive
dependency of an unrelated package, currently present in this branch's
installed `node_modules`), producing a false positive:

```powershell
git grep -n -E "CheckinQrDialog|canShareCheckin|from ['""]qrcode|""qrcode""[[:space:]]*:" -- apps/spa
```

Expected: exit code 1 (no matches) — `git grep` only searches tracked files,
so it never sees `node_modules`. Deliberately excludes `apps/backend` and
`design/`: `apps/backend/src/handlers.rs` legitimately contains the unrelated
string "Scan our WeChat group QR code", and `apps/spa/src/pages/AgendaPage.jsx`
legitimately references a `/static/Guest Fee QRCode.png` image for an
unrelated existing feature — neither indicates QR *generation* for check-in
and neither should fail this gate.

- [ ] **Step 2: Update check-in documentation**

In `design/functionalities/check_in.md`, add a new subsection after "## Mini
Program Pages" (before "## API") documenting the web umbrella deeplink:

```markdown
## Web Check-in Deeplink

The web SPA exposes one stable check-in URL, `/app/checkin`, with an optional
`meetingId` query selecting a specific meeting:

- `/app/checkin` — the backend resolves the currently open incoming meeting:
  the earliest `published` meeting whose window is `[start - 30 minutes, end]`
  (a blank scheduled end time is treated as the scheduled start — no duration
  is invented), local service date/time, earliest-start-then-lowest-ID on ties.
- `/app/checkin?meetingId=<id>` — checks into that exact meeting; the meeting
  must exist and be `published`, otherwise the page shows not found or a
  conflict respectively. An invalid (non-positive or non-numeric) `meetingId`
  shows `This check-in link is invalid.` without calling the backend.
- The page always calls the same `POST /api/checkin`, stores the returned
  `meeting_id`, and redirects to `/app/meetings/<meeting_id>`.
- Authentication is the generic login flow (no check-in-specific login copy):
  an unauthenticated visitor is sent to login with the complete destination
  (path + query) preserved as `next`, and returns there automatically once
  signed in.
- MISU does not generate QR codes for check-in; organizers may encode either
  URL form with any external tool.
```

Update the existing "## API" section's check-in block to add the umbrella
endpoint alongside the unchanged meeting-specific one:

```markdown
POST /api/checkin
  body: { meeting_id?: number }
  -> { checked_in: true, meeting_id: number }
```

- Requires the same authenticated `user.id` as the meeting-specific endpoint.
- With `meeting_id`: the meeting must exist (`404` otherwise) and be
  `published` (`409` otherwise), then records attendance for it.
- Without `meeting_id`: automatically selects the open incoming `published`
  meeting as described above, or `409` when none is open.
- Shares only the attendance-recording step with
  `POST /api/meetings/:id/checkin`; that endpoint keeps its existing
  existence-only requirement (no new `published` requirement).

- [ ] **Step 3: Verify and commit**

```powershell
git grep -n -E "CheckinQrDialog|canShareCheckin|from ['""]qrcode|""qrcode""[[:space:]]*:" -- apps/spa
git add design/functionalities/check_in.md
git commit -m "docs: describe umbrella check-in deeplink" `
  -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

Expected: exit code 1 (still no matches) — this task adds documentation
only and confirms, rather than changes, the absence of QR generation.

## Task 7: Validate and Publish the Stacked PR

**Files:**
- No source changes.

- [ ] **Step 1: Verify diff isolation**

```powershell
git diff --name-only origin/agents/deeplink-checkin-qr-code-integration..HEAD
git -c core.whitespace=cr-at-eol diff --check origin/agents/deeplink-checkin-qr-code-integration..HEAD
```

Always diff against the pushed remote base
`origin/agents/deeplink-checkin-qr-code-integration` — that is the actual base
PR #1 was opened against, and what GitHub uses to compute this PR's diff.
**Do not substitute either local branch name for this remote ref.** Both
local `agents/optional-club-name` and local `agents/deeplink-checkin-qr-code-integration`
are branches whose tips can drift from their remotes at any time (unpushed
local commits, or the remote advancing without a local fetch/merge) — a
local branch name that "happens to" point at the right commit today is not a
substitute for fetching and diffing against the actual remote ref. Always
`git fetch origin` first if there is any doubt, then diff/isolate against
`origin/agents/deeplink-checkin-qr-code-integration` specifically.

Expected: no migration/profile-only files unless required by generic auth
integration; no QR-generation files remain (there were none to begin with —
see Task 6).

- [ ] **Step 2: Run complete validation**

```powershell
Set-Location apps\backend
cargo fmt --check
cargo test
Set-Location ..\spa
npm run validate
Set-Location ..\..
node --test apps\miniprogram\pages\checkin\checkin.test.js
```

- [ ] **Step 3: Push and create the stacked PR**

```powershell
git push -u origin agents/umbrella-checkin-deeplink
```

Create a PR titled `check-in: add umbrella deeplink` with:

- base: `agents/deeplink-checkin-qr-code-integration`;
- head: `agents/umbrella-checkin-deeplink`;
- summary of umbrella resolution and generic auth return;
- test results;
- note that it is stacked on PR #1.
