# Design of auth layer of MISU service

## Principles

- **Simple** — keep auth as minimal as possible.
- **Pluggable** — the implementation can be swapped (user/password now, WeChat identity
  later) without touching the rest of the app.
- **Independent** — auth is a self-contained component that relies on as little of the
  rest of the system as possible. The dependency points inward (app → auth), never the
  reverse.

We use user + password at this stage for admin actions. We'll migrate to a WeChat mini
program and use WeChat identity.

## Auth contract (shared across surfaces)

The rest of the app depends only on this small contract, never on a concrete
implementation. It only ever asks "who is the current user?" — not how that was
established.

| Operation            | Returns / does                                  |
| -------------------- | ----------------------------------------------- |
| `current_identity()` | the current `user` (id, display name) or anonymous |
| `login(...)`         | establishes a session, returns the identity     |
| `logout()`           | clears the session                              |

- A **provider** is anything that implements this contract: user/password today, WeChat
  identity later. Both resolve to the same identity shape, so nothing downstream changes
  when the provider is swapped.
- The only thing auth hands the rest of the system is a `user.id`. That is the whole
  coupling surface.
- Auth depends on nothing in the app except the `user` table (to resolve/create the
  identity). It must not import booking/meeting logic.

The **presentation** of auth state differs per surface, but both surfaces read the same
contract.

## Web surface

A **site-wide top bar** (header) on every web page presents the auth state. It is a pure
consumer of `current_identity()` and renders one of two states.

**Unauthenticated**

```
┌──────────────────────────────────────────────┐
│                                     [ Login ] │
└──────────────────────────────────────────────┘
```

**Authenticated**

```
┌──────────────────────────────────────────────┐
│  [ Name ]  [ Info ]              [ Logout ]   │
└──────────────────────────────────────────────┘
```

- **Login** → navigates to a login page (user/password form now; WeChat later). The
  header doesn't know which provider — it just triggers `login`.
- **Name** → the current `display_name`.
- **Info** → navigates to a user info / profile page (view and edit user info).
- **Logout** → `logout()`, returning to the unauthenticated state.

Login and Info **navigate to pages** (not modals). Because the header only reads the
contract, the same header works unchanged across providers.

## WeChat mini program surface

No top bar — WeChat provides its own navigation chrome. Auth relies fully on WeChat
identity, resolved through the same auth contract.