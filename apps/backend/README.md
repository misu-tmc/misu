# MISU backend

Rust (axum + MySQL) JSON API for the MISU WeChat mini program. Implements the
first-stage endpoints the mini program needs: WeChat auth, upcoming meetings, role
booking, profile update, and club info.

## Run

Start a MySQL 8 instance, create a local account, then configure and run the backend:

```sh
cd apps/backend
cp .env.example .env
cargo run
```

The server listens on `0.0.0.0:8080` by default. Open it locally at
`http://127.0.0.1:8080`. SQLx applies the files under
`migrations/` and seeds the role catalog plus two sample published meetings when the
database is empty.

Build and validate the Preact SPA before running the integrated server:

```sh
cd apps/spa
npm ci
npm run validate
```

For frontend development, run `npm run dev` in `apps/spa`; Vite serves the app under
`http://127.0.0.1:5173/app/` and proxies `/api` plus `/static` to the backend. The
production backend serves `apps/spa/dist` under `/app` and serves the same shell at
`/login`.

### Safari and local HTTPS

Device-key sign-in uses Web Crypto and IndexedDB. Safari supports both, but phones only
expose Web Crypto to a **secure context**. Consequently:

- Mac Safari may use `http://localhost:8080` with `MISU_COOKIE_SECURE=0`.
- An iPhone opening the Mac by LAN IP must use a trusted `https://` URL. Plain
	`http://192.168.x.x:8080` cannot support device sign-in in any browser.
- Production must use HTTPS and `MISU_COOKIE_SECURE=1` (the Docker image sets this).

For trusted local iPhone testing, install `mkcert`, generate a certificate containing the
Mac's LAN IP, and trust the mkcert root CA on the phone. Store generated files under
`apps/spa/.cert/` (ignored by Git), then run Vite with them:

```sh
cd apps/spa
MISU_HTTPS_KEY=.cert/dev-key.pem \
MISU_HTTPS_CERT=.cert/dev-cert.pem \
npm run dev
```

Open `https://<mac-lan-ip>:5173/app/booking` on the phone. Vite terminates HTTPS and
proxies API requests to the local backend. Set `MISU_COOKIE_SECURE=1` in the backend for
this HTTPS workflow. Both `MISU_HTTPS_KEY` and `MISU_HTTPS_CERT` must be provided together.

### MySQL configuration

| Variable | Default | Purpose |
| -------- | ------- | ------- |
| `MISU_DB_HOST` | `127.0.0.1` | MySQL private hostname or IP |
| `MISU_DB_PORT` | `3306` | MySQL port |
| `MISU_DB_USER` | `misu` | Database account |
| `MISU_DB_PASSWORD` | empty | Database password |
| `MISU_DB_NAME` | `misu` | Existing database/schema name |

The backend creates `MISU_DB_NAME` when it does not exist, applies SQLx migrations, and
seeds initial data. The account needs normal CRUD access plus `CREATE`, `ALTER`, `INDEX`,
and `REFERENCES` on that database. The account itself must still be created by an
administrator before deployment.

### WeChat Cloud Hosting

1. Open MySQL from the Cloud Hosting console and create a dedicated account.
2. Grant it CRUD and migration permissions on `misu.*`; the database need not exist yet.
3. Add the five `MISU_DB_*` variables above to the service version, using the **private**
	MySQL endpoint shown in the console. Do not put the password in the image.
4. Keep MySQL automatic pause enabled if cold-start latency is acceptable. Backend
	startup retries for up to one minute while Serverless MySQL resumes.

MySQL 5.7 and 8.0 are supported; development and CI validation use MySQL 8.0.

### DEV auth mode

Set `MISU_DEV_MODE=1` to run in **DEV mode**: the login `code` is treated as a stable
fake openid (`dev-<code>`), so you can test the whole flow without a real WeChat backend.
DEV mode is an explicit opt-in and is **never** inferred — leave it unset (and set
`WECHAT_APPID` / `WECHAT_SECRET`) to call WeChat's `jscode2session` for real logins.
Never enable it in production.

`MISU_COOKIE_SECURE` is independent from DEV auth. It controls only the web session
cookie's `Secure` attribute; use `0` for local plain HTTP and `1` for HTTPS.

Requests from a mini program through WeChat Cloud Hosting's `callContainer` private
protocol use the gateway-injected `X-WX-OPENID` and do not call `jscode2session`.
`WECHAT_APPID` / `WECHAT_SECRET` remain necessary for direct HTTP mini program requests.
Never include the app secret in application logs or commit it to the repository.

### Device-bound web login

All web authentication starts at `/login`. A first-time visitor can create an account and a local
ECDSA P-256 key; later visits sign a one-time challenge and recover the normal HttpOnly
session without a password. An authenticated browser can create a ten-minute,
single-use migration code that connects another browser to the same user. If every
device key is lost, the user creates a new account and asks an administrator to reconnect
the previous records.

