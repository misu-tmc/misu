# Permission model

Authentication answers "who is this user?" Permissions answer "what may this user do?"
At this stage the answer is deliberately simple: **any authenticated user may do
anything**. Auth resolves a `user.id`; every action only requires that a `user.id` is
present. There are no permission scopes, roles, or grant tables yet.

## Principles

- **Authenticated first** — every page and every write path requires a signed-in `user.id`.
- **No scopes yet** — once signed in, a user may perform any action. Finer-grained roles
  can be layered on later without changing the auth contract.
- **Check for a session, not a role** — hiding a button is not authorization; every write
  path must still confirm an authenticated `user.id`.
- **Membership is separate** — member/guest status affects eligibility and reporting, not
  whether the user is authenticated.

`meeting.meeting_manager` is kept as a **data field** (the responsible person for a
meeting) for display and future workflows; it does not gate any action today.

## Later

Officer roles, membership periods and a meeting-manager permission scope are time-sensitive
domain relationships. They may later become sources of permissions, but they should not be
hard-coded into auth. When they are introduced, add explicit action rules here.
