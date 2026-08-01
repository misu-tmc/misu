# MISU WeChat mini program

First-stage attendee surface. Four tabs: **Booking**, **Meeting**, **MISU**, **Me**.
Login runs on launch via `wx.login` → `POST /api/auth/wechat`; every page assumes an
authenticated user.

## Run

1. Open this `apps/miniprogram/` folder in **WeChat DevTools** (test/tourist appid is fine).
2. Start the [backend](../backend/README.md) (`cargo run`).
3. In DevTools → **Details → Local settings**, tick **"Do not verify legal domain
   names…"** so the tool can reach `http://127.0.0.1:8080`.
4. Keep `apiTransport: 'request'` and set the backend `apiBase` in [app.js](app.js).

## API transport

The transport is selected in `globalData` in [app.js](app.js); pages and endpoint
helpers do not need to change. The default `apiTransport: 'auto'` uses direct HTTP in
WeChat DevTools and Cloud Hosting on real devices, trial builds, and release builds.

- **Direct HTTP:** set `apiTransport: 'request'` and `apiBase` to the backend URL.
  A production mini program requires an HTTPS URL configured as a legal request domain.
- **WeChat Cloud Hosting:** set `apiTransport: 'cloud'`, `cloudEnv` to the cloud
  environment ID, and `cloudService` to the Cloud Hosting service name. This uses
  `wx.cloud.callContainer` and does not require a request domain. The Cloud Hosting
  environment must belong to, or be authorized for, the mini program AppID.
- **Automatic:** set `apiTransport: 'auto'` to use `request` only inside DevTools and
  `cloud` everywhere else. Explicit `request` and `cloud` values remain available for
  debugging either transport.

Cloud mode calls `wx.cloud.init` during launch and sends `cloudService` in the
`X-WX-SERVICE` header. Both transports use the same paths, bearer token, response
handling, and automatic login retry.

## Structure

- `app.js` / `app.json` / `app.wxss` — launch login, tabBar, global styles.
- `utils/api.js` — request wrapper (adds the Bearer token) + endpoint helpers.
- `utils/format.js` — date formatting and client-side agenda time computation
  (`BUFFER_MINUTES = 1`, mirroring the web derivation).
- `pages/booking` — upcoming meetings, "Your bookings", Take!/cancel/prepare.
- `pages/meeting` — current/next meeting title card + computed agenda. Check-in / vote /
  timer are stubbed ("coming soon"), per the design's later-stage plan.
- `pages/misu` — club introduction from `GET /api/club-info`.
- `pages/me` — profile + my bookings; links to edit profile.
- `pages/edit-profile` — edit display name / avatar (`POST /api/users/:id`).
- `pages/prepare` — placeholder for deferred role extra-info.
