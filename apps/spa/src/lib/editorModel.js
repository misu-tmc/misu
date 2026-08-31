import { computedEndTime, isPreparedSpeechSlot } from './format.js';

export function emptyMeeting(number = 1) {
  return {
    id: null,
    number,
    title: 'Regular Meeting',
    theme: '',
    keyword: '',
    date: '',
    start_time: '19:00',
    end_time: '19:00',
    venue: '',
    status: 'draft',
    role_slots: [],
    sessions: []
  };
}

export function cloneAsTemplate(source) {
  const date = source.date ? new Date(`${source.date}T00:00:00Z`) : null;
  if (date) date.setUTCDate(date.getUTCDate() + 14);
  const number = Number(source.number || 0) + 1;
  const sourceSlots = (source.role_slots || []).filter((slot) => slot.is_bookable !== false);
  const keyById = new Map(sourceSlots.map((slot, index) => [slot.id, `new-${index}`]));
  return {
    ...source,
    id: null,
    number,
    title: source.title,
    theme: '',
    keyword: '',
    date: date ? date.toISOString().slice(0, 10) : '',
    status: 'draft',
    role_slots: sourceSlots.map((slot, index) => ({ ...slot, id: null, _key: `new-${index}`, taker_id: null, taker_name: null, speech: null })),
    sessions: (source.sessions || []).map((session, index) => ({
      ...session,
      id: null,
      _key: `new-session-${index}`,
      role_slot_id: null,
      _role_slot_key: session.role_slot_id == null ? null : (keyById.get(session.role_slot_id) || null)
    }))
  };
}

export function splitMeeting(detail, attendees = []) {
  const bookableSlots = (detail.role_slots || [])
    .filter((slot) => slot.is_bookable !== false)
    .map((slot) => ({ ...slot, _key: `slot-${slot.id}` }));
  const keyById = new Map(bookableSlots.map((slot) => [slot.id, slot._key]));
  const tableTopics = (detail.role_slots || [])
    .filter((slot) => slot.is_bookable === false)
    .map((slot) => ({
      role_slot_id: slot.id,
      user_id: attendees.some((user) => user.id === slot.taker_id) ? slot.taker_id : null,
      name: slot.taker_name || slot.label || ''
    }));
  const speeches = bookableSlots.filter(isPreparedSpeechSlot).map((slot) => ({
    role_slot_id: slot.id,
    label: slot.label,
    taker_name: slot.taker_name || '',
    title: slot.speech?.title || '',
    pathway: slot.speech?.pathway || '',
    level: slot.speech?.level ?? '',
    purpose: slot.speech?.purpose || '',
    description: slot.speech?.description || ''
  }));
  return {
    meeting: {
      ...detail,
      role_slots: bookableSlots,
      sessions: (detail.sessions || [])
        .slice()
        .sort((a, b) => a.position - b.position)
        .map((session) => ({
          ...session,
          _key: `session-${session.id}`,
          _role_slot_key: keyById.get(session.role_slot_id) || null
        }))
    },
    tableTopics,
    speeches
  };
}

export function buildUpsertPayload(meeting, isTemplate = false) {
  const slots = (meeting.role_slots || []).filter((slot) => (slot.role_name || '').trim());
  const slotIndex = new Map();
  slots.forEach((slot, index) => {
    if (slot.id != null) slotIndex.set(`id:${slot.id}`, index);
    if (slot._key) slotIndex.set(`key:${slot._key}`, index);
  });
  return {
    meeting_id: meeting.id || null,
    number: meeting.number === '' ? null : Number(meeting.number),
    title: String(meeting.title || '').trim(),
    theme: String(meeting.theme || '').trim(),
    keyword: String(meeting.keyword || '').trim(),
    date: meeting.date,
    start_time: meeting.start_time,
    end_time: meeting.end_time || computedEndTime(meeting.start_time, meeting.sessions),
    venue: String(meeting.venue || '').trim(),
    status: meeting.status === 'published' ? 'published' : 'draft',
    is_template: !!isTemplate,
    role_slots: slots.map((slot) => ({
      role_slot_id: slot.id || null,
      role_id: slot.role_id || null,
      role_name: slot.role_id ? null : String(slot.role_name || '').trim(),
      label: String(slot.custom_label ?? '').trim() || null,
      is_optional: !!slot.is_optional
    })),
    sessions: (meeting.sessions || []).map((session, index) => ({
      position: index,
      group_label: String(session.group_label || '').trim(),
      name: String(session.name || '').trim(),
      duration_minutes: Number(session.duration_minutes) || 0,
      role_slot_index: session._role_slot_key
        ? (slotIndex.get(`key:${session._role_slot_key}`) ?? null)
        : session.role_slot_id == null
          ? null
          : (slotIndex.get(`id:${session.role_slot_id}`) ?? null)
    }))
  };
}

export function buildSlotsPayload(slots) {
  return (slots || []).map((slot) => ({
    role_slot_id: slot.id || null,
    role_id: slot.role_id || null,
    role_name: slot.role_id ? null : String(slot.role_name || '').trim() || null,
    label: String(slot.custom_label ?? '').trim() || null,
    voting_group: String(slot.voting_group || '').trim() || null,
    is_optional: !!slot.is_optional,
    taker_id: slot.taker_id || null
  }));
}

export function buildSessionsPayload(sessions) {
  return (sessions || []).map((session) => ({
    group_label: String(session.group_label || '').trim(),
    name: String(session.name || '').trim(),
    duration_minutes: Number(session.duration_minutes) || 0,
    role_slot_id: session.role_slot_id || null
  }));
}

export function assignTopicUser(topics, topicIndex, user) {
  return (topics || []).map((topic, index) => index === topicIndex
    ? { ...topic, user_id: user.id, name: user.display_name }
    : topic);
}

export function assignRoleUser(slots, slotIndex, user) {
  return (slots || []).map((slot, index) => index === slotIndex
    ? { ...slot, taker_id: user.id, taker_name: user.display_name }
    : slot);
}

export function assignCatalogRole(slots, slotIndex, role) {
  return (slots || []).map((slot, index) => index === slotIndex
    ? { ...slot, role_id: role.id, role_name: role.name, voting_group: role.voting_group || '' }
    : slot);
}

export function reorderItem(items, fromIndex, toIndex) {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= items.length || toIndex >= items.length) {
    return items;
  }
  const next = items.slice();
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}