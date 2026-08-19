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

- [ ] **Step 1: Write failing meeting-window tests**

Add to `apps/backend/src/meetings.rs`, a pure helper:

```rust
/// Does `now` fall in the inclusive check-in window `[start - 30 minutes, end]`?
/// `end` may equal `start` when a meeting's `end_time` is blank (see
/// `incoming_published_id`) — no duration is invented for a missing end time.
fn checkin_window_contains(
    start: chrono::NaiveDateTime,
    end: chrono::NaiveDateTime,
    now: chrono::NaiveDateTime,
) -> bool {
    now >= start - chrono::Duration::minutes(30) && now <= end
}
```

Test before open, exactly `start - 30 minutes`, during, exactly at end, and
after end, plus the blank-end boundary (`end == start`, no invented duration):

```rust
assert!(!checkin_window_contains(start, end, start - chrono::Duration::minutes(31)));
assert!(checkin_window_contains(start, end, start - chrono::Duration::minutes(30)));
assert!(checkin_window_contains(start, end, start));
assert!(checkin_window_contains(start, end, end));
assert!(!checkin_window_contains(start, end, end + chrono::Duration::minutes(1)));

// Blank end_time resolves to end == start (see incoming_published_id's SQL):
// the window is exactly [start - 30 minutes, start], nothing invented.
assert!(!checkin_window_contains(start, start, start - chrono::Duration::minutes(31)));
assert!(checkin_window_contains(start, start, start - chrono::Duration::minutes(30)));
assert!(checkin_window_contains(start, start, start));
assert!(!checkin_window_contains(start, start, start + chrono::Duration::minutes(1)));
```

- [ ] **Step 2: Verify RED**

```powershell
Set-Location apps\backend
cargo test checkin_window
```

Expected: helper does not exist.

- [ ] **Step 3: Implement incoming meeting selection and shared helpers**

Add to `apps/backend/src/meetings.rs` (update its `use` line to
`use crate::error::{AppError, AppResult};`):

```rust
/// Earliest published meeting whose check-in window contains `now`, if any.
/// A blank `end_time` (see the `meeting` table's `DEFAULT ''`) is treated as
/// the scheduled start time — `COALESCE(NULLIF(end_time, ''), start_time)` —
/// matching `checkin_window_contains`'s blank-end boundary; no duration is
/// invented for a meeting with no explicit end time.
pub async fn incoming_published_id(
    pool: &MySqlPool,
    now: chrono::NaiveDateTime,
) -> AppResult<Option<i64>> {
    sqlx::query_scalar(
        "SELECT id FROM meeting \
         WHERE status = 'published' \
           AND TIMESTAMP(date, start_time) <= DATE_ADD(?, INTERVAL 30 MINUTE) \
           AND TIMESTAMP(date, COALESCE(NULLIF(end_time, ''), start_time)) >= ? \
         ORDER BY TIMESTAMP(date, start_time), id \
         LIMIT 1",
    )
    .bind(now)
    .bind(now)
    .fetch_optional(pool)
    .await
    .map_err(Into::into)
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
/// (no-ID) path never calls this — `incoming_published_id`'s query already
/// filters to `status = 'published'`.
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

Add unit tests (in `meetings.rs`, alongside `checkin_window_contains`'s test
module) for the pure validation helper — `load_status` and
`incoming_published_id` hit the database, so, matching this crate's existing
convention (see `handlers.rs`'s `ensure_self`/`resolve_club_name` tests), only
the pure function is unit-tested directly:

```rust
assert!(matches!(ensure_open_for_checkin(None), Err(AppError::NotFound)));
assert!(ensure_open_for_checkin(Some("published")).is_ok());
assert!(matches!(ensure_open_for_checkin(Some("draft")), Err(AppError::Conflict(_))));
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

Add, in `handlers.rs`:

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
```

Add unit tests for `resolve_requested_meeting_id` (same pure-function pattern
as Step 3):

```rust
assert_eq!(resolve_requested_meeting_id(None).unwrap(), None);
assert_eq!(resolve_requested_meeting_id(Some(42)).unwrap(), Some(42));
assert!(matches!(resolve_requested_meeting_id(Some(0)), Err(AppError::BadRequest(_))));
assert!(matches!(resolve_requested_meeting_id(Some(-1)), Err(AppError::BadRequest(_))));
```

- [ ] **Step 6: Verify RED**

```powershell
Set-Location apps\backend
cargo test resolve_requested_meeting_id
```

Expected: helper does not exist.

- [ ] **Step 7: Add `POST /api/checkin`**

In `handlers.rs`:

```rust
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
            .ok_or_else(|| AppError::Conflict("no meeting is open for check-in".into()))?,
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
- Create: `apps/spa/src/App.test.jsx`
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
builder:

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

