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

The page opens already pre-filled from the last meeting; the template selector lets
the admin switch to Blank or a saved template if needed. Whatever is chosen, the
admin lands on the same sessions grid, pre-filled accordingly.

## Meeting info header

- Title / meeting number
- Theme
- Date
- Time
- Venue

On **Duplicate last meeting**, the service auto-suggests the next date (+14 days) and
the next meeting number. Both are editable.

## Sessions grid

A spreadsheet-style grid backed by a typed `Sessions` table (not free-form cells).
The grid ports cleanly to the WeChat mini program because each cell is a typed field.

Columns:
- Order (move up / down controls `▲▼`)
- Group — groups consecutive sessions (e.g. "Opening", "Prepared Speeches",
  "Table Topics"); used for visual grouping in the printed agenda
- Session name
- Minutes (number)
- Role slot(s)

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
│  ┌──┬──────────────┬──────────────────┬─────┬───────────┐  │
│  │# │ Group        │ Session          │Mins │ Role slot │  │
│  ├──┼──────────────┼──────────────────┼─────┼───────────┤  │
│  │▲▼│ Opening      │ Opening / TMOD   │  5  │ TMOD ▾    │🗑 │
│  │▲▼│ Speeches     │ Prepared Speech 1│  7  │ Speaker ▾ │🗑 │
│  │▲▼│ Speeches     │ Evaluation 1     │  3  │ Evaluator▾│🗑 │
│  │▲▼│ Table Topics │ Table Topics     │ 20  │ TT Master▾│🗑 │
│  └──┴──────────────┴──────────────────┴─────┴───────────┘  │
│  [ + Add session ]                                         │
├────────────────────────────────────────────────────────────┤
│   [ Preview ]   [ Save draft ]   [ ⭐ Save as template ]   │
│                                            [ Publish ]     │
└────────────────────────────────────────────────────────────┘
```

- **Start from** is a single dropdown at the top, defaulting to *Last meeting*.
- The meeting header is a few plain fields.
- The sessions grid supports add / delete / update inline; `≡` reorders rows.
- Actions sit at the bottom: Preview, Save draft, Save as template, Publish.
