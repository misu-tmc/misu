# Agenda

Generate a meeting agenda from the meeting document, role slots, role assignments and
role-specific preparation information.

Inputs:
- Meeting header: number, theme, date, start/end, venue.
- Sessions: ordered agenda rows, durations and associated role slots.
- Role slots + assignments: booked/taken users for each slot.
- Prepared-speaker information: speech title, Pathways path/level/project, purpose and
	description.
- Static club resources: Toastmasters/MISU logos, QR codes, mission/values/taboos,
	venue/join info, timing table and education-system graphics.

Outputs:
- **Viewing version**: plain responsive HTML, friendly to mobile devices.
- **Printing version**: a two-sided A4 agenda, implemented as HTML/CSS with two printable
	pages (`front` and `back`), intended for duplex printing on one A4 paper.

The agenda is draft by default and can be viewed/edited by admins. It is published when
ready; after publishing, only admins/meeting managers may edit it.

## Print Agenda Design

The printed agenda mirrors the attached Toastmasters examples: a dense, useful one-pager
with the meeting agenda on the front and supporting club/speaker/education information on
the back. It should print cleanly at A4 portrait size.

### Print Shell

HTML structure:

```html
<body class="print-agenda">
	<section class="sheet front">...</section>
	<section class="sheet back">...</section>
</body>
```

CSS print constraints:

- `@page { size: A4 portrait; margin: 0; }`
- `.sheet { width: 210mm; height: 297mm; page-break-after: always; }`
- Use `box-sizing: border-box`, millimeter-based layout dimensions, and fixed font sizes.
- Avoid interactive controls; this is a static render.
- No browser headers/footers; user prints with browser header/footer disabled.
- Use real image assets for logos, QR codes and Pathways graphics.

### Front Side — Meeting Agenda

Purpose: the attendee-facing agenda used during the meeting.

Major layout:

```text
┌──────────────────────────────────────────────────────────────┐
│ HEADER                                                       │
│ [Toastmasters logo] Microsoft Suzhou Toastmasters Club        │
│                   #142 Regular Meeting · 2026.07.13 18:45     │
│                   Theme: Embrace Change · Club/Area info      │
├───────────────┬──────────────────────────────────────────────┤
│ LEFT SIDEBAR  │ MAIN AGENDA TABLE                            │
│               │ ┌──────┬────────────────┬─────┬───────────┐ │
│ WHERE LEADERS │ │Time  │Session         │Dur. │Role Taker │ │
│ ARE MADE      │ ├──────┼────────────────┼─────┼───────────┤ │
│               │ │18:45 │Registration    │0:15 │Alice      │ │
│ Mission       │ │19:00 │Call to Order   │0:02 │Bob        │ │
│ Key Word      │ │... section header rows spanning columns ...│ │
│ Glory         │ └──────┴────────────────┴─────┴───────────┘ │
│               │                                              │
│ Regular time  │                                              │
│ Venue         │                                              │
│ Officer team  │                                              │
│ Photographer  │                                              │
│ How to join   │                                              │
│ QR code       │                                              │
├───────────────┴──────────────────────────────────────────────┤
│ TIMER GUIDE TABLE                                            │
│ Type of speech | Green | Yellow | Red | Ring Bell            │
└──────────────────────────────────────────────────────────────┘
```

Sections:

- **Header** — club identity, meeting number, date/time, theme, club/area identifiers and
	brand mark(s).
- **Sidebar** — static club information and QR codes: mission, key word, regular meeting
	time, venue, officer team, how to join, guest fee / donation QR.
- **Agenda table** — generated from sessions:
	- Time: client/server computed from meeting start + durations + buffer.
	- Session: group headers and agenda row names.
	- Duration: mm:ss or h:mm style.
	- Role Takers: `taker_name` after check-in, otherwise `booker_name`, otherwise blank.
- **Timer guide** — static timing rules table at bottom.

Design notes:

- Table borders are thin gray/blue lines similar to the sample.
- Group headers (Warm Up, Prepared Speech, Evaluation, etc.) are centered, low-height rows.
- The front side prioritizes readability during the meeting; keep the agenda table the
	largest element.

### Back Side — Club, Speakers and Education

Purpose: durable reference information and prepared-speaker details.

Major layout:

```text
┌──────────────────────────────────────────────────────────────┐
│ INTRODUCTION OF TOASTMASTERS                                 │
│ [Toastmasters logo] intro copy + values + taboos             │
├──────────────────────────────────────────────────────────────┤
│ TODAY'S PREPARED SPEAKERS                                    │
│ Speaker 1 title / speaker / pathway / purpose / description  │
│ Speaker 2 title / speaker / pathway / purpose / description  │
│ ...                                                          │
├──────────────────────────────┬───────────────────────────────┤
│ REGULAR MEETING ROLES        │ EDUCATION SYSTEM: PATHWAYS    │
│ Timer                         │ [Pathways image / badges]     │
│ Ah-Counter                    │ [5 core competencies graphic] │
│ Grammarian                    │                               │
│ TOE / Speaker / TTM / IE...   │                               │
├──────────────────────────────┴───────────────────────────────┤
│ REGULAR MEETING PROCESS                         [QR / fee]   │
└──────────────────────────────────────────────────────────────┘
```

Sections:

- **Toastmasters introduction** — static intro text, values graphics, taboos box.
- **Today's prepared speakers** — dynamic from prepared-speaker role preparation:
	- Speech title.
	- Speaker name.
	- Pathways path / level / project.
	- Speech purpose.
	- Speech description.
- **Regular meeting roles** — static short definitions of recurring roles.
- **Education system: Pathways** — static graphic(s) and explanatory labels.
- **Regular meeting process** — static sequence explaining prepared speech, table topics
	and evaluation sessions.
- **QR/payment block** — static QR or fee block as supplied.

Design notes:

- This side can be denser and more informational than the front.
- Prepared speakers should get priority; if there are many speeches, shrink/static sections
	first before shrinking speaker text too aggressively.

## Data Mapping

Print render should use the same meeting DTO shape as the editor/mini program where
possible:

- `meeting.number`, `theme`, `date`, `start_time`, `end_time`, `venue` → header.
- `sessions[]` + `BUFFER_MINUTES` → agenda start times.
- `role_slots[]` + assignments → role taker labels and booking state.
- Prepared-speaker properties (deferred) → back-side prepared speaker section.
- Static resources → configured print asset bundle.

## Asset Checklist

Needed from the user before implementing the HTML:

- Toastmasters International logo.
- MISU / Microsoft Suzhou Toastmasters Club branding assets.
- Microsoft four-color mark, if it should appear.
- Pathways education-system graphic(s).
- Timing/ring-bell table content or image.
- WeChat/club QR code(s), guest-fee QR code(s), donation/payment QR code(s).
- Static club copy: mission, motto/key word, regular meeting time, venue, officer team,
	how-to-join text, role definitions, meeting-process text, taboos.
- Prepared-speaker fields to collect/store: title, Pathways path/level/project, purpose,
	description.

## Implementation Plan

1. Add a printable HTML page under the web surface, e.g. `/meetings/:id/agenda/print`.
2. Build static CSS for `.sheet.front` and `.sheet.back` with A4 print sizing.
3. Load meeting JSON from `GET /api/meetings/:id` and render both sides client-side, or
	 server-fill the same HTML if a server renderer is later introduced.
4. Add an admin preview link from the meeting editor.
5. Add print-specific QA: browser print preview, A4 sizing, no overflow, and duplex side
	 ordering.