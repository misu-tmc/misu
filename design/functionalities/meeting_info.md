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
hand-off). For the current stage this is a fixed constant: **1 minute**
(`BUFFER_MINUTES = 1`), not a meeting-editable setting. The buffer is added after each
session when computing the next session's Start; it is not applied after the final
session.

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
- **Save as template** (⭐) — marks this meeting as reusable by inserting its id into the
  `template` marker table.

## Reuse model

Starting from the last meeting is the default and always reflects the most recent real
agenda, so it never goes stale. Blank, last meeting, and saved templates are all based on
meeting structure; a saved template is just a meeting with a row in `template`.

## Mini Program Meeting Editor

The mini program editor is a single mobile-first page organized as **tabs** — not an
accordion and not a page stack. A header shows the meeting identity, status and a Publish
toggle; a horizontally scrollable **tab strip** switches sections; the body shows one
focused section at a time; a fixed **Save bar** saves the current section only.

Tabs (current): **Information · Roles · Sessions · Speeches · Table Topics · Review**. The
strip shows `‹` / `›` edge chevrons when more tabs sit off-screen. Tabs are addressed by
**stable ids** (`info`, `roles`, `sessions`, and later `role:123` / `speech:456`) so
deep-links and dynamic tabs stay valid across reorders.

For now, **permissions are explicitly out of scope**: assume the user can open and save
every section. Authorization rules can be added later without changing the page structure.

### Independent per-section saves

Each section is backed by its own table(s), so each section has its **own Save** and its
**own endpoint** — saving one section never rewrites another. Within a section the Save is a
**batch**: it submits all of that section's entries at once and the endpoint reconciles the
full list against its table (update existing rows, insert new, delete removed). This
deliberately narrows the web editor's whole-document upsert down to one table per Save.

| Section         | Table(s)                       | Save (batch) endpoint            |
| --------------- | ------------------------------ | -------------------------------- |
| Info            | `meeting`                      | `PUT /api/meetings/:id/info`     |
| Roles           | `role_slot` (+ `role`, `role_assignment`) | `PUT /api/meetings/:id/slots` |
| Sessions        | `session`                      | `PUT /api/meetings/:id/sessions` |
| Publish         | `meeting.status`               | `PUT /api/meetings/:id/status`   |

Saving Info touches only the `meeting` row. Saving Roles replaces the meeting's
`role_slot` list in one call — existing slots are matched by `role_slot_id` so bookings are
preserved, new slots are inserted, removed slots deleted; each slot's `booker_id` is
reconciled into `role_assignment` in the same batch. Saving Sessions replaces the
`session` rows and recomputes `position` from array order. Sections never interfere with
each other.

### State model

The page loads the full meeting once (`GET /api/meetings/:id`) into a single in-memory
`draft`, plus a small `ui` object tracking which section/row is expanded. A section Save
patches the server, then merges the result back into `draft` so collapsed summaries stay
fresh without a full reload (`onShow` may refetch as a safety net).

### Entry points

- **Meeting tab** — `Edit meeting` opens the editor for the active/upcoming meeting. This
  is the entry point for the current iteration (**edit-only**).
- **Booking / Prepare** *(later)* — role takers enter the relevant speech/role-prep section.
- **Empty or future state** *(later)* — `Create meeting` starts a new draft from a source.

### Editor page

A header (identity/status/Publish), a scrollable tab strip, one section body, and a fixed
Save bar for the current section.

```
┌─────────────────────────────┐
│ #142 Regular Meeting        │
│ Graduation · Jul 20 19:00   │  Draft   [ Publish ]
├─────────────────────────────┤
│ ‹ Info  Roles  Sessions  …› │  ← scrollable tab strip
├─────────────────────────────┤
│ Roles                       │
│ ⋮⋮  Toastmaster      [Del]  │  ← drag ⋮⋮ to reorder;
│     Assignee: Alice         │     swipe left → fades + Delete
│ ⋮⋮  Speaker 1               │
│     Assignee: Bob           │
│ [ + Add role ]              │
├─────────────────────────────┤
│           [ Save Roles ]    │  ← fixed save bar
└─────────────────────────────┘
```

### Rows, drag & swipe

**Roles and Sessions share one row style.** Every row carries a `⋮⋮` **drag handle** —
dragging it reorders the list (the data model keeps an explicit `position`/order field). A
**left swipe** on a row reveals a **Delete** action; the row content stays fixed and
**fades** (it does not translate). Tapping a row expands its inline editor.

### Deep-links (Prepare)

Booking's **Prepare** opens the editor at a specific tab and can highlight a field:
`edit-meeting?id=…&tab=…&field=…`. Tabs are id-keyed; a missing target falls back to the
nearest static tab. Example: a Grammarian's Prepare lands on **Information** with
**Keyword** highlighted.

### Shared fields

Some values surface in more than one tab (e.g. **Theme** in Information and Table Topics).
They bind to a single draft key, so editing either place updates the other and both save to
the same column.

### Dynamic tabs (advanced, later)

Tabs may be generated per session/role (e.g. a tab per prepared speech). Because tabs are
id-keyed, Prepare deep-links target them directly. Deferred until the static tab shell is
proven on-device.

### Backend & schema needs (build later)

