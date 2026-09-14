# MISU WeChat mini program

Native attendee surface. Four tabs: **Booking**, **Meeting**, **MISU**, **Me**.
Email/password is the primary sign-in method. The public MISU introduction remains
available without sign-in; meeting and account pages require an authenticated session.

## Run

1. Open this `apps/miniprogram/` folder in **WeChat DevTools** (test/tourist appid is fine).
2. Start the [backend](../backend/README.md) (`cargo run`).
3. In DevTools → **Details → Local settings**, tick **"Do not verify legal domain
   names…"** so the tool can reach `http://127.0.0.1:8080`.
4. Keep `apiTransport: 'auto'` (or choose `'request'`) and set the backend `apiBase` in
   [app.js](app.js).
5. Register using email, password, display name, and an optional club name. New
   accounts are guests; ask an administrator to grant editing access.

## Accounts and permissions

The mini program uses the same backend accounts as the web application:

| Endpoint | Request / response |
| --- | --- |
| `POST /api/auth/email/register` | `{email,password,display_name,club_name?}` → `{token,user}` |
| `POST /api/auth/email/login` | `{email,password}` → `{token,user}` |
| `GET /api/auth/me` | Bearer token → `{user}` |
| `POST /api/auth/email/link` | Bearer token + `{email,password}` → `{token,user}`; only for accounts without email |
| `POST /api/auth/wechat` | Explicit legacy recovery only: `{code}` → `{token,user}` |
| `POST /api/auth/wechat/link` | Bearer token + `{code}` → `{token,user}`; explicitly links WeChat to the current account |

`user` contains `id`, `display_name`, `club_name`, `email`, and `role`.
Registration and email linking require passwords of 12–128 Unicode characters
(at most 512 UTF-8 bytes). The backend normalizes email by trimming and lowercasing.
Only `user.role === 'editor'` permits content writes; missing or unknown roles fail
closed. Guests can read meetings, agendas, bookings, voting candidates/results, and
their profile, but cannot book/cancel, check in, vote, save profiles, edit meetings,
or create users/roles/attendees. Editor routes redirect guests to a viewing tab.
Account linking is an authentication operation and is available to guests too.
The backend is the final authorization authority.

Only the bearer token is persisted; passwords and roles are not stored. Launch,
foreground/page entry, and every content write verify permissions with `/api/auth/me`.
While verification is pending or fails, editing controls are unavailable. A `401`
clears the session and opens email sign-in, preserving the current native page and
query parameters. Mutations are never automatically retried, and sign-in never
silently calls `wx.login`. Sign out from **Me** clears the local session.

Existing WeChat users can explicitly choose **Recover existing WeChat account**
and then add email/password to that same account, preserving its bookings and
editor access. Unknown WeChat identities must register with email; recovery does
not create a new WeChat-only user. **Me → Add email and password** supports linking
later, and **Link WeChat (optional)** supports the opposite direction.

QR/deep-link check-in verifies the role first: guests see a read-only explanation
and can view the meeting without any check-in write. Editors retain automatic
check-in on that route, but failed writes no longer produce a local confirmation.
Password reset and email verification infrastructure are not implemented here.

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
handling, and email sign-in on session expiry.

Email authentication does not require a WeChat identity. For explicit WeChat
recovery/linking, the backend normally resolves the `wx.login` code through
`jscode2session` with its configured WeChat credentials. Gateway `X-WX-OPENID` is
trusted only when the backend explicitly enables `MISU_TRUST_WECHAT_GATEWAY=1`
(disabled by default). Enable that only behind a trusted ingress that strips
client-supplied identity headers; see the backend deployment documentation.

## Structure

- `app.js` / `app.json` / `app.wxss` — session verification, tabBar, global styles.
- `utils/api.js` — bearer request wrapper, fresh write guards, endpoint helpers.
- `utils/navigation.js` — safe native return routes, tab navigation, guest redirects.
- `utils/format.js` — date formatting and client-side agenda time computation
  (`BUFFER_MINUTES = 1`, mirroring the web derivation).
- `pages/auth` — native email registration/sign-in and explicit legacy recovery/linking.
- `pages/booking` — upcoming meetings, "Your bookings", Take!/cancel/prepare.
- `pages/meeting` — current/next meeting, computed agenda, speeches, check-in and local timer.
- `pages/checkin` / `pages/vote` / `pages/vote-result` — attendee workflows with read-only guest views.
- `pages/edit-meeting` — editor-only meeting sections, assignments, publishing.
- `pages/misu` — club introduction from `GET /api/club-info`.
- `pages/me` — profile, my bookings, account linking and sign-out.
- `pages/edit-profile` — editor-only display name / avatar editing.
- `pages/prepare` — fallback for older role preparation links.

## Validation

The mini program reuses the repository's existing SPA Vitest installation; no new
framework or runtime dependency is required. From the repository root:

```sh
apps/spa/node_modules/.bin/vitest run --root apps/miniprogram --config vitest.config.mjs
```

The tests mock native WeChat APIs and cover email/session flows, bearer transports,
fresh permissions and every content-write helper, guest QR behavior, legacy
recovery, guarded edit routes, and return navigation. `tests/` and the test config
are excluded from the mini-program upload package.

WeChat DevTools/device testing is still required for native form rendering, actual
navigation stacks, Cloud Hosting configuration, and real WeChat recovery/linking.
No browser-based test can validate those native integrations.
