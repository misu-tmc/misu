# Web admin pages

The web surface is the **admin workspace** ([../arch.md](../arch.md)): structured editing,
previewing and management that is easier on a desktop. Pages are server-served, self-contained
HTML/CSS/JS files under `apps/backend/web/`, each backed by the shared `/api/*` JSON APIs.

Chrome: a purple top bar (`MISU Admin` brand + nav: `Meetings` · `Users`). Unlike the mini
program, the web surface renders its own header. **Auth**: a `site_admin` guard is planned for
all admin pages and their APIs; not yet enforced in the first stage.

## Meetings — `/meetings`

Overview of meetings with an Open / Archived split and a create action.

```
┌───────────────────────────────────────────────────────────┐
│  MISU Admin        Meetings   Users                        │  ← top bar
├───────────────────────────────────────────────────────────┤
│  [ Open meetings ] [ Archived ]        [ + Create new ▸ ]  │  ← toolbar
├────┬──────────────────────┬──────────┬─────────┬──────┬────┤
│ #  │ Title / theme        │ Date     │ Time    │Venue │ ▪  │
├────┼──────────────────────┼──────────┼─────────┼──────┼────┤
│#143│ Regular Meeting #143 │ 2026-07-27│19:00–21:00│Room A│ ●│
│    │ New Horizons         │          │         │      │pub │
│#142│ Regular Meeting #142 │ 2026-07-13│19:00–21:00│Room A│ ●│
│    │ Embrace Change       │          │         │      │draft│
└────┴──────────────────────┴──────────┴─────────┴──────┴────┘
```

### Contents

- **Tabs** — `Open meetings` (today onward, default) and `Archived` (past). Backed by the
  `scope` query: `open` / `archived`.
- **Create** — `+ Create new meeting` links to `/meetings/new`.
- **Rows** — one per meeting: `#number`, title + theme (muted subtitle), date, `start–end`
  time, venue, and a status pill (`draft` / `published`). A whole row is clickable and opens
  `/meetings/:id/edit`.
- **Empty state** — "No meetings here yet." when the scope is empty.

### Data

- `GET /api/meetings?scope=open|archived|all|templates` — meeting summaries.
- `open` = future non-templates (soonest first); `archived` = past non-templates; `all` and
  `templates` are used by the editor's "Start from".

## Meeting editor — `/meetings/new` and `/meetings/:id/edit`

The full session editor — the primary reason the admin surface is web-first. One page serves
both create (`/meetings/new`) and edit (`/meetings/:id/edit`); the URL switches to edit mode
after the first save.

```
┌───────────────────────────────────────────────────────────┐
│  MISU Admin   ← Meetings        Editing #142               │
├───────────────────────────────────────────────────────────┤
│  Start from: [ Last meeting · #142 … ▾ ]   (new only)      │
├───────────────────────────────────────────────────────────┤
│  TITLE                          NUMBER    STATUS           │  ← title card
│  [ Regular Meeting #142    ]    [ 142 ]   ( draft )        │
│  THEME                 VENUE                               │
│  [ Embrace Change ]    [ Room A ]                          │
│  DATE          START        END                           │
│  [07/13/2026]  [07:00 PM]   [09:00 PM]  ← END is read-only │
├───────────────────────────────────────────────────────────┤
│  SESSIONS                                                  │
│  START GROUP      SESSION       MIN ROLE      ▪            │
│  19:00 [Opening ] [Opening/TMOD][6][TOE    ] [＋▲▼🗑]      │
│  19:07 [Facilit.] [           ] [5][—      ] [＋▲▼🗑]      │
│  …                                                        │
├───────────────────────────────────────────────────────────┤
│  [⭐ Save as template]        [ Save draft ] [ Publish ]   │
└───────────────────────────────────────────────────────────┘
```

### Title card

Meeting header fields: title, number, theme, venue, date, start time, end time, plus a
read-only **status** pill (`draft` / `published`) reflecting the last save.

- **END is calculated from the sessions**, not entered: it is the start time plus each
  session's duration (with a 1-minute buffer between sessions). The field is read-only and
  updates live as durations change.

### Sessions card

A grid of sessions in order. Columns, left to right:

- **Start** — computed clock time for each session (start time + preceding durations +
  buffers). Read-only, first column.
- **Group** — grouping label (e.g. `Opening`, `Prepared Speech`, `Evaluation`).
- **Session** — the agenda item name.
- **Min** — duration in minutes; editing it re-computes all start times and the meeting END.
- **Role** — a creatable combobox over the role catalog (`/api/roles`); empty for
  sessions with no role. The role slot's `label` is not edited here; it defaults to the
  role name on save.
- **Utils** (right-most) — one grouped control `[ ＋ ▲ ▼ 🗑 ]`: `＋` inserts a new session
  **below this row**, `▲`/`▼` move it, `🗑` deletes it. There is no separate bottom add
  button, so a fresh/blank meeting always starts with **one empty row** to grow from.

### Actions

- **Save as template** — persists as a reusable template (`is_template`, `status=draft`).
- **Save draft** — `status=draft`.
- **Publish** — `status=published`; the meeting becomes visible to the booking surfaces.
- **Start from** (new only) — seed a fresh draft from `Blank`, the `Last meeting`, or a
  `Template`; ids are cleared so it saves as a new meeting.

### Data

- `GET /api/meetings/:id` — full meeting document (sessions, role slots, bookings; drafts
  included) for edit mode and "Start from".
- `POST /api/meetings` — upsert the whole document. Slots matched by `role_slot_id` keep their
  `booker_id`, so saving/publishing never clobbers bookings.
- `GET /api/roles`, `POST /api/roles` — role catalog for the combobox; typing a new name
  creates the role (also auto-created on save).

## Users — `/users`

User list with permission management.

```
┌───────────────────────────────────────────────────────────┐
│  MISU Admin        Meetings   Users                        │
├───────────────────────────────────────────────────────────┤
│  Users                                                     │
├──────┬──────────────────┬───────────────┬─────────────────┤
│  ID  │ Display name     │ Role          │          Action │
├──────┼──────────────────┼───────────────┼─────────────────┤
│  1   │ Alice            │ site_admin    │ [ Revoke admin ]│
│  2   │ Bob              │ member        │ [ Promote… ]    │
└──────┴──────────────────┴───────────────┴─────────────────┘
```

### Contents

- **Rows** — `id`, `display_name`, a role cell (`site_admin` badge or muted `member`), and an
  action button: **Promote to admin** for members, **Revoke admin** for admins.
- **Empty state** — "No users yet — sign in from the mini program first." (users are created
  on first WeChat login).

### Data

- `GET /api/users` — users plus `is_site_admin`.
- `POST /api/users/:user_id/permissions` — `{ permission: "site_admin", grant }` to grant or
  revoke. Only `site_admin` is supported today.

### Notes

- Users originate from WeChat login (`POST /api/auth/wechat`); the web page does not create
  users, only manages their permissions.
- Bootstrapping the first admin is done via `MISU_SEED_ADMIN_OPENID` (see the backend README).
