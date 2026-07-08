# Role booking

A page for users to book role in the forthcoming published **meetings**. Hence the page should show:
- The forthcoming meetings' information.
- Available roles in the forthcoming meetings.

We encourage booking roles in as many meetings in advance as possible. Booking writes
the same per-meeting role *assignment* records that admin role-assignment does.

## Layout: responsive card grid

Attendee-facing and mobile-first. Forthcoming meetings are shown as **meeting cards** in
a responsive grid, newest first:

- **Wide screens**: up to **3 cards per row**.
- **Narrower screens**: drop to **2** or **1** card per row, whichever fits.

Each card is **self-contained** — it shows everything needed to book that meeting
without looking elsewhere.

If the user has already booked any roles, a **"Your bookings"** summary is shown **above
the meeting cards** (and only then). The individual cards do not repeat the user's own
bookings.

```
Your bookings
  #142 · Table Topics                  [ Prepare for this ]  ×
  #143 · TMOD                          [ Prepare for this ]  ×
────────────────────────────────────────────────────────────────────
Wide (3 per row)                              Narrow (1 per row)
┌──────────────┐ ┌──────────────┐    ┌───────────────────┐
│ #142 Jul 12  │ │ #143 Jul 26  │    │ #142 · Sat Jul 12  │
│ TMOD   Alice │ │ TMOD [Take!] │    │ TMOD         Alice │
│ Speaker[Take]│ │ Speaker  Bob │    │ Speaker 1  [ Take! ]│
│ Evaltr Carol │ │ Spkr2 [Take!]│    │ Evaluator 1  Carol │
└──────────────┘ └──────────────┘    │ Table Topics[ Take!]│
                                     └───────────────────┘
```

## Your bookings summary

Shown above the cards only when the user has at least one booking. Each booking is its
own **row** listing the meeting + role (e.g. `#142 · Table Topics`), with:

- a **“Prepare for this” button** alongside, reminding the user to provide the extra
  information some roles need (e.g. speech title/level for a Speaker, evaluatee for an
  Evaluator). Once the required info is complete, the button reflects a done state; roles
  needing no extra info show no button.
- a **cancel** control (×) to release the booking.

This keeps every member's own commitments — and any outstanding info they still owe — in
one glance, without repeating them inside cards.

## Card contents

- **Header**: meeting number + date (e.g. `#142 · Sat Jul 12`).
- **Roles**: the meeting's role slots, one per row. Alongside each role is the **name of
  its role taker** if taken; **open** roles show a **Take!** action instead. Roles not
  offered that meeting simply don't appear.
- The user's own bookings are also collected in the "Your bookings" summary above the
  grid.

## Interactions

- **Take!**: tap an open role's **Take!** action → confirm → your name fills the role and
  it is added to the "Your bookings" summary above the grid.
- **Prepare for this**: tap the "Prepare for this" button on a booking row to provide the
  extra details the role requires.
- **Cancel**: tap the × on a booking row → confirm → the role returns to that meeting's
  available chips.
- **Filter** (top of page): narrow to meetings needing a specific role.

## Open items

- **WeChat auth details**: users must be authenticated before booking. Web uses the
  current login/register flow; mini-program identity resolution is next-stage work.
- **Meeting horizon**: show a fixed number of upcoming meetings, or all forthcoming
  published ones.
- **Member-only roles** and **extra info** (speech title/level, evaluatee) are deferred,
  per the Roles-catalog notes in `meeting_info.md`.
