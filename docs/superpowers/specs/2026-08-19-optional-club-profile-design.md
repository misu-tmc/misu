# Optional Club Profile Design

## Summary

MISU user profiles gain an optional club name. New users may provide it during
the normal account-creation flow, and signed-in users may edit or clear it from
their profile.

This change is independent of meeting check-in.

## Data and API

- Add nullable `user.club_name VARCHAR(255)`.
- Include `club_name` in authenticated user responses for web, device, and
  WeChat authentication.
- Accept optional `club_name` during device registration.
- Accept optional `club_name` in self profile updates:
  - omitted: preserve the stored value;
  - blank: clear the stored value;
  - non-blank: trim and store it.
- Require a non-empty display name of at most 255 Unicode characters and a club
  name of at most 255 Unicode characters.
- Allow users to update only their own profile through the profile endpoint.

## User Experience

- The normal **Create account** form asks for:
  - **Name**: required;
  - **Club (optional)**: optional.
- The profile page exposes the same two fields.
- Existing users and clients that omit `club_name` remain compatible.
- No check-in-specific account form or copy is introduced.

## Testing

- Profile-field normalization and ownership.
- Device registration with absent, blank, and populated club values.
- Auth responses preserve club information.
- Generic account creation submits a trimmed optional club.
- Profile editing loads, updates, and clears the value.

## Acceptance Criteria

- The optional club field can be supplied during generic account creation.
- It can be updated or cleared later.
- Existing clients that omit it do not lose stored profile data.
- The change contains no meeting check-in behavior.
