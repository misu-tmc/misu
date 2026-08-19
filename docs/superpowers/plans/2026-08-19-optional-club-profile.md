# Optional Club Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a first PR that adds only an optional club name to generic user account creation and profile editing.

**Architecture:** Add one nullable profile column and carry it through existing auth responses. Keep registration and profile editing generic; this PR contains no meeting check-in behavior.

**Tech Stack:** Rust 2021, Axum, SQLx/MySQL, Preact, Vitest/Testing Library.

---

## Task 1: Create the Isolated Club Branch

**Files:**
- Create: `docs/superpowers/specs/2026-08-19-optional-club-profile-design.md`
- Create: `docs/superpowers/plans/2026-08-19-optional-club-profile.md`

- [x] **Step 1: Preserve the full implementation branch**

```powershell
git branch agents/deeplink-checkin-full-backup
git switch -c agents/optional-club-name origin/master
```

Expected: the original full branch remains available as a read-only reference;
the working branch starts exactly at `origin/master`.

- [x] **Step 2: Copy only this specification and plan from the backup**

```powershell
git checkout agents/deeplink-checkin-full-backup -- `
  docs/superpowers/specs/2026-08-19-optional-club-profile-design.md `
  docs/superpowers/plans/2026-08-19-optional-club-profile.md
git add docs/superpowers/specs/2026-08-19-optional-club-profile-design.md `
  docs/superpowers/plans/2026-08-19-optional-club-profile.md
git commit -m "docs: design optional club profiles" `
  -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

Expected: no check-in or umbrella-link document appears in the branch.

Execution resumes at Task 2.

## Task 2: Add the Optional Club Data Contract

**Files:**
- Create: `apps/backend/migrations/0013_user_club_name.sql`
- Modify: `apps/backend/src/models.rs`
- Modify: `apps/backend/src/auth.rs`
- Modify: `apps/backend/src/handlers.rs`

- [ ] **Step 1: Write failing normalization and ownership tests**

Add tests in `auth.rs`:

```rust
#[test]
fn optional_club_is_trimmed_or_cleared() {
    assert_eq!(
        normalize_optional_field(Some("  Other TMC  "), "club name").unwrap(),
        Some("Other TMC".into())
    );
    assert_eq!(
        normalize_optional_field(Some("   "), "club name").unwrap(),
        None
    );
    assert!(normalize_optional_field(Some(&"x".repeat(256)), "club name").is_err());
}
```

Add tests in `handlers.rs`:

```rust
#[test]
fn profile_owner_is_enforced() {
    assert!(ensure_self(7, 7).is_ok());
    assert!(matches!(ensure_self(7, 8), Err(AppError::Unauthorized)));
}

#[test]
fn missing_club_keeps_current_value() {
    assert_eq!(
        resolve_club_name(None, Some("MISU".into())),
        Some("MISU".into())
    );
}
```

- [ ] **Step 2: Verify RED**

```powershell
Set-Location apps\backend
cargo test
```

Expected: compilation fails because the helpers and `club_name` contract do not
exist.

- [ ] **Step 3: Add the migration and response field**

`apps/backend/migrations/0013_user_club_name.sql`:

```sql
ALTER TABLE `user`
    ADD COLUMN club_name VARCHAR(255) NULL AFTER display_name;
```

`UserResponse`:

```rust
pub struct UserResponse {
    pub id: i64,
    pub display_name: String,
    pub club_name: Option<String>,
}
```

- [ ] **Step 4: Normalize and store the field during device registration**

Add:

```rust
pub(crate) fn normalize_optional_field(
    value: Option<&str>,
    label: &str,
) -> Result<Option<String>, AppError> {
    let Some(value) = value else { return Ok(None) };
    let value = value.trim();
    if value.chars().count() > 255 {
        return Err(AppError::BadRequest(format!(
            "{label} must contain at most 255 characters"
        )));
    }
    Ok((!value.is_empty()).then(|| value.to_string()))
}
```

Extend `RegisterDeviceReq` with `#[serde(default)] pub club_name: Option<String>`,
normalize it, and insert:

```rust
sqlx::query("INSERT INTO user(display_name, club_name) VALUES (?, ?)")
    .bind(&display_name)
    .bind(&club_name)
```

Keep user and credential insertion in the existing transaction.

- [ ] **Step 5: Carry club data through all auth providers**

Select and serialize `u.club_name` in:

- `AuthUser`;
- `auth_me`;
- password login;
- WeChat lookup/login;
- device register, verify, and migrate responses.