## Endpoints

| Method | Path | Auth | Purpose |
| ------ | ---- | ---- | ------- |
| GET  | `/healthz` | — | liveness |
| POST | `/api/auth/wechat` | — | `{ code }` → `{ token, user }` (mini program) |
| POST | `/api/auth/logout` | Session | clear the web session + cookie |
| GET | `/api/auth/me` | Session | current web identity |
| POST | `/api/auth/device/register` | — | create an account and bind its first browser key |
| POST | `/api/auth/device/challenge` | — | issue a one-time challenge for a known browser key |
| POST | `/api/auth/device/verify` | — | verify the challenge signature and set a session cookie |
| POST | `/api/auth/device/migration-code` | Session | create a ten-minute, single-use migration code |
| POST | `/api/auth/device/migrate` | — | consume a migration code and bind a new browser key |
| GET  | `/api/meetings/upcoming` | Session | upcoming published meetings (sessions + role slots + takers) |
| GET  | `/api/meetings/:id` | Session | one meeting's detail (drafts included; shared with the editor) |
| POST | `/api/book` | Session | `{ meeting_id, role_slot_id, user_id?, cancel? }` book/release a role; `user_id` assigns on behalf |
| POST | `/api/users/:id` | Session | `{ display_name }` update profile (self) |
| GET | `/api/meetings/:id/attendees` | Session | list users checked into the meeting |
| POST | `/api/meetings/:id/attendees` | Session | create an identity-less walk-in user and check them in |
| PUT | `/api/meetings/:id/table-topics` | Session | synchronize checked-in Table Topics participants and assignments |
| GET  | `/api/club-info` | — | static club introduction |

The acting user is always taken from the session (bearer token or `misu_session` cookie),
never from the request body.

## Web SPA/PWA

The responsive Preact SPA under `apps/spa` mirrors attendee and management functionality.
All feature routes require an authenticated cookie session and redirect to the device-key
flow at `/login` when absent. `MISU_SPA_DIR` points to Vite's production output (default
`../spa/dist` when the backend runs from `apps/backend`). `MISU_STATIC_DIR` serves logos,
QR codes, and print images under `/static/*`.

| Page | Purpose |
| ---- | ------- |
| `/login` | device challenge, account creation, and migration |
| `/app/booking` | upcoming role booking and preparation links |
| `/app/meeting` | meeting cards with the ongoing meeting first and a create action |
| `/app/meetings/:id` | meeting details, agenda, check-in, voting and timer mode |
| `/app/checkin?meetingId=:id` | authenticated QR/deep-link check-in redirector |
| `/app/vote/:id` and `/app/vote-result/:id` | ballot and aggregated results |
| `/app/misu` | data-management tool list |
| `/app/misu/users` | user catalog and identity-less user creation |
| `/app/misu/about` | club introduction, meeting cadence, joining, and contact |
| `/app/me` | profile, bookings, and device migration code |
| `/app/meetings/new` | meeting editor initialized from blank, last meeting, or template |
| `/app/meetings/:id/edit` | edit information, roles, sessions, speeches, and Table Topics |
| `/app/meetings/:id/agenda` | branded two-page agenda with PDF and PNG export |
| `/meetings/:id/agenda` | redirect to the SPA agenda route |

Legacy `/meetings`, `/meetings/new`, `/meetings/:id/edit`, `/meetings/:id/agenda`, and
`/users` URLs redirect to their SPA equivalents. `/meetings` opens the unified Meeting tab
and `/users` opens the Users tool nested under MISU.

Web admin JSON APIs (require an authenticated session):

| Method | Path | Purpose |
| ------ | ---- | ------- |
| GET  | `/api/meetings?scope=open\|archived\|all\|templates` | meeting list |
| POST | `/api/meetings` | upsert a meeting document (preserves `role_assignment` on matched slots) |
| GET / POST | `/api/roles` | list / create roles (creatable combobox) |
| GET / POST | `/api/users` | list users / create a bare (identity-less) user |

## Layout

- `src/config.rs` — env-based configuration.
- `migrations/` — versioned MySQL schema.
- `src/db.rs` — MySQL pool, migration runner, and seed data.
- `src/auth.rs` — WeChat and device credentials, sessions, and the `AuthUser` extractor.
- `src/handlers.rs` — app route handlers and JSON DTOs.
- `src/admin.rs` — web admin pages + admin-scoped `/api/*` handlers.
- `src/error.rs` — error → HTTP mapping.
- `src/main.rs` — router wiring.
- `../spa/` — Preact SPA/PWA source, tests, and Vite build.
- `web/` — legacy branded agenda HTML and transitional pages.
- `static/` — image/static assets served under `/static/*`.
