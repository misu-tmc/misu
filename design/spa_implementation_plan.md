# SPA implementation plan (implementation-first)

This plan treats **running code** as source of truth:

1. Backend routes in `apps/backend/src/main.rs`.
2. Web behavior in `apps/backend/web/*.html`.
3. Mini program behavior in `apps/miniprogram/**`.

Design docs are reference-only when they conflict with implementation.

## 1) Product target

Build one standalone SPA with PWA support and responsive layout:

- One codebase for phone + desktop.
- Works in normal browser and WeChat embedded browser.
- Every route requires login, except `/login` itself.
- Initial permission mode: every authenticated user can access every feature.

### Technical baseline

- **Preact** for declarative components and lifecycle management.
- **Wouter for Preact** for client-side routing.
- **Preact Signals** for small shared state such as authenticated identity.
- **Vite** for development and production builds.
- Plain CSS with the existing MISU design tokens; no component-library dependency.
- Native `fetch`, IndexedDB and Web Crypto APIs for backend and device-key integration.

The framework bundle is intentionally small (the initial production proof-of-concept is
about 14 KB gzipped JavaScript). Existing vanilla SPA pages remain active during migration;
each route switches to Preact only after it reaches implementation parity.

## 2) Current implemented feature surface to mirror

### Attendee capabilities (from mini program)

- Booking and cancel role booking.
- View upcoming/current meeting details and agenda.
- One-tap check-in (including QR/deep-link check-in flow).
- Vote submission and vote result viewing.
- Edit display name.
- Club information page.

### Management capabilities (from current web pages)

- Meetings list with open/archived scope.
- Meeting create/edit page.
- Roles, sessions, speech data editing.
- Users list.
- Agenda print page.

## 3) Live backend/API surface (canonical)

Auth:

- `POST /api/auth/wechat`
- `POST /api/auth/login` (deprecated compatibility)
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `POST /api/auth/device/register`
- `POST /api/auth/device/challenge`
- `POST /api/auth/device/verify`
- `POST /api/auth/device/migration-code`
- `POST /api/auth/device/migrate`

Meeting/attendee:

- `GET /api/meetings/upcoming`
- `GET /api/meetings/:meeting_id`
- `POST /api/book`
- `GET /api/meetings/:meeting_id/checkin`
- `POST /api/meetings/:meeting_id/checkin`
- `GET /api/meetings/:meeting_id/vote`
- `POST /api/meetings/:meeting_id/vote`
- `GET /api/meetings/:meeting_id/vote/result`
- `POST /api/users/:user_id`
- `GET /api/club-info`

Editor/admin APIs currently in use:

- `GET /api/meetings?scope=open|archived|all|templates`
- `POST /api/meetings`
- `PUT /api/meetings/:meeting_id/info`
- `PUT /api/meetings/:meeting_id/slots`
- `PUT /api/meetings/:meeting_id/sessions`
- `PUT /api/meetings/:meeting_id/status`
- `PUT /api/meetings/:meeting_id/table-topics`
- `PUT /api/meetings/:meeting_id/speech`
- `GET /api/roles`
- `POST /api/roles`
- `GET /api/venues`
- `GET /api/templates`
- `GET /api/users`
- `POST /api/users`
- `GET /api/meetings/:meeting_id/attendees`
- `POST /api/meetings/:meeting_id/attendees`

## 4) SPA route map

Public:

- `/login`

Protected:

- `/app/booking`
- `/app/meeting` (meeting cards; ongoing meeting first)
- `/app/meetings/:id` (meeting details)
- `/app/checkin`
- `/app/vote/:meetingId`
- `/app/vote-result/:meetingId`
- `/app/me`
- `/app/misu`
- `/app/meetings/new`
- `/app/meetings/:id/edit`
- `/app/meetings/:id/agenda`
- `/app/users`

## 5) Auth and session strategy

Web SPA uses current device-key login flow:

- Login UI uses `device/register`, `device/challenge`, `device/verify`, `device/migrate`.
- Session is cookie-based (`misu_session`), validated by `GET /api/auth/me`.
- Global route guard calls `/api/auth/me` before protected route render.
- 401 redirects to `/login?next=<target>`.

Mini program auth remains unchanged in backend:

- `POST /api/auth/wechat` + bearer token remains for mini program clients.

## 6) Responsive behavior

- Mobile-first for attendee pages (`booking`, `meeting`, `checkin`, `vote`, `me`, `misu`).
- Desktop-enhanced layouts for `meetings`, `meeting editor`, `users`, `agenda`.
- Keep one component and state model; vary only layout composition by breakpoint.

## 7) PWA strategy

Progressive enhancement (not hard dependency):

- Add web app manifest.
- Add service worker for app shell/static caching.
- Network-first for auth-sensitive API calls.
- Optional stale-while-revalidate for low-risk readonly content.
- WeChat browser fallbacks:
  - If install prompt/offline support is limited, app still works as normal SPA.

## 8) Implementation milestones

Milestone 1: foundation — **completed**

- SPA scaffold and build setup.
- Router and auth guard.
- Shared API client and error model.
- Shared responsive layout shell.

Milestone 2: attendee parity — **completed**

- Booking page.
- Meeting page.
- Check-in flow page.
- Vote + vote result pages.
- Me page.
- MISU page.

Milestone 3: management parity — **completed**

- Meetings list.
- Meeting editor.
- Users list.
- Agenda page.

Milestone 4: PWA hardening — **completed**

- Manifest + service worker.
- Update strategy and cache invalidation rules.
- Capability/fallback checks for WeChat embedded browser.

Milestone 5: rollout — **completed**

- The backend serves the Vite build under `/app` and serves `/login` from the same SPA shell.
- Legacy management URLs redirect to their SPA equivalents; the branded agenda remains available for printing.
- The production Docker image builds and embeds the SPA output.

## 9) Acceptance criteria

- Unauthenticated access to protected routes always redirects to `/login`.
- Authenticated users can use all pages (no role restrictions yet).
- Functional parity with live mini program + backend web behaviors.
- SPA usable in desktop, phone, and WeChat embedded browser.
- Existing mini program backend flow remains operational.