New WeChat users keep `NULL`.

- [ ] **Step 6: Implement one-query self profile updates**

Use:

```rust
fn ensure_self(auth_user_id: i64, path_user_id: i64) -> AppResult<()> {
    if auth_user_id != path_user_id {
        return Err(AppError::Unauthorized);
    }
    Ok(())
}

fn resolve_club_name(
    update: Option<Option<String>>,
    current: Option<String>,
) -> Option<String> {
    update.unwrap_or(current)
}
```

Deserialize `club_name: Option<String>`. Normalize a supplied value into
`Option<Option<String>>`, resolve it against `AuthUser.club_name`, then execute:

```rust
sqlx::query("UPDATE user SET display_name = ?, club_name = ? WHERE id = ?")
    .bind(&display_name)
    .bind(&club_name)
    .bind(user_id)
    .execute(&state.pool)
    .await?;
```

Return the normalized values directly. Do not add existence probes or follow-up
reads.

- [ ] **Step 7: Verify and commit backend support**

```powershell
Set-Location apps\backend
cargo fmt
cargo fmt --check
cargo test
Set-Location ..\..
git add apps/backend
git commit -m "feat(backend): add optional club profiles" `
  -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

Expected: all backend tests pass.

## Task 3: Add Club to Generic Web Account and Profile Forms

**Files:**
- Modify: `apps/spa/src/lib/api.js`
- Modify: `apps/spa/src/pages/LoginPage.jsx`
- Modify: `apps/spa/src/pages/LoginPage.test.jsx`
- Modify: `apps/spa/src/pages/MePage.jsx`
- Create: `apps/spa/src/pages/MePage.test.jsx`

- [ ] **Step 1: Write failing generic registration tests**

Add a Login page test that opens the normal create view, fills both fields, and
expects:

```javascript
expect(register).toHaveBeenCalledWith({
  display_name: 'Guest',
  club_name: 'Other TMC',
  credential_id: 'credential',
  public_key: 'public-key',
  device_name: 'Phone'
});
```

The test must not use a check-in `next` target.

- [ ] **Step 2: Verify RED**

```powershell
Set-Location apps\spa
npm test -- src/pages/LoginPage.test.jsx
```

Expected: no generic Club field exists and the payload omits `club_name`.

- [ ] **Step 3: Add the generic club field**

In the existing `create` view add:

```jsx
<div class="field">
  <label for="club-name">Club (optional)</label>
  <input
    id="club-name"
    name="club_name"
    maxlength="255"
    autocomplete="organization"
  />
</div>
```

In `createAccount`, trim and send:

```javascript
const clubName = String(data.get('club_name') || '').trim();
await authApi.register({
  display_name: displayName,
  club_name: clubName,
  ...generated.request
});
```

- [ ] **Step 4: Write failing profile tests**

Test that the profile loads `club_name`, sends:

```javascript
{
  display_name: 'Guest',
  club_name: 'New Club'
}
```

and sends `club_name: ''` when cleared.

- [ ] **Step 5: Implement profile editing**

Change `usersApi.update` to accept a profile object. Add local club state and the
optional input to `MePage`; trim both fields, submit the object, then synchronize
the auth signal and local fields from the response.

- [ ] **Step 6: Verify and commit the SPA**

```powershell
Set-Location apps\spa
npm run validate
Set-Location ..\..
git add apps/spa/src/lib/api.js apps/spa/src/pages/LoginPage.jsx `
  apps/spa/src/pages/LoginPage.test.jsx apps/spa/src/pages/MePage.jsx `
  apps/spa/src/pages/MePage.test.jsx
git commit -m "feat(spa): edit optional club profiles" `
  -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 4: Publish Optional Club PR

**Files:**
- No source changes.

- [ ] **Step 1: Verify independent branch scope**

```powershell
git -c core.whitespace=cr-at-eol diff --check origin/master..HEAD
git diff --name-only origin/master..HEAD
```

Expected: only optional-club backend, generic auth/profile SPA, tests, and this
PR's spec/plan.

- [ ] **Step 2: Run full independent validation**

```powershell
Set-Location apps\backend
cargo fmt --check
cargo test
Set-Location ..\spa
npm run validate
```

- [ ] **Step 3: Repurpose PR #1 safely**

```powershell
git push --force-with-lease `
  origin HEAD:agents/deeplink-checkin-qr-code-integration
```

Update PR #1 title to `profiles: add optional club name` and replace its body
with the optional-club summary and test results.
