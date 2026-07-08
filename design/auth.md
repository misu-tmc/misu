# Design of auth layer of MISU service

## Principles

- **Simple** — keep auth as minimal as possible.
- **Pluggable** — the implementation can be swapped (user/password now, WeChat identity
  later) without touching the rest of the app.
- **Independent** — auth is a self-contained component that relies on as little of the
  rest of the system as possible. The dependency points inward (app → auth), never the
  reverse.

Every user-facing and admin-facing page requires authentication first. Web uses a
user/password provider at this stage. The WeChat mini program will use WeChat identity
through the same auth contract.

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

The WeChat provider design is next-stage work. For now the requirement is fixed:
mini-program pages must resolve a `user.id` before showing attendee flows such as
check-in, role booking and voting.
