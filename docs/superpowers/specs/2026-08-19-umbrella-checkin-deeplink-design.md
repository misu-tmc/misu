# Umbrella Check-in Deeplink Design

## Summary

MISU exposes one stable check-in URL:

```text
https://<misu-origin>/app/checkin
```

An optional `meetingId` query selects a specific meeting:

```text
https://<misu-origin>/app/checkin?meetingId=<id>
```

The backend, not the browser, chooses the incoming meeting when the ID is
omitted. MISU does not generate QR codes; organizers may encode either URL with
any external tooling.

## Authentication

The check-in page is a normal protected route.

- Unauthenticated users follow the generic authentication flow.
- The login redirect preserves the complete, same-origin destination, including
  query parameters.
- Successful session restoration, account creation, or device migration returns
  the user to an explicit safe `next` destination.
- Login contains no check-in-specific form, heading, copy, or branching.
- The generic account form owns name and optional club collection.

## Meeting Resolution

Add an authenticated umbrella endpoint:

```text
POST /api/checkin
body: { meeting_id?: number }
response: { checked_in: true, meeting_id: number }
```

When `meeting_id` is supplied:

- require a positive integer;
- load the meeting's status; a missing meeting returns not found, a
  `published` meeting proceeds, and any other status (for example `draft`)
  returns a conflict;
- check the authenticated user into that exact meeting.

When `meeting_id` is omitted:

- use the service's local date and time;
- select the earliest published meeting whose window contains now, resolved
  by a service-side Rust function (not a single SQL date/time expression):
  the backend loads `published` candidates scheduled from yesterday through
  tomorrow, then that function parses each candidate's stored schedule and
  picks the match;
- the window includes both 30 minutes before the scheduled start and the
  scheduled end; a blank scheduled end time is treated as the scheduled start
  time — no duration is invented; a nonblank scheduled end time that is
  earlier than the scheduled start time is treated as ending the next
  calendar day (an overnight meeting, for example 23:00–00:30);
- order overlapping matches by scheduled start and then meeting ID;
- a candidate whose stored date or time cannot be parsed is an explicit
  internal error, never a silently skipped row;
- return a conflict-style error when no meeting is open.

Attendance remains one row per `(meeting_id, user_id)`. Repeated requests refresh
the timestamp without creating duplicates.

Existing meeting-specific check-in endpoints remain for meeting-page and
mini-program callers, keep their current existence-only requirement (they do
not newly require `published`), and share only the attendance-recording
operation with the umbrella endpoint — not its status validation.

## Check-in Page

`/app/checkin` parses an optional positive `meetingId`, calls the umbrella
endpoint, stores the returned meeting ID as the current meeting target, and
redirects to `/app/meetings/<meeting_id>`.

Invalid explicit IDs use the exact message `This check-in link is invalid.`;
other backend errors are shown directly. The page does not fall back to
client-side upcoming-meeting selection.

## No QR Generation

This stacked branch's base already contains none of the following — they were
never introduced, so there is nothing to uninstall, delete, or edit:

- No `qrcode` dependency.
- No QR modal, editor QR button, QR download, or copy-link dialogue.
- No check-in-specific login dialogue or guest view.
- No third-party QR service integration.

## Security and Errors

- Attendance user identity always comes from the authenticated session.
- Return destinations must be same-origin absolute paths after browser URL
  normalization.
- Login auto-redirects to the return destination only when the query
  explicitly supplied `next`; otherwise it shows the generic account
  confirmation view.
- Unknown explicit meetings return not found.
- Draft meetings and times with no open incoming meeting return a clear error.
- Failed mini-program check-ins must not be cached as successful.

## Testing

- Meeting-window boundaries: before opening, exactly 30 minutes before start,
  during the meeting, exactly at end, and after end.
- Blank scheduled end time is treated as the scheduled start time (no invented
  duration), including its own boundary cases.
- A scheduled end time earlier than the scheduled start time rolls over to
  the next calendar day (an overnight meeting).
- A candidate with an unparsable stored date or time surfaces as an explicit
  error rather than being silently excluded from selection.
- Earliest selection when windows overlap, including an explicit tie-break by
  meeting ID when scheduled starts are equal.
- Explicit meeting ID success, draft, unknown, and invalid values.
- Idempotent attendance.
- Full query preservation through generic authentication.
- Generic auth auto-redirects to a safe explicit `next` destination, and shows
  the generic account confirmation view otherwise — with no check-in-specific
  UI either way.
- Umbrella page redirects using the backend-returned meeting ID.
- Existing meeting-page and mini-program check-in behavior.
- Continued absence of any QR-generation dependency or editor UI.

## Acceptance Criteria

- `/app/checkin` checks an authenticated user into the currently open incoming
  meeting without a meeting ID.
- `/app/checkin?meetingId=<id>` checks into that published meeting.
- An unauthenticated user completes generic authentication and then resumes the
  original check-in URL automatically.
- MISU contains no QR-generation feature.
