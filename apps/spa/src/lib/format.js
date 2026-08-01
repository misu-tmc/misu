export const BUFFER_MINUTES = 1;

export function shortDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export function toMinutes(hhmm) {
  const [hours, minutes] = String(hhmm || '0:0').split(':').map((part) => Number.parseInt(part, 10) || 0);
  return hours * 60 + minutes;
}

export function toHHMM(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function isPreparedSpeechSlot(slot) {
  const role = String(slot?.role_name || '').toLowerCase();
  return role.includes('speaker') || role.includes('prepared speech');
}

export function buildSpeeches(meeting) {
  return (meeting.role_slots || [])
    .filter(isPreparedSpeechSlot)
    .map((slot) => {
      const speech = slot.speech || {};
      const level = speech.level == null || speech.level === '' ? '' : `L${speech.level}`;
      return {
        id: slot.id,
        title: String(speech.title || '').trim() || slot.label || slot.role_name || 'Prepared speech',
        speaker: slot.taker_name || '',
        meta: [speech.pathway, level].filter(Boolean).join(' · '),
        purpose: speech.purpose || '',
        description: speech.description || '',
        hasContent: !!(slot.taker_name || speech.title || speech.pathway || level || speech.purpose || speech.description)
      };
    })
    .filter((speech) => speech.hasContent);
}

export function buildAgenda(meeting) {
  const slotById = Object.fromEntries((meeting.role_slots || []).map((slot) => [slot.id, slot]));
  const sessions = (meeting.sessions || [])
    .slice()
    .sort((left, right) => left.position - right.position)
    .filter((session) => {
      const slot = session.role_slot_id ? slotById[session.role_slot_id] : null;
      return !(slot?.is_optional && !slot.taker_id);
    });

  let cursor = toMinutes(meeting.start_time);
  return sessions.map((session, index) => {
    const slot = session.role_slot_id ? slotById[session.role_slot_id] : null;
    const speech = slot?.speech || {};
    const start = toHHMM(cursor);
    cursor += Number(session.duration_minutes) || 0;
    if (index < sessions.length - 1) cursor += BUFFER_MINUTES;
    return {
      ...session,
      start,
      name: session.agenda_name || (isPreparedSpeechSlot(slot) && speech.title ? speech.title : session.name),
      sessionName: session.name,
      taker: slot ? (slot.taker_name || '') : 'All',
      prepMeta: [speech.pathway, speech.level == null ? '' : `L${speech.level}`].filter(Boolean).join(' · ')
    };
  });
}

export function computedEndTime(startTime, sessions) {
  const rows = sessions || [];
  const duration = rows.reduce(
    (total, session, index) => total + (Number(session.duration_minutes) || 0) + (index < rows.length - 1 ? BUFFER_MINUTES : 0),
    0
  );
  return toHHMM(toMinutes(startTime) + duration);
}

export function prepTarget(roleName) {
  const role = (roleName || '').toLowerCase();
  if (role.includes('grammarian')) return { tab: 'info', field: 'keyword' };
  if (role.includes('table topics master')) return { tab: 'info', field: 'theme' };
  if (role.includes('speaker') || role.includes('prepared speech')) return { tab: 'speeches', field: '' };
  return { tab: 'roles', field: '' };
}