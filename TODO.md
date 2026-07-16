# TODO

## Membership handling

Membership is a **time-sensitive** relationship, not a fixed flag on a user — a person
can be a member during some periods and not others (joined, lapsed, renewed). Model it as
a time-bounded relationship (e.g. membership periods with start/end) rather than a boolean
on `user`. Until then, `user` carries no membership field; guest vs. member is undecided.

Affects: role booking (member-only roles), check-in reporting, and any
member-based reporting.

## Officer handling

Officer roles (e.g. President, VP Education, Secretary) are also **time-sensitive** — a
user holds an officer role for a term, then hands it over. Model officer assignments as
time-bounded terms (role + start/end) rather than a static attribute. See
`design/functionalities/officers.md`.

## Check-in page

Defer the check-in page to the next stage. No-role attendees change attendance tracking:
the system needs a real check-in record for people who attend without taking a role, not
only role booking updates.

## User management and admin assignment

Add a user management page in the next stage. For the first stage, every authenticated
user can perform any action, so no roles need to be assigned through the app.

## Permission granularity

Finer-grained roles may be needed later for management workflows. For now, every action
simply requires a signed-in session — there are no permission scopes.

## Admin tasks in the WeChat mini program

The first-stage mini program has only two tabs (Meetings, Me). Add admin capabilities in
WeChat later — a management surface (e.g. a Management tab or in-meeting admin actions) for
lightweight create / edit / publish, role assignment review and templates. Admin editing
stays web-first for now. A role-based tabBar would need a custom tabBar component.

## Data fetching / freshness

Booking (and other live) pages currently rely on **re-fetch on show + interval polling**
to stay current as roles are taken/released. Improve this later — e.g. push/subscribe
(WebSocket or WeChat message channel), ETag/If-None-Match to cut payloads, or a shared
client cache with targeted invalidation — to reduce latency and traffic.

## Current-session highlight on the Meeting agenda

The mini program Meeting agenda currently does not highlight the in-progress session.
Add a "now" indicator later that marks the current session during a meeting (derived from
session start times + elapsed time), so attendees can see where the meeting is.


## Poster generation


## MISU Logo


## WeChat Mini Program Banner


## A separate template table


## React style web app