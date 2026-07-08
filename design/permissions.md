# Permission model

Authentication answers "who is this user?" Permissions answer "what may this user do?"
Keep the two layers separate: auth resolves a `user.id`; authorization checks the action,
resource and permission grants.

## Principles

- **Authenticated first** — every page has a signed-in `user.id`.
- **Default attendee access** — any authenticated user may use published attendee flows.
- **Default deny for management** — admin and correction actions require explicit
  permission.
- **Registration grants no special access** — a newly registered user only receives
  ordinary attendee access after sign-in.
- **Check actions, not just UI** — hiding a button is not authorization; every write path
  must enforce the same rule.
- **Membership is separate** — member/guest status affects eligibility and reporting, not
  whether the user is authenticated.

## Permission sources

- **Implicit attendee**: every authenticated user. Can view published meeting information,
  book and cancel their own roles, prepare their own role information, check in for self,
  and vote when voting is published.
- **Global permission grants**: explicit rows such as `site_admin`. These grants are made
  by an existing site admin, never by registration. A site admin can manage meetings,
  templates, roles, users, permissions, published corrections and draft voting setup.
- **Meeting manager**: `meeting.meeting_manager` identifies the responsible user for one
  meeting. A meeting manager may edit that meeting, publish its attendee artifacts, and
  correct actual role takers for that meeting. Site admins can do the same for all
  meetings.

Officer roles and membership periods are time-sensitive domain relationships. They may
later become sources of permissions, but they should not be hard-coded into auth.

## Action rules

| Action | Allowed users |
| ------ | ------------- |
| View published agenda/poster/meeting info | authenticated users |
| Book an open role | authenticated users, subject to role eligibility |
| Cancel a booking | the original booker, meeting manager, or site admin |
| Check in | authenticated user checking in self |
| View/edit draft meeting artifacts | meeting manager or site admin |
| Edit actual role takers after check-in | meeting manager or site admin |
| Create meetings/templates and manage role catalog | site admin |
| Edit/publish a meeting | meeting manager or site admin |
| Manage users and permission grants | site admin |

## Bootstrap

The first `site_admin` grant is seeded outside the app during deployment or local setup.
After that, only site admins can promote another user or manage permission grants through
the admin surface.

## Storage

Add a small global grant table:

| Column | Type | Notes |
| ------ | ---- | ----- |
| `user_id` | id | -> `user.id` |
| `permission` | string | e.g. `site_admin` |
| `granted_by` | id | -> `user.id` |
| `granted_at` | datetime | audit trail |
| `revoked_at` | datetime, nullable | null means active |

Use `meeting.meeting_manager` for meeting-scoped management instead of inventing a generic
resource-permission system now.
