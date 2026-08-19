const INVALID_LINK = 'This check-in link is invalid.';

/**
 * Parses the optional `meetingId` query value for the umbrella check-in
 * deeplink. Missing entirely means "let the backend pick the open meeting"
 * (returns `null`); anything present must be a decimal positive safe
 * integer, otherwise the link is rejected before any API call is made.
 */
export function optionalMeetingId(search) {
  const raw = new URLSearchParams(search).get('meetingId');
  if (raw === null) return null;
  if (!/^\d+$/.test(raw)) throw new Error(INVALID_LINK);
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error(INVALID_LINK);
  return id;
}
