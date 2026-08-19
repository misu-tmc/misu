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

- [ ] **Step 1: Write failing meeting-window tests**

Create a pure helper:

```rust
fn checkin_window_contains(
    start: NaiveDateTime,
    end: NaiveDateTime,
    now: NaiveDateTime,
) -> bool
```

Test before open, exactly `start - 30 minutes`, during, exactly at end, and
after end:

```rust
assert!(!checkin_window_contains(start, end, start - TimeDelta::minutes(31)));
assert!(checkin_window_contains(start, end, start - TimeDelta::minutes(30)));
assert!(checkin_window_contains(start, end, start));
assert!(checkin_window_contains(start, end, end));
assert!(!checkin_window_contains(start, end, end + TimeDelta::minutes(1)));
```

- [ ] **Step 2: Verify RED**

```powershell
Set-Location apps\backend
cargo test checkin_window
```

Expected: helper does not exist.

- [ ] **Step 3: Implement incoming meeting selection**

Add:

```rust
pub async fn incoming_published_id(
    pool: &MySqlPool,
    now: chrono::NaiveDateTime,
) -> AppResult<Option<i64>> {
    sqlx::query_scalar(
        "SELECT id FROM meeting \
         WHERE status = 'published' \
           AND TIMESTAMP(date, start_time) <= DATE_ADD(?, INTERVAL 30 MINUTE) \
           AND TIMESTAMP(date, end_time) >= ? \
         ORDER BY TIMESTAMP(date, start_time), id \
         LIMIT 1",
    )
    .bind(now)
    .bind(now)
    .fetch_optional(pool)
    .await
    .map_err(Into::into)
}
```

Keep the pure boundary helper for deterministic unit coverage and use the same
inclusive boundaries in SQL.

- [ ] **Step 4: Write failing umbrella request tests**

Add request-resolution tests for:

```rust
#[derive(Deserialize)]
pub struct CheckinReq {
    pub meeting_id: Option<i64>,
}
```

Validate explicit IDs as positive. Test that missing IDs request automatic
resolution and invalid IDs return `BadRequest`.

- [ ] **Step 5: Extract shared attendance recording**

Use:

```rust
async fn record_checkin(
    pool: &MySqlPool,
    user_id: i64,
    meeting_id: i64,
) -> AppResult<()> {
    ensure_checkin_open(load_status(pool, meeting_id).await?.as_deref())?;
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

The existing meeting-specific handler calls this helper.

- [ ] **Step 6: Add `POST /api/checkin`**

Resolve:

```rust
let meeting_id = match req.meeting_id {
    Some(id) if id > 0 => id,
    Some(_) => return Err(AppError::BadRequest("invalid meeting id".into())),
    None => meetings::incoming_published_id(
        &state.pool,
        chrono::Local::now().naive_local(),
    )
    .await?
    .ok_or_else(|| AppError::Conflict("no meeting is open for check-in".into()))?,
};
record_checkin(&state.pool, user.id, meeting_id).await?;
Ok(Json(json!({ "checked_in": true, "meeting_id": meeting_id })))
```

Register `.route("/api/checkin", post(handlers::umbrella_checkin))`.

- [ ] **Step 7: Verify and commit backend deeplink support**

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

- [ ] **Step 1: Write failing full-query redirect test**

Test:

```javascript
expect(loginRedirectUrl('/app/checkin', '?meetingId=42', false))
  .toBe('/login?next=%2Fapp%2Fcheckin%3FmeetingId%3D42');
```

- [ ] **Step 2: Preserve the complete protected destination**

Build the login target from Wouter's pathname plus
`window.location.search`. Keep development `/app/login` and production
`/login`.

- [ ] **Step 3: Write failing generic return tests**

Test that:

- a normal local `next` returns after account creation;
- `/app/checkin` is not rendered with special guest copy or a special form;
- missing `next` retains the account confirmation page;
- protocol-relative, backslash/control-character, and normalized-dot-segment
  off-origin values fall back to `/app/booking`.

- [ ] **Step 4: Implement one generic safe-next helper**

Parse against a fixed base, require the same origin, require a normalized
pathname beginning with exactly one slash, and return pathname + search + hash.
Also return whether the query contained an explicit `next`.

Use the helper in `LoginPage`. Remove `isCheckinPath`, `checkinIntent`, the
`guest` view, and all check-in-specific copy. In `finish`:

```javascript
if (hasExplicitNext) {
  navigate(nextPath, { replace: true });
  return;
}
setView('account');
```

The generic create form from PR 1 continues collecting name and optional club.

- [ ] **Step 5: Verify and commit generic auth return**

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
expect(() => optionalMeetingId('?meetingId=0')).toThrow('invalid meeting id');
expect(() => optionalMeetingId('?meetingId=nope')).toThrow('invalid meeting id');
```

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

## Task 6: Remove QR Generation and Align Documentation

**Files:**
- Modify: `apps/spa/package.json`
- Modify: `apps/spa/package-lock.json`
- Modify: `apps/spa/src/pages/EditorPage.jsx`
- Modify: `apps/spa/src/lib/editorModel.js`
- Modify: `apps/spa/src/lib/editorModel.test.js`
- Modify: `apps/spa/css/components.css`
- Delete: `apps/spa/src/components/CheckinQrDialog.jsx`
- Delete: `apps/spa/src/components/CheckinQrDialog.test.jsx`
- Modify: `design/functionalities/check_in.md`

- [ ] **Step 1: Remove the QR dependency with npm**

```powershell
Set-Location apps\spa
npm uninstall qrcode
```

- [ ] **Step 2: Remove QR UI and helpers**

Delete the dialog and tests. Remove its import, state, trigger, focus handling,
and render block from `EditorPage`. Remove `canShareCheckin` and its tests.
Remove only `.checkin-qr-*` CSS.

- [ ] **Step 3: Update check-in documentation**

Document `/app/checkin` as the stable umbrella URL, optional `meetingId`,
service-side 30-minute meeting selection, generic auth return, and the explicit
absence of QR generation.

- [ ] **Step 4: Verify absence and commit**

```powershell
rg "CheckinQrDialog|canShareCheckin|from 'qrcode'|\"qrcode\"" apps\spa
Set-Location apps\spa
npm run validate
Set-Location ..\..
git add apps/spa design/functionalities/check_in.md
git commit -m "refactor(spa): remove check-in QR generation" `
  -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

Expected: ripgrep returns no QR-generation references.

## Task 7: Validate and Publish the Stacked PR

**Files:**
- No source changes.

- [ ] **Step 1: Verify diff isolation**

```powershell
git diff --name-only agents/optional-club-name..HEAD
git -c core.whitespace=cr-at-eol diff --check agents/optional-club-name..HEAD
```

Expected: no migration/profile-only files unless required by generic auth
integration; no QR-generation files remain.

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
