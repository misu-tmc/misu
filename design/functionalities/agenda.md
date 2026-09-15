# Agenda

Generate a meeting agenda from the meeting document, role slots, role assignments and
role-specific preparation information.

Inputs:
- Meeting header: number, theme, keyword, date, start/end, venue.
- Sessions: ordered agenda rows, durations and associated role slots.
- Role slots + assignments: booked/taken users for each slot.
- Role prep data: prepared-speaker title/pathway/level/purpose.
- Static club resources: Toastmasters/MISU logos, QR codes, venue/join info and timing
	table.

Outputs:
- **Viewing version**: plain responsive HTML, friendly to mobile devices.
- **Printing version**: a single-sided A4 agenda, implemented as HTML/CSS as one printable
	page.
- **Main slides**: an editable PowerPoint deck using the original
	MISU main-slide layouts.

The agenda is draft by default and can be viewed/edited by any signed-in user. It is
published when ready; after publishing, any signed-in user may still edit it.

## Main Slides

The editor and printed agenda link to `/app/meetings/:id/slides`. This download-only page
creates `MISU Main Agenda <number>.pptx`. Downloading reloads the meeting so newly saved
sessions and assignments are included. There is no browser slide preview or fullscreen
presentation; open the downloaded file in PowerPoint to present it.

The template is derived from **Main Slides MISU 20260831.pptx**, not a reconstruction of
its design. The 39 source layouts retain their native text paragraphs, artwork, masters,
portraits, QR codes, notes, transitions and animated media. Static club information and
officer teams remain as supplied in that reference; they are not meeting role assignments.
The original cover is unchanged, with the meeting title shown on the download page and
PowerPoint document properties.

Generation uses the same agenda derivation as the printed agenda:

- Sessions follow saved position order, with unassigned optional roles omitted.
- Prepared speeches use their agenda override or speech title and assigned speaker.
- Warm Up precedes the club introduction when scheduled that way. An explicit club/TM
  introduction or Opening Remarks session anchors the introduction block and supplies its
  presenter; otherwise an introduction is inserted after the first warm-up session (or before
  the agenda if no warm-up is scheduled), without
  inventing an old presenter. Its updated date comes from the meeting.
- Familiar facilitator, prepared-speech, table-topic and evaluation groups use their original
  dividers, including single-session groups. Other multi-session groups receive one divider
  unless their first session already supplies that heading.
- Consecutive individual evaluations and consecutive facilitator reports are paired using
  the original two-line layouts. Pairs never cross a group boundary. Odd counts leave the
  unused line blank. Names are taken from the actual linked slots, never inferred from the
  reference speakers or their order.
- A generic Table Topics session uses the meeting theme; custom agenda titles are retained.
- Social, voting, awarding and closing sessions use the matching reference layouts.
  A scheduled closing is not followed by a second automatic Closing Remark.
- Appreciation retains the **Meeting Manager** and **Photographer** labels while replacing
  their assigned names. Required unassigned roles display **TBD**; sessions without a role
  display **All**, except title-only divider layouts.
  Reference headshots are retained only for their actual owners. Other assignees receive
  initial-based placeholders in the same circular frames, rather than another person's photo.

The generator clones only the pages required by the agenda, without a fixed session limit.
It removes unused source pages, updates slide IDs and notes backlinks, validates internal
relationships, preserves individual paragraph styling, and reduces oversized text to fit.
Text that cannot fit legibly produces an explicit error rather than a clipped download.
Always start from the immutable template, not a previously generated meeting deck.

The preparation script is kept locally and is not tracked in Git. If you have a local copy,
you can rebuild the checked-in template and text-fitting manifest on Windows with PowerPoint installed:

```powershell
.\apps\spa\scripts\create-main-agenda-template.ps1 `
  -SourcePath 'C:\path\Main Slides MISU 20260831.pptx' `
  -OutputPath '.\apps\backend\static\main-slides\main-agenda-template.pptx'
```

