// utils/format.js — shared date/agenda helpers.

const BUFFER_MINUTES = 1;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "2026-07-12" -> "Sat Jul 12"
function shortDate(isoDate) {
  if (!isoDate) return '';
  const parts = isoDate.split('-').map((n) => parseInt(n, 10));
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  return `${WEEKDAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${parts[2]}`;
}

// "19:00" -> minutes since midnight
function toMinutes(hhmm) {
  const [h, m] = (hhmm || '0:0').split(':').map((n) => parseInt(n, 10));
  return h * 60 + m;
}

function toHHMM(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Compute each session's start time from the meeting start + cumulative durations,
// inserting BUFFER_MINUTES between sessions (not after the last one). Mirrors the web
// derivation. Returns sessions augmented with `start` and `taker` (role taker name).
function buildAgenda(meeting) {
  const sessions = (meeting.sessions || []).slice().sort((a, b) => a.position - b.position);
  const slotById = {};
  (meeting.role_slots || []).forEach((s) => {
    slotById[s.id] = s;
  });
  let cursor = toMinutes(meeting.start_time);
  return sessions.map((s, idx) => {
    const start = toHHMM(cursor);
    cursor += s.duration_minutes;
    if (idx < sessions.length - 1) cursor += BUFFER_MINUTES;
    const slot = s.role_slot_id ? slotById[s.role_slot_id] : null;
    return {
      id: s.id,
      start,
      name: s.name,
      group_label: s.group_label,
      duration_minutes: s.duration_minutes,
      taker: slot && slot.booker_name ? slot.booker_name : ''
    };
  });
}

module.exports = { BUFFER_MINUTES, shortDate, buildAgenda };
