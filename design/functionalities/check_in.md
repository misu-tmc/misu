# Check in

Provide a QRCode (URL) for attendee to scan. After scan:

- If user has been authenticated (via cookies or wechat identity), show the check in page.
- If user hasn't been authenticated:
  - Drop an identifier.
  - Show the check in page.

Check in page:
- Ask to fill in name or nickname if user doesn't have name (unauthenticated or name not set).
- Ask to confirm the roles the attendee has taken.

The page is mobile centric as most attendees use phones to check in.