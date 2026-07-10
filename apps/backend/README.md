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

Without `WECHAT_APPID` / `WECHAT_SECRET`, the server runs in **DEV mode**: the login
`code` is treated as a stable fake openid (`dev-<code>`), so you can test the whole flow
without a real WeChat backend. Set both variables to call WeChat's `jscode2session` for
real logins.

Set `MISU_SEED_ADMIN_OPENID` to bootstrap the first `site_admin` (in DEV mode this is
`dev-<code>`, e.g. `dev-tester`).

## Endpoints

| Method | Path | Auth | Purpose |
| ------ | ---- | ---- | ------- |
| GET  | `/healthz` | — | liveness |
| POST | `/api/auth/wechat` | — | `{ code }` → `{ token, user }` |
| GET  | `/api/meetings/upcoming` | Bearer | upcoming published meetings (sessions + role slots + takers) |
| GET  | `/api/meetings/:id` | Bearer | one meeting's detail |
| POST | `/api/book` | Bearer | `{ meeting_id, role_slot_id, cancel? }` book/release a role |
| POST | `/api/users/:id` | Bearer | `{ display_name }` update profile (self or site_admin) |
| GET  | `/api/club-info` | — | static club introduction |

The acting user is always taken from the session token, never from the request body.

## Web admin pages

Server-served HTML admin pages (simple HTML/CSS/JS, one self-contained file each under
`web/`). **No auth guard yet** — they and their APIs live under `/api/admin/*` so the
authenticated app endpoints above are untouched; a `site_admin` guard drops in later.
`MISU_WEB_DIR` (default `web`) sets where the HTML files are read from.

| Page | Purpose |
| ---- | ------- |
| `/meetings` | overview of open meetings (today onward) with an Archived tab + Create button |
| `/meetings/new` | meeting editor (start-from template, sessions grid, roles, save/publish) |
| `/meetings/:id/edit` | edit an existing meeting |
| `/users` | user list with promote / revoke `site_admin` |

Admin JSON APIs (no auth):

| Method | Path | Purpose |
| ------ | ---- | ------- |
| GET  | `/api/admin/meetings?scope=open\|archived\|all\|templates` | meeting list |
| GET  | `/api/admin/meetings/:id` | full meeting detail (drafts included) |
| POST | `/api/admin/meetings` | upsert a meeting document (preserves `booker_id` on matched slots) |
| GET / POST | `/api/admin/roles` | list / create roles (creatable combobox) |
| GET  | `/api/admin/users` | users + `is_site_admin` |
| POST | `/api/admin/users/:id/permissions` | `{ permission, grant }` grant/revoke `site_admin` |

## Layout

- `src/config.rs` — env-based configuration.
- `src/db.rs` — schema + seed.
- `src/auth.rs` — WeChat code exchange, sessions, the `AuthUser` extractor, permissions.
- `src/handlers.rs` — app route handlers and JSON DTOs.
- `src/admin.rs` — web admin pages + `/api/admin/*` handlers.
- `src/error.rs` — error → HTTP mapping.
- `src/main.rs` — router wiring.
- `web/` — static admin HTML pages.
