# Design of auth layer of MISU service

## Principles

- **Simple** — keep auth as minimal as possible.
- **Pluggable** — the implementation can be swapped (user/password now, WeChat identity
  later) without touching the rest of the app.
- **Independent** — auth is a self-contained component that relies on as little of the
  rest of the system as possible. The dependency points inward (app → auth), never the
  reverse.

Every user-facing and admin-facing page requires authentication first. The **WeChat mini
program is the primary surface** and is built first, using WeChat identity through the
auth contract. The web app uses a user/password provider for admin/management. Both are
different providers behind the same contract.

## Auth contract (shared across surfaces)

The rest of the app depends only on this small contract, never on a concrete
implementation. It only ever asks "who is the current user?" — not how that was
established.

| Operation            | Returns / does                                      |
| -------------------- | --------------------------------------------------- |
| `current_identity()` | the authenticated `user`, or an unauthenticated state |
| `login(...)`         | establishes a session, returns the identity         |
| `logout()`           | clears the session                                  |

- A **provider** is anything that implements this contract: user/password today, WeChat
  identity later. Both resolve to the same identity shape, so nothing downstream changes
  when the provider is swapped.
- The only thing auth hands the rest of the system is a `user.id`. That is the whole
  coupling surface.
- Auth depends on nothing in the app except the `user` table (to resolve/create the
  identity). It must not import booking/meeting logic.
- Anonymous or dropped-identifier users are not supported. If no identity is present,
  the surface routes the user to its sign-in flow before showing the requested page.

The **presentation** of auth state differs per surface, but both surfaces read the same
contract.

## Auth guard

All feature pages run an auth guard before loading page data:

1. Ask the active provider for `current_identity()`.
2. If an identity exists, continue and use `user.id` for booking, check-in, voting and
   admin actions.
3. If no identity exists, redirect to web login/register or start the WeChat sign-in
   flow, then return to the original page.

Membership status is separate from authentication. A signed-in user may still be a
guest/non-member for role eligibility and reporting.

Authorization is handled outside the auth provider. See `permissions.md` for the action
rules based on the authenticated `user.id`.

## Web surface

A **site-wide top bar** (header) on every web page presents the auth state. It is a pure
consumer of `current_identity()` and renders one of two states.

**Unauthenticated**

```
┌──────────────────────────────────────────────┐
│                         [ Login / Register ] │
└──────────────────────────────────────────────┘
```

**Authenticated**

```
┌──────────────────────────────────────────────┐
│  [ Name ]  [ Info ]              [ Logout ]  │
└──────────────────────────────────────────────┘
```

- **Login / Register** → navigates to a login page (user/password form now; WeChat later). The
  header doesn't know which provider — it just triggers `login`.
- **Name** → the current `display_name`.
- **Info** → navigates to a user info / profile page (view and edit user info).
- **Logout** → `logout()`, returning to the unauthenticated state.

Login and Info **navigate to pages** (not modals). Because the header only reads the
contract, the same header works unchanged across providers.

## WeChat mini program surface

No top bar — WeChat provides its own navigation chrome. Auth relies fully on WeChat
identity, resolved through the same auth contract.

This is the **primary surface**, built in the first stage. Every mini-program page
requires a resolved `user.id` before showing content — the WeChat sign-in flow runs on
launch and the auth guard gates every page (booking, meeting, check-in, voting, profile).
The WeChat identity provider exchanges the WeChat login code for a session
(`POST /api/auth/wechat`) and resolves/creates the `user`.

## Implementation (current)

Two providers behind the shared contract, both resolving to a `user.id` and a row in the
shared `auth_session` store:

- **WeChat** (`wechat_identity`): `POST /api/auth/wechat { code }` exchanges the code for
  an `openid`, upserts the user, and returns an opaque **bearer token** the mini program
  sends as `Authorization: Bearer <token>`.
- **Web username/password** (`web_credential`): `POST /api/auth/login { username, password }`
  verifies against a **bcrypt** hash and sets the session as an HttpOnly `misu_session`
  **cookie**. `POST /api/auth/logout` drops the session row and clears the cookie.

The `AuthUser` extractor resolves either transport (bearer or cookie) against the one
`auth_session` table — the rest of the app only sees `user.id`. Web management pages
redirect to `/login` without a session. At this stage there are **no permission scopes**:
any authenticated user may perform any action.

**Bootstrap**: the first web admin is seeded from `MISU_WEB_ADMIN_USER` /
`MISU_WEB_ADMIN_PASSWORD` (or `admin`/`admin` in DEV mode). Passwords are stored only as
bcrypt hashes.
