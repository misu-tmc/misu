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
- **Save as template** (⭐) — flags this meeting as a reusable template
  (`is_template`); no separate template entity.

## Reuse model

Starting from the last meeting is the default and always reflects the most recent real
agenda, so it never goes stale. Blank, last meeting, and saved templates are all the
same kind of thing — a template — so there is no separate template data model; a saved
template is just a meeting flagged `is_template`.

## Mini Program Meeting Editor

The mini program editor is **not** a shrunken web spreadsheet. It is a mobile-first stack
of focused pages. Each page edits one slice of the meeting, with large tap targets and
native pickers. For now, **permissions are explicitly out of scope**: assume the user can
open and save every editing section. Authorization rules can be added later without
changing the page structure.

### Entry points

- **Meeting tab** — `Edit meeting` opens the editor for the active/upcoming meeting.
- **Booking / Prepare** — role takers can enter the relevant speech/role-prep section.
- **Empty or future state** — `Create meeting` starts a new draft from a source meeting.

### Editor home

The first screen is a section dashboard, not a form with all fields.

```
┌─────────────────────────────┐
│ #142 Regular Meeting        │
│ Graduation · Jul 20 19:00   │
│ Published                   │
├─────────────────────────────┤
│ Basics                  ›   │
│ Roles                   ›   │
│ Agenda Sessions         ›   │
│ Prepared Speeches       ›   │
│ Table Topics            ›   │
│ Review & Publish        ›   │
└─────────────────────────────┘
```

### Basics

Quick edits to the meeting header, using native date/time pickers.

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

Role slots are edited as a vertical list, one row per bookable role slot. This mirrors the
web editor's Roles card but is mobile-friendly.

```
Roles
[ + Add role ]

Toastmaster          Alice       ›
Speaker 1            Bob         ›
Speaker 2            —           ›
Timer                Carol       ›
Grammarian           —           ›
```

Tap a row to edit:

```
Role        [ Speaker ▾ ]
Booker      [ Bob ▾ ]

[ Delete role ]   [ Save ]
```

### Agenda Sessions

Sessions are vertical cards, not a grid. Start time is computed from the meeting start and
durations, same as web.

```
Agenda Sessions
[ + Add session ]

19:00  Opening / TMOD
Opening · 6 min · Toastmaster
[ ↑ ] [ ↓ ] [ Edit ]

19:07  Speech 1
Prepared Speech · 7 min · Speaker 1
[ ↑ ] [ ↓ ] [ Edit ]
```

Edit one session at a time:

```
Session name [ Speech 1 ]
Group        [ Prepared Speech ]
Duration     [ 7 ]
Role         [ Speaker 1 ▾ ]

[ Save ]
```

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
Basics: ready
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

1. Prepared speech self-edit (highest immediate value for role takers).
2. Basics editor.
3. Roles list editor.
4. Agenda session card editor.
5. Create-from-source flow.
6. Table Topics participants.
7. Review & Publish.

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
