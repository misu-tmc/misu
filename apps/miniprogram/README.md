# MISU WeChat mini program

First-stage attendee surface. Four tabs: **Booking**, **Meeting**, **MISU**, **Me**.
Login runs on launch via `wx.login` → `POST /api/auth/wechat`; every page assumes an
authenticated user.

## Run

1. Open this `apps/miniprogram/` folder in **WeChat DevTools** (test/tourist appid is fine).
2. Start the [backend](../backend/README.md) (`cargo run`).
3. In DevTools → **Details → Local settings**, tick **"Do not verify legal domain
   names…"** so the tool can reach `http://127.0.0.1:8080`.
4. The backend base URL is `apiBase` in [app.js](app.js) — change it for a deployed API.

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
