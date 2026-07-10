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

## Layout

- `src/config.rs` — env-based configuration.
- `src/db.rs` — schema + seed.
- `src/auth.rs` — WeChat code exchange, sessions, the `AuthUser` extractor, permissions.
- `src/handlers.rs` — route handlers and JSON DTOs.
- `src/error.rs` — error → HTTP mapping.
- `src/main.rs` — router wiring.
