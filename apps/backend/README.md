# MISU backend

Rust (axum + MySQL) JSON API for the MISU SPA/PWA and WeChat mini program.
Email and password are the primary identity provider; existing device and WeChat
credentials remain secondary sign-in methods.

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

### Container publishing

The scheduled/manual `.github/workflows/publish-ghcr.yml` workflow builds
`apps/Dockerfile` for `linux/amd64` and `linux/arm64` on native GitHub-hosted runners
(`ubuntu-24.04` and `ubuntu-24.04-arm`), avoiding emulated Rust compilation.
Both builds use the same resolved `master` commit and separate architecture-scoped
BuildKit caches, including the Dockerfile's compiled Rust dependency layer.
After both builds succeed, their image digests are merged into one multi-platform
image with the existing `latest`, `YYYYMMDD.RUN_ID`, and `sha-<built-commit>` tags.
Verify the published platforms with
`docker buildx imagetools inspect ghcr.io/misu-tmc/misu:latest`.

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

Set `MISU_DEV_MODE=1` to run in **DEV mode**: without configured WeChat credentials,
the login `code` resolves to the stable fake OpenID `dev-user`. Register with email
and use authenticated WeChat linking first; WeChat login never creates a user.
DEV mode is an explicit opt-in and is **never** inferred — leave it unset (and set
`WECHAT_APPID` / `WECHAT_SECRET`) to call WeChat's `jscode2session` for real logins.
Never enable it in production.

`MISU_COOKIE_SECURE` is independent from DEV auth. It controls only the web session
cookie's `Secure` attribute; use `0` for local plain HTTP and `1` for HTTPS.

Requests from a mini program through WeChat Cloud Hosting's `callContainer` private
protocol can use gateway-injected `X-WX-OPENID` without calling `jscode2session`.
This requires `MISU_TRUST_WECHAT_GATEWAY=1`, which defaults to disabled. Enable it
**only** when every request arrives through a trusted gateway that strips
client-supplied OpenID headers and injects an authenticated identity. Do not enable it
on a directly reachable HTTP service. Otherwise even a supplied OpenID header is
ignored, and the server exchanges the one-time `code` with WeChat.
`WECHAT_APPID` / `WECHAT_SECRET` remain necessary for direct HTTP mini program requests.
Never include the app secret in application logs or commit it to the repository.

### Email identity and access

Register at `/api/auth/email/register` with `{email,password,display_name,club_name?}`;
sign in at `/api/auth/email/login` with `{email,password}`. Both return HTTP 200,
`{token,user:{id,display_name,club_name,email,role}}`, and an HttpOnly
`misu_session` cookie (`SameSite=Lax`; `Secure` follows `MISU_COOKIE_SECURE`).
Mini-program callers use the returned token as a bearer token. `/api/auth/me`
returns `{user}` with the same fields. `email` and `club_name` can be null on legacy
users. Numeric user IDs and existing assignments, attendance and votes never change.

Email is trimmed, ASCII-lowercased and uniquely indexed. Supported addresses use an
ASCII dot-atom local part (up to 64 bytes) and a DNS-style domain with a dot (254
bytes total); quoted and internationalized mailboxes are unsupported. Passwords
must have 12–128 Unicode characters and at most 512 UTF-8 bytes; they are not trimmed.
Only randomly salted Argon2id PHC hashes are stored (19 MiB, two iterations, one lane).
Hashing/verification run on blocking workers with at most four concurrent jobs and
no unbounded queue. Email register/login/link share per-process limits of ten
attempts per normalized email and 300 total attempts per 15 minutes, including
successful attempts. Unknown emails still incur an Argon2 verification.

Invalid fields return 400 (malformed JSON/unknown email-auth fields may return 422),
incorrect credentials return 401, duplicate email/already-linked accounts return
409, and throttled requests return 429. Limits reset on restart and are not shared
between replicas; production ingress should add shared/IP-based abuse limits.
Email delivery/ownership verification, password reset and password change are not
implemented. Administrators must not merge or recover accounts merely on a claimed
email address or display name.

**All new users are `guest` and read-only**, including the very first registration,
identity-less user creation and walk-ins. Migration `0015` preserves every
pre-existing user as `editor`, then changes the SQL default to `guest`. A centralized
middleware requires exactly `editor` for every non-auth POST/PUT/PATCH/DELETE,
including profile changes, booking/release, speeches, check-in, walk-ins, topics,
votes, meeting editing/status and catalog creation. Guest reads remain available.
Unknown roles are also denied (403); missing/invalid sessions return 401.
The role is fetched from MySQL each request, so trusted changes apply to existing sessions.

There is no role-management API, and email-auth requests reject a client-supplied role.
To promote a verified member, an authorized database administrator can run:

```sql
UPDATE `user` SET role = 'editor' WHERE email = 'member@example.com';
```

Use the exact normalized email, verify the affected account first, and check that
one row was affected. Never auto-promote the first signup.

