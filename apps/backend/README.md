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

## Web admin pages

Server-served HTML admin pages (simple HTML/CSS/JS, one self-contained file each under
`web/`). Pages require an authenticated session and redirect to `/login` when absent;
their JSON APIs share the canonical `/api/*` paths. `MISU_WEB_DIR`
(default `web`) sets where the HTML files are read from. `MISU_STATIC_DIR` (default
`static`) serves logos, QR codes and other print assets under `/static/*`.

| Page | Purpose |
| ---- | ------- |
| `/login` | device challenge, account creation, and migration |
| `/meetings` | overview of open meetings (today onward) with an Archived tab + Create button |
| `/meetings/new` | meeting editor (start-from template, sessions grid, roles, save/publish) |
| `/meetings/:id/edit` | edit an existing meeting |
| `/meetings/:id/agenda/print` | single-sided A4 printable agenda preview |
| `/users` | user list |

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
- `web/` — static web access and admin HTML pages.
- `static/` — image/static assets served under `/static/*`.
