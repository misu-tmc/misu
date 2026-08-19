# Check in

This is the page for authenticated attendees to confirm they came to a published meeting.
Check-in has three purposes:

1. **Track attendance** — a durable record of who came to each meeting.
2. **Link attendees to raw user records** — users are often raw `{id, display_name}` rows
   admins typed in (as role assignees). Check-in makes real, WeChat-authenticated
   people linkable to those raw records.
3. **Feed the voting page** — provide the pool of attendees and resolved role takers.

Check-in must not create anonymous or dropped-identifier users. The attendee signs in
first via the active provider: the generic passkey account flow on web (`/login`,
shared by every protected route, not a check-in-specific form), and the WeChat
launch-time login on the mini program. Only after auth resolves a `user.id` does the
check-in page load.

The page is mobile-centric because the main scenario is opening a meeting link from
the WeChat mini program or a shared web URL. **MISU does not generate QR codes.**
There is no `qrcode` dependency, encoder, or QR-editing UI anywhere in `apps/spa`, the
backend, or the mini program. The canonical check-in URL —
`/app/checkin`, optionally with `?meetingId=<id>` — is a plain link; an admin who wants
a scannable poster encodes that URL with an external tool. MISU only owns the link's
behavior, never the code's pixels.

## Design decision: presence-only check-in, admin-driven linking

Check-in stays a **one-tap presence** action. Attendees do **not** self-select a role or a
raw identity at check-in — that removes the riskiest interaction (a person picking the
wrong identity) and keeps the mini program simple.