The script measures the native text geometry and fonts for the text-fitting manifest; it
does not export PNGs. The original reference file is never modified. Normal downloads run
entirely in the browser using the native template and fitting data, and do not require
PowerPoint or a server-side document conversion service.

## Print Agenda Design

The printed agenda mirrors the attached Toastmasters examples: a dense, useful one-page
agenda with the meeting agenda as the primary content and operational club information in
the sidebar. It should print cleanly at A4 portrait size.

### Print Shell

HTML structure:

```html
<body class="print-agenda">
	<section class="sheet">...</section>
</body>
```

CSS print constraints:

- `@page { size: A4 portrait; margin: 0; }`
- `.sheet { width: 210mm; height: 297mm; }`
- Use `box-sizing: border-box`, millimeter-based layout dimensions, and fixed font sizes.
- Avoid interactive controls; this is a static render.
- No browser headers/footers; user prints with browser header/footer disabled.
- Use real image assets for logos and QR codes.

### Printed Page — Meeting Agenda

Purpose: the attendee-facing agenda used during the meeting.

Major layout:

```text
┌──────────────────────────────────────────────────────────────┐
│ HEADER        |                                              │
│ [Toastmasters | Microsoft Suzhou Toastmasters Club           │
|  logo]        ├──────────────────────────────────────────────┤
│               |  #142 Regular Meeting · 2026.07.13 18:45   │
│               |  Theme: Embrace Change ·  Keyword: Glory     │
|───────────────┼──────────────────────────────────────────────┤
│ LEFT SIDEBAR  │ MAIN AGENDA TABLE                            │
│               │ ┌──────┬────────────────────┬─────┬────────┐ │
│ Venue         │ │Time  │Session             │Dur. │Taker   │ │
│ Regular time  │ ├──────┼────────────────────┼─────┼────────┤ │
│               │ │18:45 │Registration        │0:15 │Alice   │ │
│ Meeting       │ │19:00 │Call to Order       │0:02 │Bob     │ │
│ manager       │ │..section header rows spanning columns... | |
│ Photographer  │ └──────┴────────────────┴─────┴───────────┘  │
│               │                                              │
│ Officer team  │                                              │
│               │                                              │
│ How to join   │                                              │
│               │                                              │
│ QR code       │                                              │
│               │                                              │
|               ├──────────────────────────────────────────────┤
│               | TIMER GUIDE TABLE                            │
│               | Type | Green | Yellow | Red | Ring Bell      │
└──────────────────────────────────────────────────────────────┘
```

Sections:

- **Header** — club identity, meeting number, date/time, theme, club/area identifiers and
	brand mark(s).
- **Sidebar** — static club information and QR codes: mission, key word, regular meeting
	time, venue, officer team, how to join, guest fee / donation QR.
- **Agenda table** — generated from sessions:
	- Time: client/server computed from meeting start + durations + buffer.
	- Session: group headers and derived agenda row names. `sessions[].agenda_name` is a
		functional display field: for prepared speeches it prefers the speaker's
		`prep_data.title`, otherwise it falls back to `session.name`.
	- Prepared-speech metadata: Pathways path/level/project stays in a smaller secondary
		line when present, without repeating the title.
	- Duration: mm:ss or h:mm style.
	- Role Takers: the slot's `taker_name` (the single assignee), otherwise blank.
- **Timer guide** — static timing rules table at bottom.

Design notes:

- Table borders are thin gray/blue lines similar to the sample.
- Group headers (Warm Up, Prepared Speech, Evaluation, etc.) are centered, low-height rows.
- The printed page prioritizes readability during the meeting; keep the agenda table the
	largest element.
- Prepared speech metadata should stay compact: the title is the agenda row name, and
	Pathways details are a secondary line in the Session cell.

### Printed Page — Back Side (Introduction)

