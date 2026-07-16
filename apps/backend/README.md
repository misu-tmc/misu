# MISU backend

Rust (axum + SQLite) JSON API for the MISU WeChat mini program. Implements the
first-stage endpoints the mini program needs: WeChat auth, upcoming meetings, role
booking, profile update, and club info.

## Run

```pwsh
cd apps/backend
copy .env.example .env   # optional; defaults work out of the box
cargo run
```

The server listens on `http://127.0.0.1:8080` by default and creates `misu.sqlite`,
applying the schema and seeding the role catalog plus two sample published meetings.

### DEV auth mode

Set `MISU_DEV_MODE=1` to run in **DEV mode**: the login `code` is treated as a stable
fake openid (`dev-<code>`), so you can test the whole flow without a real WeChat backend.
DEV mode is an explicit opt-in and is **never** inferred — leave it unset (and set
`WECHAT_APPID` / `WECHAT_SECRET`) to call WeChat's `jscode2session` for real logins.
Never enable it in production.

### Web admin login

The web surface uses a **username/password** provider (bcrypt-hashed, stored in
`web_credential`). Set `MISU_WEB_ADMIN_USER` / `MISU_WEB_ADMIN_PASSWORD` to seed a
web login on startup. In DEV mode it defaults to `admin` / `admin` if
unset. Sign in at `/login`; the session is an HttpOnly cookie.

## Endpoints

| Method | Path | Auth | Purpose |
| ------ | ---- | ---- | ------- |
| GET  | `/healthz` | — | liveness |
| POST | `/api/auth/wechat` | — | `{ code }` → `{ token, user }` (mini program) |
| POST | `/api/auth/login` | — | `{ username, password }` → sets session cookie (web) |
| POST | `/api/auth/logout` | Session | clear the web session + cookie |
| GET  | `/api/meetings/upcoming` | Session | upcoming published meetings (sessions + role slots + takers) |
| GET  | `/api/meetings/:id` | Session | one meeting's detail (drafts included; shared with the editor) |
| POST | `/api/book` | Session | `{ meeting_id, role_slot_id, user_id?, cancel? }` book/release a role; `user_id` assigns on behalf |
| POST | `/api/users/:id` | Session | `{ display_name }` update profile (self) |
| GET  | `/api/club-info` | — | static club introduction |

The acting user is always taken from the session (bearer token or `misu_session` cookie),
never from the request body.

## Web admin pages

Server-served HTML admin pages (simple HTML/CSS/JS, one self-contained file each under
`web/`). Pages require a **web session** and redirect to `/login` when absent; their JSON
APIs share the canonical `/api/*` paths. `MISU_WEB_DIR`
(default `web`) sets where the HTML files are read from. `MISU_STATIC_DIR` (default
`static`) serves logos, QR codes and other print assets under `/static/*`.

| Page | Purpose |
| ---- | ------- |
| `/login` | username/password sign-in (no session required) |
| `/meetings` | overview of open meetings (today onward) with an Archived tab + Create button |
| `/meetings/new` | meeting editor (start-from template, sessions grid, roles, save/publish) |
| `/meetings/:id/edit` | edit an existing meeting |
| `/meetings/:id/agenda/print` | single-sided A4 printable agenda preview |
| `/users` | user list |

Web admin JSON APIs (require a web session):

| Method | Path | Purpose |
| ------ | ---- | ------- |
| GET  | `/api/meetings?scope=open\|archived\|all\|templates` | meeting list |
| POST | `/api/meetings` | upsert a meeting document (preserves `role_assignment` on matched slots) |
| GET / POST | `/api/roles` | list / create roles (creatable combobox) |
| GET / POST | `/api/users` | list users / create a bare (identity-less) user |

## Layout

- `src/config.rs` — env-based configuration.
- `src/db.rs` — schema + seed.
- `src/auth.rs` — WeChat code exchange, sessions, the `AuthUser` extractor, permissions.
- `src/handlers.rs` — app route handlers and JSON DTOs.
- `src/admin.rs` — web admin pages + admin-scoped `/api/*` handlers.
- `src/error.rs` — error → HTTP mapping.
- `src/main.rs` — router wiring.
- `web/` — static admin HTML pages.
- `static/` — image/static assets served under `/static/*`.
