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

Add a user management page in the next stage so site admins can promote users and assign
meeting managers/admin responsibilities through the app. For the first stage, permission
bootstrap can stay outside the app.

## Permission granularity

Finer-grained roles may be needed later for management workflows. For now, the
`site_admin` model plus meeting-scoped `meeting_manager` is enough.
