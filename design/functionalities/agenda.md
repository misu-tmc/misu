# Agenda

Generate a meeting agenda from the meeting document, role slots, role assignments and
role-specific preparation information.

Inputs:
- Meeting header: number, theme, date, start/end, venue.
- Sessions: ordered agenda rows, durations and associated role slots.
- Role slots + assignments: booked/taken users for each slot.
- Prepared-speaker information: speech title and Pathways path/level/project.
- Static club resources: Toastmasters/MISU logos, QR codes, venue/join info and timing
	table.

Outputs:
- **Viewing version**: plain responsive HTML, friendly to mobile devices.
- **Printing version**: a single-sided A4 agenda, implemented as HTML/CSS as one printable
	page.

The agenda is draft by default and can be viewed/edited by admins. It is published when
ready; after publishing, only admins/meeting managers may edit it.

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
	- Session: group headers and agenda row names. For prepared speeches, include the
		speech title and Pathways path/level/project under the session name in a smaller line
		(e.g. `The Feline Savior of Kishi Station · Presentation Mastery L2`).
	- Duration: mm:ss or h:mm style.
	- Role Takers: `taker_name` after check-in, otherwise `booker_name`, otherwise blank.
- **Timer guide** — static timing rules table at bottom.

Design notes:

- Table borders are thin gray/blue lines similar to the sample.
- Group headers (Warm Up, Prepared Speech, Evaluation, etc.) are centered, low-height rows.
- The printed page prioritizes readability during the meeting; keep the agenda table the
	largest element.
- Prepared speech metadata should stay compact: one secondary line in the Session cell,
	not a separate back-side speaker section.

## Data Mapping

Print render should use the same meeting DTO shape as the editor/mini program where
possible:

- `meeting.number`, `theme`, `date`, `start_time`, `end_time`, `venue` → header.
- `sessions[]` + `BUFFER_MINUTES` → agenda start times.
- `role_slots[]` + assignments → role taker labels and booking state.
- Prepared-speaker properties (if there are) → secondary metadata line in prepared-speech
	session rows (speech title + Pathways path/level/project).
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