Purpose: the second A4 page — a club/Toastmasters introduction that faces outward for
guests. It follows the **same pattern** as the front cover: the same club-brand header,
fixed-size areas, and tables/grids to align areas and their elements. It is rendered as a
second `<section class="sheet back">` in the same `agenda-print.html`, so one print job
produces front + back.

Major layout (fixed-height rows, top to bottom):

```text
┌──────────────────────────────────────────────────────────────┐
│ HEADER (same club brand as front)                            │
├───────────────────────────┬──────────────────┬──────────────┤
│ Introduction of           │ Four Core Values │ Four Taboos  │
│ Toastmasters (description) │ Integrity Respect│ Politics …   │
│                           │ Service Excellence│  (no-sign)   │
├───────────────────────────┴──────────────────┴──────────────┤
│ Today's Prepared Speakers  (title · pathway · purpose)       │
├───────────────────────────┬──────────────────────────────────┤
│ Regular Meeting Roles      │ Education System: Pathways        │
│ (Timer, Ah-Counter, …)     │ 6 path tiles + 5 competency tiles │
├───────────────────────────┴──────────────────┬──────────────┤
│ Regular Meeting Process (1·2·3)               │ Guest-fee QR │
└───────────────────────────────────────────────┴──────────────┘
```

Sections:

- **Header** — identical to the front page (Toastmasters logo · club name · Microsoft mark).
- **Intro band** — a short Toastmasters description, the **Four Core Values** and the
	**Four Taboos** (with a drawn prohibition sign).
- **Prepared speakers** — rendered from prepared-speaker role slots and their live
	`prep_data` fields: title, speaker/booker, Pathways path/level, purpose and description.
- **Regular Meeting Roles** — a two-column table of role names and one-line descriptions.
- **Pathways** — the six paths as labelled tiles plus the five competency levels.
- **Meeting process** — the three-step meeting flow, with the guest-fee QR beside it.

Icons/symbols: the six **Pathways** use the club's official Toastmasters badge images in
`/static/tm-badges/` (the club is a certified Toastmasters club, licensed to use them).
The **Core Values** and the **prohibition sign** are currently drawn as CSS tiles/shapes;
official Core-Values icons can be dropped into `/static` and swapped into the same slots
later. The header Toastmasters logo and guest-fee QR reuse the existing `/static` assets.

## Data Mapping

Print render should use the same meeting DTO shape as the editor/mini program where
possible:

- `meeting.number`, `theme`, `date`, `start_time`, `end_time`, `venue` → header.
- `sessions[]` + `BUFFER_MINUTES` → agenda start times and structural row fallback names.
- `sessions[].agenda_name` → public agenda row name. This is derived, not stored or posted
	by editors.
- `role_slots[]` + assignments → role taker labels and booking state.
- `role_assignment.prep_data` interpreted by `role.properties` → prepared-speech title
	source plus secondary metadata line in prepared-speech session rows.
- Static resources → configured print asset bundle.

## Asset Checklist

Needed from the user before implementing the HTML:

- Toastmasters International logo.
- MISU / Microsoft Suzhou Toastmasters Club branding assets.
- Microsoft four-color mark, if it should appear.
- Timing/ring-bell table content or image.
- WeChat/club QR code(s), guest-fee QR code(s), donation/payment QR code(s).
- Static club copy: mission, motto/key word, regular meeting time, venue, officer team,
	how-to-join text.
- Prepared-speaker fields to collect/store: title and Pathways path/level/project.

## Implementation Plan

1. Add a printable HTML page under the web surface, e.g. `/meetings/:id/agenda/print`.
2. Build static CSS for one `.sheet` with A4 print sizing.
3. Load meeting JSON from `GET /api/meetings/:id` and render the A4 page client-side, or
	 server-fill the same HTML if a server renderer is later introduced.
4. Add an admin preview link from the meeting editor.
5. Add print-specific QA: browser print preview, A4 sizing and no overflow.