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

function meetingInfo(meeting) {
  return {
    theme: meeting.theme || '',
    keyword: meeting.keyword || ''
  };
}

function isPreparedSpeechSlot(slot) {
  const role = String((slot && slot.role_name) || '').toLowerCase();
  return role.indexOf('speaker') >= 0 || role.indexOf('prepared speech') >= 0;
}

function speechField(slot, key) {
  if (!slot || !slot.speech) return '';
  return String(slot.speech[key] || '').trim();
}

function agendaName(session, slot) {
  if (session && session.agenda_name) return session.agenda_name;
  const title = speechField(slot, 'title');
  if (isPreparedSpeechSlot(slot) && title) return title;
  return (session && session.name) || '';
}

function speechMeta(slot) {
  if (!slot || !slot.speech) return '';
  const data = slot.speech;
  const level = data.level == null || data.level === '' ? '' : `L${data.level}`;
  return [data.pathway, level].filter(Boolean).join(' · ');
}

// Drop sessions for untaken optional roles, then compute each remaining session's start
// time from the meeting start + cumulative durations, inserting BUFFER_MINUTES between
// sessions (not after the last one). Mirrors the web agenda derivation. Returns sessions
// augmented with `start` and `taker` (role taker name).
function buildAgenda(meeting) {
  const slotById = {};
  (meeting.role_slots || []).forEach((s) => {
    slotById[s.id] = s;
  });
  const sessions = (meeting.sessions || [])
    .slice()
    .sort((a, b) => a.position - b.position)
    .filter((session) => {
      const slot = session.role_slot_id ? slotById[session.role_slot_id] : null;
      return !(slot && slot.is_optional && !slot.taker_id);
    });
  let cursor = toMinutes(meeting.start_time);
  return sessions.map((s, idx) => {
    const start = toHHMM(cursor);
    cursor += s.duration_minutes;
    if (idx < sessions.length - 1) cursor += BUFFER_MINUTES;
    const slot = s.role_slot_id ? slotById[s.role_slot_id] : null;
    const taker = slot ? (slot.taker_name || '') : 'All';
    return {
      id: s.id,
      start,
      name: agendaName(s, slot),
      agenda_name: agendaName(s, slot),
      session_name: s.name,
      group_label: s.group_label,
      duration_minutes: s.duration_minutes,
      taker,
      prepMeta: speechMeta(slot)
    };
  });
}

module.exports = { BUFFER_MINUTES, shortDate, buildAgenda, meetingInfo };
