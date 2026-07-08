# Meeting info & sessions

The admin page to define a meeting and its sessions, then publish. This is "Page 1"
of the admin flow. It owns the `Meeting` entity and the `Sessions` table that the
agenda, timer, voting and check-in all derive from.

The page is kept as simple as possible, with an elegant, uncluttered style. A new
meeting defaults to the last meeting's layout; changing the starting point is a
single, unobtrusive selector.

## Entry: start from a template

Everything an admin can start from is a **template** — there is one unified concept:

- **Blank** — the empty template.
- **Last meeting** — the most recent meeting, used as a template. This is the
  **default** selection.
- **Saved templates** — meetings flagged as reusable templates.

The page opens already pre-filled from the last meeting; a **combobox** lets the admin
type to filter and switch to Blank or a saved template if needed. Whatever is chosen,
the admin lands on the same sessions grid, pre-filled accordingly. (Templates are
created via *Save as template*, so this combobox picks rather than creates.)

## Meeting info header

- Title / meeting number
- Theme
- Date
- Time
- Venue

When starting from the last meeting, the service auto-suggests the next date (+14 days)
and derives the next meeting number from the last meeting's number (last + 1). Both are
editable.

## Sessions grid

A spreadsheet-style grid backed by a typed `Sessions` table (not free-form cells).
The grid ports cleanly to the WeChat mini program because each cell is a typed field.

Columns:
- Order (move up / down controls `▲▼`)
- Group — groups consecutive sessions (e.g. "Opening", "Prepared Speeches",
  "Table Topics"); used for visual grouping in the printed agenda
- Start — the session's start time, **computed** from the meeting start time plus the
  cumulative durations of preceding sessions **and the inter-session buffer**; read-only,
  updates as durations or order change
- Session name
- Minutes (number)
- Role slot(s)

A **time buffer** is inserted between sessions to absorb transitions (applause, role
hand-off). It defaults to **1 minute** and is a meeting-level setting (editable). The
buffer is added after each session when computing the next session's Start; it is not
applied after the final session.

Reordering uses per-row ▲▼ controls — accessible, work on desktop and phone, and port
to the WeChat mini program. Drag-and-drop is a later desktop-only enhancement; the
data model keeps an explicit `order` field either way.

Row operations:
- **Add** a row
- **Delete** a row
- **Update** — edit any cell inline

Each session names the role slot it needs (one role per session for now). Meeting-wide
roles that don't map to a session (Timer, Ah-Counter, Grammarian, General Evaluator)
are handled on the role assignment page.

## Role slots & the Roles catalog

The "Role slot" cell is a **creatable combobox** backed by a managed `Roles` catalog
(a small list of role definitions, distinct from per-meeting role *assignments*).

- **Pick** — type to filter and select an existing role. Single click, the common path.
- **Create** — typing a new name offers "Create '…'", which adds it to the catalog.

For now the combobox only handles selecting and creating role *names*. Role properties
are deferred as next improvements:
- **Member only** — guests cannot be assigned or self-register for this role.
- **Needs extra info** — whether the role prompts for extra fields such as speech
  title/level or evaluatee.
- A **create dialog** to capture these attributes, and a **Manage-roles view** to edit /
  rename / deactivate roles later.

## Lifecycle

- **Draft** by default; visible to admins only.
- **Preview** the generated agenda.
- **Publish** — makes the agenda / timer / check-in go live.
- **Save as template** (⭐) — flags this meeting as a reusable template
  (`is_template`); no separate template entity.

## Reuse model

Starting from the last meeting is the default and always reflects the most recent real
agenda, so it never goes stale. Blank, last meeting, and saved templates are all the
same kind of thing — a template — so there is no separate template data model; a saved
template is just a meeting flagged `is_template`.

## Page layout

Single page, top to bottom, kept deliberately sparse:

```
┌────────────────────────────────────────────────────────────┐
│  MISU Admin ▸ New meeting                          [ Save ] │
│                                                            │
│  Start from:  [ Last meeting ▾ ]   (Blank · Last · saved…) │
├────────────────────────────────────────────────────────────┤
│  Title  [ Regular Meeting #142                           ] │
│  Theme  [ Embrace Change                                 ] │
│  Date   [ 2026-07-12 ]   Time [ 19:00–21:00 ]  Venue [ … ] │
├────────────────────────────────────────────────────────────┤
│  Sessions                                                  │
│  ┌──┬──────────────┬───────┬──────────────┬─────┬────────┐ │
│  │# │ Group        │ Start │ Session      │Mins │ Role   │ │
│  ├──┼──────────────┼───────┼──────────────┼─────┼────────┤ │
│  │▲▼│ Opening      │ 19:00 │ Opening/TMOD │  5  │ TMOD ▾ │🗑│
│  │▲▼│ Speeches     │ 19:06 │ Prep Speech 1│  7  │ Speaker│🗑│
│  │▲▼│ Speeches     │ 19:14 │ Evaluation 1 │  3  │ Evaltr │🗑│
│  │▲▼│ Table Topics │ 19:18 │ Table Topics │ 20  │ TT Mstr│🗑│
│  └──┴──────────────┴───────┴──────────────┴─────┴────────┘ │
│  [ + Add session ]  [ ⭐ Save as template ]               |
├────────────────────────────────────────────────────────────┤
│   [ Preview ]   [ Save draft ]      [ Publish ]            │
└────────────────────────────────────────────────────────────┘
```

- **Start from** is a single combobox at the top, defaulting to *Last meeting*; type to
  filter Blank / Last meeting / saved templates.
- The meeting header is a few plain fields.
- The sessions grid supports add / delete / update inline; `▲▼` reorders rows.
- Save as template sits under the grid; the bottom row holds Preview, Save draft, Publish.
