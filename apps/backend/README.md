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

The server listens on `http://127.0.0.1:8080`. SQLx applies the files under
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

Requests from a mini program through WeChat Cloud Hosting's `callContainer` private
protocol use the gateway-injected `X-WX-OPENID` and do not call `jscode2session`.
`WECHAT_APPID` / `WECHAT_SECRET` remain necessary for direct HTTP mini program requests.
Never include the app secret in application logs or commit it to the repository.

### Deprecated password provider

The older **username/password** provider remains temporarily in the backend while the
user and management model is revisited. Passwords are bcrypt-hashed in `web_credential`,
but `/login` no longer exposes a password form. New web authentication uses device keys.

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
| POST | `/api/auth/login` | — | deprecated password compatibility endpoint |
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
`../spa/dist` when the backend runs from `apps/backend`). The branded agenda print page
remains server-served from `web/agenda-print.html`; `MISU_WEB_DIR` configures that legacy
asset and `MISU_STATIC_DIR` serves logos, QR codes, and print images under `/static/*`.

| Page | Purpose |
| ---- | ------- |
| `/login` | device challenge, account creation, and migration |
| `/app/booking` | upcoming role booking and preparation links |
| `/app/meeting` | active meeting, agenda, check-in, voting and timer mode |
| `/app/checkin?meetingId=:id` | authenticated QR/deep-link check-in redirector |
| `/app/vote/:id` and `/app/vote-result/:id` | ballot and aggregated results |
| `/app/misu` | club introduction and contact details |
| `/app/me` | profile, bookings, and device migration code |
| `/app/meetings` | overview of open/archived/all meetings + create action |
| `/app/meetings/new` | meeting editor initialized from blank, last meeting, or template |
| `/app/meetings/:id/edit` | edit information, roles, sessions, speeches, and Table Topics |
| `/app/meetings/:id/agenda` | responsive/printable agenda view |
| `/app/users` | user catalog and identity-less user creation |
| `/meetings/:id/agenda` | branded two-page printable agenda |

Legacy `/meetings`, `/meetings/new`, `/meetings/:id/edit`, and `/users` URLs redirect to
their SPA equivalents. The actual branded print route is `/meetings/:id/agenda`.

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
- `src/auth.rs` — WeChat, password and device credentials, sessions, and the `AuthUser` extractor.
- `src/handlers.rs` — app route handlers and JSON DTOs.
- `src/admin.rs` — web admin pages + admin-scoped `/api/*` handlers.
- `src/error.rs` — error → HTTP mapping.
- `src/main.rs` — router wiring.
- `../spa/` — Preact SPA/PWA source, tests, and Vite build.
- `web/` — legacy branded agenda HTML and transitional pages.
- `static/` — image/static assets served under `/static/*`.