Identity **linking** (purpose #2) is an **admin action**: an admin links a free raw user
record to a WeChat identity that was present in the meeting, or ignores the raw record.
Raw users keep working exactly as before for agenda and voting, because they already are
the `role_assignment.taker_id`. Voting keeps reading those regardless of
whether linking happened.

If self-service claiming is wanted later, it can be layered on top without changing this
data model (a claim would trigger the same merge operation an admin link performs).

## Interaction model

Check-in is not a separate form. It is a one-tap status on the Meeting tab, and the
umbrella deep link (`/app/checkin`) automatically records the same status before
redirecting into that meeting. Auth is fully generic: the link is just another
protected route, gated by the same `ProtectedApp` guard as every other `/app/*` page.
There is no check-in-specific login screen or dialogue.

- **Not signed in**: the guard redirects to `/login` (or `/app/login` in dev) with
  `?next=<original path and query>`. `next` is sanitized to a same-origin,
  non-login path — anything unsafe or absent falls back to the generic
  `/app/booking` default. After the generic account flow completes, an explicit safe
  `next` sends the user straight back to `/app/checkin?...` (skipping the normal
  "device connected" welcome screen); no explicit `next` (or a stripped-out unsafe one)
  lands on that welcome screen instead.
- **No account yet**: account creation is the same generic form every new device uses —
  a required `display_name` and an optional `club_name` (added in an earlier stacked
  change) — not a check-in-specific registration step.
- **Signed in**: `CheckinPage` calls `POST /api/checkin` with the optional `meetingId`
  from the query string, then navigates to `/app/meetings/<meeting_id>` using the
  **meeting ID the backend returned**, never the client-supplied one.

```mermaid
flowchart TD
    L[Open /app/checkin?meetingId=optional] --> A[Generic protected-route auth guard]
    A -->|not signed in| S[/login?next=/app/checkin...]
    S -->|sign in or create account| A
    A -->|signed in| C[POST /api/checkin]
    C -->|resolved meeting_id| M[Navigate to /app/meetings/:meeting_id]
    C -->|409/404/400| E[Show error, stay on /app/checkin]
```

### Meeting tab status

```
┌─────────────────────────────────────┐
│  MISU · Meeting #142                 │
│  Sat Jul 12 · Embrace Change         │
├─────────────────────────────────────┤
│  [ Checked in ]  [ Vote ] [ Timer ]  │
└─────────────────────────────────────┘
```

### Details

- **Meeting tab button** (`MeetingPage`): starts as **Check in**. Tapping it calls
  `POST /api/meetings/:id/checkin` for the meeting already open on that page, records
  attendance for the current `user.id`, and turns green **Checked in**.
- **Web umbrella link** (`/app/checkin`, see `CheckinPage.jsx`): a silent redirector —
  it calls `POST /api/checkin` once, then navigates straight to
  `/app/meetings/<meeting_id>` (using the server-resolved ID) where the Meeting tab
  shows **Checked in**. It never renders its own check-in form; on failure it shows the
  backend's error message in place and does not navigate.
- **No role selection**: booked roles are not selected or corrected here. Role linking is
  an admin action (see below), not part of check-in.
- **Name/club stays with the account, not check-in**: neither `/api/checkin` nor
  `/api/meetings/:id/checkin` accept a name or club field. Editing `display_name` /
  `club_name` is a separate, generic account-profile action; check-in itself only ever
  records presence for the already-resolved `user.id`.
- **Persistence**: attendance is stored server-side. Any client-side storage (mini
  program's `checkin:<meetingId>:<userId>` cache) is only an optimistic fallback for the
  button state, never the source of truth.

## Mini Program Pages

Entry points:
- Meeting tab's **Check in** action (`goCheckIn` in `pages/meeting/meeting.js`) records
  attendance in place via `POST /api/meetings/:id/checkin`.
- A shared link can deep-link to `/pages/checkin/checkin?meetingId=<id>`
  (`pages/checkin/checkin.js`); that page is a silent redirector to the Meeting tab
  after recording attendance. Unlike the web umbrella link, this page resolves its own
  meeting when `meetingId` is absent — it calls `GET /api/meetings/upcoming` and picks
  the first result — then calls the **existing meeting-specific**
  `POST /api/meetings/:id/checkin`, not `/api/checkin`.

Page states:

1. **Meeting tab loading** — wait for WeChat auth session and load the active/upcoming
   meeting.
2. **Not checked in** — show **Check in**.
3. **Checked in** — show green **Checked in**.

### Mini program cache semantics

Both `pages/checkin/checkin.js` and `pages/meeting/meeting.js` write the same
`checkin:<meetingId>:<userId>` `wx.storage` key as `{ meetingId, userId, confirmedAt }`
— but only **after** the `POST /api/meetings/:id/checkin` call resolves successfully.
A rejected check-in call must never write this key or switch tabs: it is caught by the
page's outer `catch`, which clears the loading state and shows a `加载失败` (or
`请先登录` when the user still has no auth token) toast instead. `meeting.js` uses the
cached entry only as an immediate, optimistic **first paint** while
`GET /api/meetings/:id/checkin` is in flight, then overwrites it with that call's
authoritative `checked_in` value; if the status call itself fails, the cached value is
kept as a last-resort fallback rather than forcing "not checked in".

## API

```
GET  /api/meetings/:id/checkin
  -> { checked_in: bool }

POST /api/meetings/:id/checkin
  -> { checked_in: true }

POST /api/checkin
  body: { meeting_id?: number }           // omit to let the server pick the open meeting
  -> { checked_in: true, meeting_id: number }
```

- All three require an authenticated `user.id` (bearer or cookie via the shared auth
  guard). None of them accept a display-name or club field.
- Every variant upserts one `attendance` row per `(meeting_id, user_id)` with
  `source = 'self'` (`ON DUPLICATE KEY UPDATE checked_in_at = ...`). It is idempotent:
  checking in again just refreshes `checked_in_at`.
- No `role_slot_id` is involved. Attendance never touches `role_assignment`.
- `GET`/`POST /api/meetings/:id/checkin` are unchanged from before this deep link — they
  remain the endpoint `MeetingPage` and the mini program use for a meeting the caller
  already knows the ID of. A missing meeting is a 404.

### `POST /api/checkin` meeting resolution

`meeting_id` is optional in the request body:

- **Explicit `meeting_id`** (must be a positive integer, otherwise 400 Bad Request): the
  meeting must exist (404 if not) and must be `status = 'published'` — any other status,
  including `draft`, is a 409 Conflict ("This meeting is not open for check-in."). The
  response's `meeting_id` always echoes this same ID; the SPA still navigates using the
  response value rather than the request value, so the client never has to trust its
  own input.
- **Omitted `meeting_id`** (automatic resolution): the server loads every `published`
  meeting scheduled from yesterday through tomorrow (a generous date-only prefilter),
  then picks the **earliest-starting** one whose check-in window contains the current
  local time, breaking ties by meeting ID. A meeting's check-in window is
  **inclusive of `start_time − 30 minutes` through its scheduled `end_time`**:
  - A blank `end_time` is treated as equal to `start_time` (no invented duration).
  - An `end_time` that parses earlier than `start_time` is an overnight meeting (e.g.
    23:00–00:30); its end rolls over to the next calendar day.
  - A candidate whose `date`/`start_time`/`end_time` fails to parse is a data-integrity
    bug in that one row, not a reason to fail check-in for everyone: it is logged via
    `tracing::error!` (with the meeting ID and parse error) and excluded, while every
    other well-formed candidate is still considered.
  - If no candidate's window contains now (including because every candidate was
    excluded as unschedulable), the response is a 409 Conflict ("No meeting is
    currently open for check-in.").

### Admin linking API

```
POST /api/admin/meetings/:id/link
  body: { raw_user_id: number, wechat_user_id: number }
  -> { merged_user_id, ok: true } | 409 conflict

POST /api/admin/meetings/:id/unlink
  body: { user_id: number }
  -> moves the wechat_identity + session to a fresh empty user, freeing the raw record
```

`link` connects a **free** raw user (no `wechat_identity`) to a WeChat identity present in
the meeting (has an `attendance` row), performing the merge operation below.

## Merge operation (admin link)

Links WeChat row `U` onto free raw user `T` by repointing every reference, then removing
the emptied shell:

1. **Guard**: if `T` already has a `wechat_identity` (a different person), **abort** with a
   conflict — never overwrite an existing linked identity.
2. `wechat_identity`: point `U`'s openid at `T`.
3. `auth_session`: repoint `U -> T` (the session stays valid, now resolving to `T`).
4. `role_assignment` (`taker_id`) and `attendance`: repoint `U -> T`.
5. `T.display_name`: keep or update to the confirmed name.
6. Delete `U` **only if provably empty** (no identity, session, assignment or attendance
   references remain).

Unlink is the inverse: detach the `wechat_identity` (and its live session) onto a new
empty user so the person keeps a login, and the raw record becomes free again.

## Schema mapping

- **Identity** → the authenticated `user.id` from `current_identity()`. Check-in does
  not write names for other people or create anonymous users.
- **Attendance** → one `attendance` row per person per meeting (see
  `../storage/schema.md`). No-role attendees are represented naturally.
- **Booked/taken roles** → unchanged `role_assignment` rows. Linking makes a raw
  assignee resolve to a real logged-in user; without linking they stay raw.
- **Admin-editable**: admins adjust attendance and identity links afterward — via the
  **Attendance & linking** panel on the meeting editor. All admin-created or admin-edited
  attendance rows use `source = 'admin'`.

## Voting hook

No new work for voting here. The voting page reads `role_assignment.taker_id` for
role-taker candidates and `attendance` for the general attendee pool. This design
guarantees those users are real and de-duplicated once an admin has linked identities.
