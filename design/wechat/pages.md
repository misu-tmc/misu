# WeChat mini program pages

Native chrome: a bottom **tabBar** for top-level navigation and page-stack drill-down for
detail. The native top bar (title + back) is provided by WeChat — no custom header like
the web surface.

## TabBar

Four tabs for everyone:

- `Booking` · `Meeting` · `MISU` · `Me`

```
┌───────────┬───────────┬───────────┬───────────┐
│ Booking   │  Meeting  │   MISU    │    Me     │
└───────────┴───────────┴───────────┴───────────┘
```

Admin tasks are not a tab in the first stage — see `todo.md`. Any lightweight admin
actions surface inside a meeting for admins.

## Booking

Role booking for **upcoming meetings** — the phone (1-per-row) form of the card grid from
[../functionalities/role_registration.md](../functionalities/role_registration.md).

Layout (native top bar + content + native bottom tabBar):

```
┌─────────────────────────────┐
│  Booking                    │  ← native top bar (title)
├─────────────────────────────┤
│  Your bookings              │  ← shown only if you have any
│  #142 · Jul 12 · Table Topics│
│                 [ Prepare ] │
│  #143 · Jul 26 · TMOD       │
│                 [ Prepare ] │
├─────────────────────────────┤
│  #142 · Sat Jul 12          │  ← meeting card
│  Embrace Change             │
│   TMOD         Alice        │
│   Speaker 1   [ Take! ]     │
│   Evaluator 1  Carol        │
│   Table Topics[ Take! ]     │
├─────────────────────────────┤
│  #143 · Sat Jul 26          │
│   Speaker 1   [ Take! ]     │
│   …                         │
├─────────────────────────────┤
│  #144 · Sat Aug 09          │
│   Tap to view open roles ▾  │  ← far-out meetings collapsed
├─────────────────────────────┤
│ Booking │ Meeting │MISU│ Me │  ← native bottom tabBar
└─────────────────────────────┘
```

### Contents

- **Your bookings** (top, only if any) — one row per booking: `#142 · Jul 12 · Table Topics`
  with a **Prepare** button. Lists the user's bookings across upcoming meetings.
- **Meeting cards** — `scroll-view` of upcoming meetings. Each card: header
  (`#number · date`, theme) and role rows. A role row shows the **taker's name** when
  taken, or a **Take!** button when open. Roles not offered that meeting are omitted.
- Far-out meetings collapse to a "tap to view open roles" summary.

### Interactions

- **Take!** → `POST /api/book { meeting_id, role_slot_id }` (actor from the WeChat
  session) → confirm → the row shows your name and it appears under Your bookings.
- **Prepare** → pushes a prepare page for that booking (speech title/level, evaluatee —
  the role's `properties`).

### Data

- `GET /api/meetings/future` — upcoming meetings, their role slots and takers.
- Your bookings = slots where `booker_id = me`.
- **Freshness**: bookings change as others take/release roles, so while the user is on
  this page it should **refresh regularly** (e.g. re-fetch on show and poll on an
  interval) to reflect the newest availability. See the data-fetching TODO for a better
  long-term approach.

### Notes

- Booking requires WeChat identity (already established via `POST /api/auth/wechat`); no
  name prompt (unlike web guests).
- Member-only roles (deferred) would disable Take! for non-members later.

## Meeting

The **ongoing / current meeting**: info and agenda, plus the during-meeting actions.

- Meeting info (number, date, theme, venue).
- **Agenda** (client-computed from the meeting document).
- **Check-in** entry (also reachable by scanning the QR).
- **Voting** once the voting page is opened.
- **Timer** for the timer role (full-screen).

## Me

- WeChat profile / identity.
- **Update user information**.
- (Also convenient: a shortcut to Your bookings / role history.)

## MISU

Club introduction — static content about MISU (about, meeting cadence, how to join,
contact). No login required.

## Navigation notes

- **QR check-in** deep-links straight into the meeting's check-in card flow.
- **Timer** is a full-screen tool launched from within the Meeting tab, not its own tab.
- Manager actions appear inside a meeting for admins; no separate admin tab in stage one.
