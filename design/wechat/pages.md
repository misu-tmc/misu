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

The **ongoing / current meeting**: a title card with info and actions, then the agenda.

```
┌─────────────────────────────┐
│  Meeting                    │  ← native top bar
├─────────────────────────────┤
│ #142 · Sat Jul 12 · 19:00 │  ← title card
│ Embrace Change · Room A     │
│ [ Check in ] [ Vote for     |
│   best ] [ Timer mode ]     │
├─────────────────────────────┤
│  Agenda                     │
│  19:00  Opening / TMOD  Bob │
│  19:06  Speech 1   7'  Carol│
│  19:14  Evaluation 1 3' Dan │
│  19:18  Table Topics 20' Eve│
│  …                          │
├─────────────────────────────┤
│ Booking │ Meeting │MISU│ Me │
└─────────────────────────────┘
```

### Which meeting it shows

- **During a meeting** → that meeting.
- Otherwise → the **next upcoming published** meeting (agenda preview).
- **None** → empty state ("No upcoming meeting yet").

### Title card

Meeting info (number · date · time · theme · venue) plus the action buttons:

- **Check in** — opens the check-in card flow ([../functionalities/check_in.md](../functionalities/check_in.md)); the QR deep-links into the same flow.
- **Vote for the best** — appears once the voting page is opened; pushes the voting page.
- **Timer mode** — shown to the timer-role taker (and admins); launches the full-screen timer.

### Agenda

The **client-computed** agenda (same derivation as web: start times from durations +
buffer), one row per session: `time · name · duration · taker`.

### Phase behavior

- **Before**: agenda preview; check-in hidden or "not open yet".
- **During**: check-in prominent, timer for the timer role, vote when opened.
- **After**: a results entry (voting outcomes).

### Deferred / data

- The voting page and timer tool are their own designs
  ([../functionalities/voting.md](../functionalities/voting.md),
  [../functionalities/timer_tool.md](../functionalities/timer_tool.md)); this page links
  into them.
- Data: `GET /api/meetings/:meeting_id` for the active meeting; during the meeting it
  benefits from the same refresh approach as Booking (see the data-fetching TODO).

## Me

WeChat profile + update user info, with shortcuts to the user's roles.

```
┌─────────────────────────────┐
│  Me                         │  ← native top bar
├─────────────────────────────┤
│  [ avatar ]  <display name> │  ← profile header
│              Edit profile › │
├─────────────────────────────┤
│  My bookings              › │  ← upcoming booked roles
│  My history               › │  ← past roles taken (later)
├─────────────────────────────┤
│  About / Settings         › │  (optional)
├─────────────────────────────┤
│ Booking │ Meeting │MISU│ Me │
└─────────────────────────────┘
```

### Contents

- **Profile header** — WeChat avatar + `display_name`. **Edit profile** pushes an edit page.
- **Edit profile page** — edit `display_name` now (contact / Toastmasters details later);
  saves via `POST /api/users/:user_id` (self). WeChat can prefill avatar/nickname
  (`wx.getUserProfile`); the user can override the display name.
- **My bookings** — shortcut to upcoming booked roles (same data as Booking's Your bookings).
- **My history** — past roles taken (`taker_id = me` on past meetings); deferred until
  past-meeting queries exist.
- **About / Settings** — optional (app version, contact).

### Notes

- Identity is WeChat — no password login, no logout button (session from
  `POST /api/auth/wechat`).
- `display_name` is the same `user.display_name` used everywhere (booking, check-in, agenda).
- Membership / officer info is deferred (time-sensitive TODO), so no membership badge yet.

## MISU

Club introduction — static content, no login. Scrolling sections:

```
┌─────────────────────────────┐
│  MISU                       │  ← native top bar
├─────────────────────────────┤
│      [ club logo ]          │
│   Microsoft Suzhou          │
│   Toastmasters Club         │
│   "Where leaders are made"  │  ← hero
├─────────────────────────────┤
│  About                      │
│  Who MISU is and what we do.│
├─────────────────────────────┤
│  Meetings                   │
│  Every other Sat · 19:00    │
│  Room A, Building X         │
├─────────────────────────────┤
│  Join us                    │
│  How to attend / become a   │
│  member.                    │
├─────────────────────────────┤
│  Contact                    │
│  [ WeChat group QR ]        │
├─────────────────────────────┤
│ Booking │ Meeting │MISU│ Me │
└─────────────────────────────┘
```

Sections:
- **Hero** — logo, club name, motto.
- **About** — short intro paragraph.
- **Meetings** — cadence + venue.
- **Join us** — how a guest attends and becomes a member.
- **Contact** — WeChat group QR and/or officer contact.
- *(later)* officers list, gallery, achievements.

Content: bundled as static copy + images at first. If admins should edit it without
republishing, serve it from a small `GET /api/club-info` later. Simple WeChat components
(`image`, `text`, `view`); no dynamic data initially.

## Navigation notes

- **QR check-in** deep-links straight into the meeting's check-in card flow.
- **Timer** is a full-screen tool launched from within the Meeting tab, not its own tab.
- Manager actions appear inside a meeting for admins; no separate admin tab in stage one.