In `apps/spa/src/App.test.jsx` (new file), prove `LoginRedirect` no longer
drops the query string:

```javascript
import { render, waitFor } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { me } = vi.hoisted(() => ({ me: vi.fn() }));

vi.mock('./lib/api.js', () => ({ authApi: { me } }));
vi.mock('./lib/authDevice.js', () => ({ trySilentLogin: vi.fn(() => Promise.resolve(null)) }));

import { App } from './App.jsx';
import { authReady, authUser } from './state/auth.js';

describe('unauthenticated protected routes', () => {
  beforeEach(() => {
    authReady.value = false;
    authUser.value = null;
    me.mockReset().mockRejectedValue(new Error('unauthenticated'));
  });

  it('preserves the full protected destination through the login redirect', async () => {
    window.history.pushState({}, '', '/app/checkin?meetingId=42');
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {});

    render(<App />);

    await waitFor(() => expect(assign).toHaveBeenCalled());
    const target = new URL(assign.mock.calls[0][0], window.location.origin);
    expect(target.searchParams.get('next')).toBe('/app/checkin?meetingId=42');
  });
});
```

- [ ] **Step 2: Verify RED**

```powershell
Set-Location apps\spa
npm test -- src/lib/safeNextPath.test.js src/App.test.jsx
Set-Location ..\..
```

Expected: `safeNextPath.js` does not exist yet, and `LoginRedirect` still drops
the query string, so `next` decodes to `/app/checkin` instead of
`/app/checkin?meetingId=42`.

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

In `apps/spa/src/pages/LoginPage.test.jsx`: remove the `describe('safeNextPath', ...)`
block and the `safeNextPath` import (moved to `safeNextPath.test.js` in Step
3), mock `wouter-preact`'s `useLocation` the same way
`EditorPage.test.jsx` does, and add:

```javascript
const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock('wouter-preact', () => ({
  useLocation: () => [`${window.location.pathname}${window.location.search}`, navigate]
}));

import { LoginPage } from './LoginPage.jsx';
// (safeNextPath is no longer imported or re-exported here)

describe('LoginPage generic return destinations', () => {
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
```

- [ ] **Step 6: Verify and commit generic auth return**

```powershell
Set-Location apps\spa
npm test -- src/App.test.jsx src/pages/LoginPage.test.jsx `
  src/lib/safeNextPath.test.js
npm run validate
Set-Location ..\..
git add apps/spa/src/App.jsx apps/spa/src/App.test.jsx `
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

Verified against this branch's actual base (`git merge-base HEAD
origin/agents/deeplink-checkin-qr-code-integration`, which equals `HEAD~1`
here): there is no `qrcode` dependency in `apps/spa/package.json` or
`package-lock.json`, no `apps/spa/src/components/CheckinQrDialog.jsx`, no
`canShareCheckin` anywhere in `apps/spa`, and no QR button/state/render block
in `EditorPage.jsx`. This stacked branch's clean base never introduced any of
that, so there is nothing to uninstall, delete, or edit — this task only
confirms the absence and brings `design/functionalities/check_in.md` (the
real, existing check-in design doc) up to date with the umbrella deeplink.

**Files:**
- Modify: `design/functionalities/check_in.md`

- [ ] **Step 1: Verify absence of QR-generation artifacts**

```powershell
rg -n "qrcode|CheckinQrDialog|canShareCheckin" apps\spa apps\backend design
```

Expected: no matches (`rg` exits non-zero when nothing is found).

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
```

- [ ] **Step 3: Verify and commit**

```powershell
rg -n "qrcode|CheckinQrDialog|canShareCheckin" apps\spa apps\backend design
git add design/functionalities/check_in.md
git commit -m "docs: describe umbrella check-in deeplink" `
  -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

Expected: ripgrep still returns no matches — this task adds documentation
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
PR #1 was opened against, and what GitHub uses to compute this PR's diff. The
local branch `agents/optional-club-name` happens to point at the same commit
today, but its name is a stale, local-only artifact of branch setup; do not
rely on it for diff isolation.

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
