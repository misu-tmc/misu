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
