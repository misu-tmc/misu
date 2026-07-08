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
- **Permissions**: checks `site_admin`, `meeting_manager` and attendee actions.
- **Meeting**: creates drafts, edits sessions/role slots and publishes meetings.
- **Role booking**: lists upcoming published meetings and books/cancels roles.
- **Agenda**: renders preview and published agenda output.
- **Later services**: check-in, voting and timer once those designs are locked.

## Server routes

Use server-rendered HTML for web admin pages and JSON APIs for the WeChat mini program.
All routes except health/static and login/register run through the auth guard.

### Common

- `GET /healthz` — liveness check.
- `GET /static/*path` — static assets for admin pages.

### Web auth

- `GET /login` — login/register page.
- `POST /login` — establish a web session.
- `POST /logout` — clear the web session.

### Web admin

- `GET /admin` — admin home.
- `GET /admin/meetings/new` — new meeting editor, defaulting from last meeting.
- `POST /admin/meetings` — create a draft meeting.
- `GET /admin/meetings/:meeting_id/edit` — full meeting/session editor.
- `POST /admin/meetings/:meeting_id` — save meeting info, sessions and role slots.
- `POST /admin/meetings/:meeting_id/publish` — publish meeting information.
- `POST /admin/meetings/:meeting_id/save-template` — mark meeting as reusable template.
- `GET /admin/meetings/:meeting_id/agenda/preview` — preview generated agenda.
- `POST /admin/meetings/:meeting_id/agenda/publish` — publish agenda output.
- `GET /admin/users` — user management page, next-stage if needed.
- `POST /admin/users/:user_id/permissions` — grant/revoke permissions, next-stage if needed.

### WeChat mini program API

- `POST /api/mp/auth/login` — exchange WeChat login code for a local session/token.
- `POST /api/mp/auth/logout` — clear the mini-program session/token if needed.
- `GET /api/mp/me` — current authenticated user.
- `GET /api/mp/meetings/upcoming` — upcoming published meetings for attendee flows.
- `GET /api/mp/meetings/:meeting_id` — published meeting detail.
- `GET /api/mp/bookings` — current user's booked roles.
- `POST /api/mp/role-slots/:role_slot_id/book` — book an open role slot.
- `POST /api/mp/role-slots/:role_slot_id/cancel` — cancel the current user's booking.
- `GET /api/mp/admin/meetings/:meeting_id/review` — lightweight meeting review for managers.
- `POST /api/mp/admin/meetings/:meeting_id/publish` — lightweight publish action for managers.

### Later routes

- `POST /api/mp/meetings/:meeting_id/check-in` — attendance / actual role-taking.
- `GET /api/mp/meetings/:meeting_id/voting` — published voting page.
- `POST /api/mp/meetings/:meeting_id/votes` — submit votes.
- `GET /api/mp/meetings/:meeting_id/timer` — timer setup/state.

## First-stage build order

1. Shared schema and backend service layer.
2. Web admin for meeting publish and agenda preview/publish.
3. WeChat mini program for role booking and meeting view.
4. Web user management.
5. WeChat check-in, voting and timer flows in later stages.