### Migrating legacy credentials

An existing device/WeChat user first signs in using their existing credential,
then POSTs `{email,password}` to `/api/auth/email/link` with that session. It only
works when the authenticated account has no email; it neither searches for nor
merges another user by email/name and cannot replace an existing email. IDs and
roles are preserved.

New device registration is disabled (403). Existing P-256 challenge/verify and
ten-minute, single-use migration codes remain supported. An email-authenticated
user can issue a migration code and redeem it with a browser key as a secondary
credential, including as a guest; this grants no content permissions.
Unknown WeChat OpenIDs must register with email, then POST `{code}` to authenticated
`/api/auth/wechat/link`. Linking requires an email-backed account and verified WeChat
identity; it refuses to replace an account's existing WeChat link or steal another
account's OpenID. All sign-in/link/migration responses use the common token/user shape.

## Endpoints

| Method | Path | Auth | Purpose |
| ------ | ---- | ---- | ------- |
| GET  | `/healthz` | — | liveness |
| POST | `/api/auth/email/register` | — | create a guest account with email/password |
| POST | `/api/auth/email/login` | — | sign in with email/password |
| POST | `/api/auth/email/link` | Session | add primary email/password to the current legacy account |
| POST | `/api/auth/wechat` | — | sign in to an existing linked WeChat identity only |
| POST | `/api/auth/wechat/link` | Session | link verified WeChat identity to the current email account |
| POST | `/api/auth/logout` | Session | clear the web session + cookie |
| GET | `/api/auth/me` | Session | current web identity |
| POST | `/api/auth/device/register` | — | disabled; returns 403, use email registration |
| POST | `/api/auth/device/challenge` | — | issue a one-time challenge for a known browser key |
| POST | `/api/auth/device/verify` | — | verify the challenge signature and set a session cookie |
| POST | `/api/auth/device/migration-code` | Session | create a ten-minute, single-use migration code |
| POST | `/api/auth/device/migrate` | — | consume a migration code and bind a new browser key |
| GET  | `/api/meetings/upcoming` | Session | upcoming published meetings (sessions + role slots + takers) |
| GET  | `/api/meetings/:id` | Session | one meeting's detail (drafts included; shared with the editor) |
| POST | `/api/book` | Editor | `{ meeting_id, role_slot_id, user_id?, cancel? }` book/release a role; `user_id` assigns on behalf |
| POST | `/api/users/:id` | Editor | `{ display_name,club_name? }` update profile (self) |
| GET | `/api/meetings/:id/attendees` | Session | list users checked into the meeting |
| POST | `/api/meetings/:id/attendees` | Editor | create an identity-less walk-in user and check them in |
| PUT | `/api/meetings/:id/table-topics` | Editor | synchronize checked-in Table Topics participants and assignments |
| GET  | `/api/club-info` | — | static club introduction |

The acting user is always taken from the session (bearer token or `misu_session` cookie),
never from the request body.

## Web SPA/PWA

The responsive Preact SPA under `apps/spa` mirrors attendee and management functionality.
All feature routes require an authenticated cookie session and redirect to the email
flow at `/login` when absent. `MISU_SPA_DIR` points to Vite's production output (default
`../spa/dist` when the backend runs from `apps/backend`). `MISU_STATIC_DIR` serves logos,
QR codes, and print images under `/static/*`.

| Page | Purpose |
| ---- | ------- |
| `/login` | email login/registration and legacy credential migration |
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

Web admin JSON APIs (reads require a session; all writes require `editor`):

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
- `src/auth.rs` — secondary credentials, sessions, identity extractor and content-write guard.
- `src/email_auth.rs` — primary email/password authentication and bounded password workers.
- `src/handlers.rs` — app route handlers and JSON DTOs.
- `src/admin.rs` — web admin pages + admin-scoped `/api/*` handlers.
- `src/error.rs` — error → HTTP mapping.
- `src/main.rs` — router wiring.
- `../spa/` — Preact SPA/PWA source, tests, and Vite build.
- `web/` — legacy branded agenda HTML and transitional pages.
- `static/` — image/static assets served under `/static/*`.

## Backend validation

```sh
cd apps/backend
cargo test
# Explicitly configure a LOCAL MySQL test administrator with CREATE/DROP DATABASE:
MISU_DB_HOST=127.0.0.1 MISU_DB_PORT=3306 MISU_DB_USER=test_admin \
  MISU_DB_PASSWORD='<local test password>' \
  cargo test email_identity_and_read_only_guests_mysql -- --ignored
```

The opt-in MySQL regression creates and drops a unique `misu_auth_test_*` schema;
it does not migrate or seed `MISU_DB_NAME`. It exercises pre-migration editor
preservation, guest defaults, email normalization/duplicates/passwords, session and
cookie auth, every content-write route, guest reads, legacy email/device/WeChat
linking, credential replay rejection, trusted promotion/revocation and throttling.
The current publish workflow builds the image but does not run this database test.