Information / Roles / Sessions / Publish use the existing
`PUT …/info | slots | sessions | status` endpoints. The remaining tabs need new storage +
APIs:

- **Speeches** — prepared-speech fields (title, Pathways path/level/project, purpose) are
  not in the schema. Add columns/table keyed by `role_slot`/`session` plus a
  `PUT /api/meetings/:id/speeches` batch endpoint.
- **Table Topics** — the participant list has no storage. Add a `table_topic_participant`
  table (`meeting_id`, `position`, `name`/`user_id`) plus `PUT /api/meetings/:id/table-topics`.
- **Deep-link source** — Booking's Prepare must pass `tab`/`field` params to the editor.
- **Shared field writes** — Table Topics' Theme is a *view* of `meeting.theme`, saved via
  Information's endpoint — not a new column.

### Information

Quick edits to the meeting header, using native date/time pickers. Expands inline; **Save**
posts only the header via `PUT /api/meetings/:id/info` and collapses the section.

```
Title      [ Regular Meeting #142 ]
Theme      [ Graduation ]
Keyword    [ Growth ]
Date       [ 2026-07-20 ]
Start      [ 19:00 ]
Venue      [ Room A ]

[ Save ]
```

### Roles

Role slots are edited as a vertical list, one row per bookable role slot. Each collapsed
row shows the role name with the **Assignee** underneath; a left swipe reveals `＋` / `✕`
controls to insert a new slot after it or delete it.

```
Roles

Toastmaster
Assignee: Alice            ← swipe left →  ＋  ✕
Speaker 1
Assignee: Bob
Speaker 2
Assignee: —
```

Tapping a row expands it inline (no navigation):

```
Role        [ Speaker ▾ ]   ← pick an existing role, or type a new one to create it
Assignee    [ Bob ▾ ]       ← member picker (list of users)
```

Add / edit / delete happen in the in-memory list; the section's single **Save** batches the
whole list to `PUT /api/meetings/:id/slots`. The endpoint reconciles the `role_slot` list
(match existing by `role_slot_id` to preserve bookings, insert new, delete removed) and
reconciles each slot's assignee (`booker_id`) into `role_assignment` in the same call — no
separate booking request from the editor.

### Sessions

Sessions are vertical cards, not a grid. Start time is computed from the meeting start and
durations, same as web. Each collapsed card shows the computed start, name and
duration/role; a left swipe reveals `＋` / `↑` / `↓` / `✕` controls to insert after, reorder,
or delete.

```
Sessions

19:00  Opening / TMOD
       Opening · 6 min · Toastmaster      ← swipe left →  ＋ ↑ ↓ ✕

19:07  Speech 1
       Prepared Speech · 7 min · Speaker 1
```

Tapping the card body expands that session inline:

```
Session name [ Speech 1 ]
Group        [ Prepared Speech ]
Duration     [ 7 ]
Role         [ Speaker 1 ▾ ]   ← picks one of the meeting's role slots, or none
```

Add / edit / delete / reorder happen in the in-memory list; the section's single **Save**
batches the whole list to `PUT /api/meetings/:id/sessions`, which replaces the `session`
rows and recomputes `position` from array order. Sessions carry no bookings, so a full
replace is safe.

### Prepared Speeches

Bookers can update speech-prep details from phone. The printed agenda uses these fields
as the secondary line under a prepared speech session.

```
Prepared Speeches

Speaker 1 · Bob
Title       [ The Feline Savior of Kishi Station ]
Pathways    [ Presentation Mastery ]
Level/Proj  [ L2 · Project 1 ]

Speaker 2 · Alice
...
```

### Table Topics

During a meeting, the organizer can quickly record impromptu participants.

```
Table Topics Participants
[ + Add participant ]

1. Alice
2. Bob
3. Charlie
```

This can start as a local/editor field and later feed the voting page.

### Review & Publish

Final summary and lifecycle controls. Publishing/unpublishing is explicit; ordinary Save
does not silently change status.

```
Review
Info: ready
Roles: 8 slots, 5 booked
Sessions: 18 rows
Speeches: 2/2 prepared

[ Save ]
[ Publish ] / [ Unpublish ]
```

### Create meeting from phone

Creation starts from a source, then opens the same editor home.

```
Create meeting
Start from
(•) Last meeting
( ) Blank
( ) Template

[ Create draft ]
```

Defaults:
- number = last + 1
- date = selected source date + cadence
- sessions and role slots copied from the source
- role assignments/bookers cleared by default

### Implementation staging

**Current iteration** — single accordion page (`pages/edit-meeting/edit-meeting`), edit-only,
entered from the Meeting tab, with independent per-section saves:

1. Editor page shell: identity/status header + accordion + Publish toggle
   (`PUT …/status`).
2. Information section (`PUT …/info`).
3. Roles section: inline add/edit/delete + booker picker, batch-saved via `PUT …/slots`.
4. Sessions section: card list with inline edit + reorder, batch-saved via
   `PUT …/sessions`.

**Later iterations** — added as further accordion sections / flows:

5. Prepared speech self-edit (needs schema fields for title/pathways/level).
6. Create-from-source flow (blank / last meeting / template).
7. Table Topics participants.
8. Review & Publish summary.

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
