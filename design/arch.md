# Architecture overview

The service has two UI surfaces over one shared backend/domain model.

## Surface split

### WeChat mini program

The mini program is the primary attendee/member surface. It should optimize for phone
use before and during meetings.

Likely mini-program flows:

- Role booking.
- Check-in / actual role confirmation.
- Meeting publish review and lightweight publish actions.
- Voting page publish and voting.
- Timer's tool.

Meeting publish in the mini program should stay lightweight: review, quick corrections
and publish actions. The full session editor does not need to be mini-program-first.

### Web

The web app is the admin workspace. It should optimize for structured editing,
previewing and management tasks that are easier on desktop.

Likely web flows:

- Meeting publish with the full meeting/session editor.
- Agenda preview and publish.
- User management and permission assignment.

## Shared backend

Both surfaces should call the same backend operations and use the same SQLite-backed
domain model. Do not duplicate meeting, booking, auth or permission rules in each
frontend.

Core service boundaries:

- **Auth**: resolves the current `user.id` through the active provider.
- **Permissions**: every action only requires an authenticated `user.id`; no scopes yet.
- **Meeting**: creates drafts, edits sessions/role slots and publishes meetings.
- **Role booking**: lists upcoming published meetings and books/cancels roles.
- **Agenda**: renders preview and published agenda output.
- **Later services**: check-in, voting and timer once those designs are locked.

## Server routes

All application data is served as **JSON APIs** consumed by both surfaces (client-rendered
web and the WeChat mini program). Static assets, web login, and some web management pages are HTML.
All routes except health/static and login run through the auth guard.

Editor-style writes post a **document body**, not a per-action path. A meeting is saved
by posting the whole meeting document; identifiers of the target resource live in the
body (see APIs). The **acting user is always taken from the session**, never from the
request body.

### Common

- `GET /healthz` — liveness check.
- `GET /static/*path` — static assets for admin pages.

### Web auth

- `GET /login` — login page (username/password).
- `POST /api/auth/login` — `{ username, password }`; establishes a web session as an
  HttpOnly `misu_session` cookie.
- `POST /api/auth/logout` — clear the web session and cookie.

### WeChat auth

- `POST /api/auth/wechat` — exchange a WeChat login code for a session.

### Pages

Server rendered (web management, require a signed-in web session):
- /meetings — meeting list
- /users — user management

Client rendered:
- /meetings/upcoming — upcoming meetings for role booking.
- /meetings/new — create a meeting (editor). Require a signed-in session.
- /meetings/:meeting_id/edit — edit a meeting (editor). Require a signed-in session.
- /meetings/:meeting_id/voting
- /meetings/:meeting_id/checkin
- /meetings/:meeting_id/timer
- /meetings/:meeting_id/agenda


### APIs

JSON in, JSON out. The acting user comes from the session; never trust an actor id in the
body. Write operations use a flat, body-based style.

Meetings:
- `GET /api/meetings` — meeting list.
- `GET /api/meetings/upcoming` — future meeting list.
- `GET /api/meetings/:meeting_id` — meeting detail (sessions, role slots, bookings).
- `POST /api/meetings` — Require a signed-in session. **Upsert** a meeting from the posted
  document: `{ meeting_id?, title, theme, date, start_time, end_time, venue, sessions,
  role_slots, is_template, status }`. Absent `meeting_id` creates; present updates
  (overwrite). The upsert replaces session/slot **structure** but the user-agnostic slots
  carry no bookings; existing `role_assignment` rows survive on slots matched by
  `role_slot_id` (removed slots cascade-delete their assignment), so saving/publishing
  never clobbers bookings.

Role booking (acts as the current user):
- `POST /api/book` — `{ meeting_id, role_slot_id, user_id?, cancel? }`. Book an open role
  slot; when `cancel` is true, release the current user's booking of that slot. Booking
  writes `role_assignment.booker_id` for the slot. The optional `user_id` assigns a booker
  on someone else's behalf and is honored **only** when the caller is the meeting's
  manager — this is how the web editor assigns bookers.

Check-in (acts as the current user):
- `POST /api/checkin` — `{ meeting_id, role_slot_ids: [] }`. Record attendance and the
  actual roles taken (empty list = just attending); writes `role_assignment.taker_id`.

Voting (acts as the current user):
- `GET /api/meetings/:meeting_id/voting` — voting page state (candidates, tallies). Later.
- `POST /api/vote` — `{ meeting_id, votes: {...} }`. Submit votes.

Timer (later):
- `GET /api/meetings/:meeting_id/timer` — timer state.

Users:
- `GET /api/users` — Require a signed-in session. User management, next-stage if needed.
- `POST /api/users/:user_id` — Require a signed-in session. Update user info, next-stage
  if needed.


## First-stage build order

1. Shared schema and backend service layer.
2. Web admin for meeting publish and agenda preview/publish.
3. WeChat mini program for role booking and meeting view.
4. Web user management.
5. WeChat check-in, voting and timer flows in later stages.
