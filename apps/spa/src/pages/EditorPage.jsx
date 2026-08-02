import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Link, useLocation } from 'wouter-preact';
import { catalogApi, checkinApi, meetingsApi, usersApi } from '../lib/api.js';
import {
  buildSessionsPayload,
  buildSlotsPayload,
  buildUpsertPayload,
  cloneAsTemplate,
  emptyMeeting,
  reorderItem,
  splitMeeting
} from '../lib/editorModel.js';
import { computedEndTime, isPreparedSpeechSlot, toHHMM, toMinutes } from '../lib/format.js';
import { PageError, PageLoading } from '../components/PageState.jsx';

const TABS = [
  ['info', 'Information'],
  ['roles', 'Roles'],
  ['sessions', 'Sessions'],
  ['speeches', 'Speeches'],
  ['topics', 'Table Topics']
];

function newKey(prefix) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() || Date.now()}`;
}

function roleKey(slot, index) {
  return slot._key || `slot-${slot.id ?? index}`;
}

function sessionKey(session, index) {
  return session._key || `session-${session.id ?? index}`;
}

export function EditorPage({ params }) {
  const routeId = params?.id ? Number(params.id) : null;
  const [, navigate] = useLocation();
  const query = new URLSearchParams(window.location.search);
  const [activeTab, setActiveTab] = useState(query.get('tab') || 'info');
  const [meeting, setMeeting] = useState(null);
  const [roles, setRoles] = useState([]);
  const [venues, setVenues] = useState([]);
  const [users, setUsers] = useState([]);
  const [attendees, setAttendees] = useState([]);
  const [speeches, setSpeeches] = useState([]);
  const [topics, setTopics] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [sources, setSources] = useState([]);
  const [isTemplate, setIsTemplate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [expandedRole, setExpandedRole] = useState(null);
  const [expandedSession, setExpandedSession] = useState(null);
  const [dragging, setDragging] = useState(null);
  const dragRef = useRef(null);

  function applyDetail(detail, nextAttendees = attendees) {
    const split = splitMeeting(detail, nextAttendees);
    setMeeting(split.meeting);
    setSpeeches(split.speeches);
    setTopics(split.tableTopics);
    const highlightedSlot = Number(query.get('slotId'));
    if (highlightedSlot) {
      const slot = split.meeting.role_slots.find((item) => item.id === highlightedSlot);
      if (slot) setExpandedRole(slot._key);
    }
  }

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [roleCatalog, venueCatalog, userCatalog, templateCatalog] = await Promise.all([
        catalogApi.roles(), catalogApi.venues(), usersApi.list(), meetingsApi.templates()
      ]);
      setRoles(roleCatalog.filter((role) => role.is_bookable !== false));
      setVenues(venueCatalog);
      setUsers(userCatalog);
      setTemplates(templateCatalog);

      if (routeId) {
        const [detail, checkedIn] = await Promise.all([meetingsApi.get(routeId), checkinApi.attendees(routeId)]);
        setAttendees(checkedIn);
        setIsTemplate(templateCatalog.some((template) => template.id === routeId));
        applyDetail(detail, checkedIn);
      } else {
        const all = await meetingsApi.list('all');
        const options = [
          { value: 'blank', label: 'Blank', detail: null },
          ...(all[0] ? [{ value: `meeting:${all[0].id}`, label: `Last meeting · #${all[0].number} ${all[0].title}`, detail: all[0] }] : []),
          ...templateCatalog.map((template) => ({ value: `meeting:${template.id}`, label: `Template · ${template.title}`, detail: template }))
        ];
        setSources(options);
        if (all[0]) {
          const source = await meetingsApi.get(all[0].id);
          setMeeting(cloneAsTemplate(source));
        } else {
          setMeeting(emptyMeeting(1));
        }
      }
    } catch (err) {
      setError(err.message || 'Could not load the meeting editor.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [routeId]);

  async function changeSource(value) {
    setSaving(true);
    setError('');
    try {
      if (value === 'blank') {
        const all = await meetingsApi.list('all');
        setMeeting(emptyMeeting((all[0]?.number || 0) + 1));
        setSpeeches([]);
        setTopics([]);
      } else {
        const id = Number(value.split(':')[1]);
        const source = await meetingsApi.get(id);
        setMeeting(cloneAsTemplate(source));
        setSpeeches([]);
        setTopics([]);
      }
    } catch (err) {
      setError(err.message || 'Could not load that starting point.');
    } finally {
      setSaving(false);
    }
  }

  function updateMeeting(field, value) {
    setMeeting((current) => ({ ...current, [field]: value }));
  }

  function updateSlot(index, patch) {
    setMeeting((current) => ({
      ...current,
      role_slots: current.role_slots.map((slot, slotIndex) => slotIndex === index ? { ...slot, ...patch } : slot)
    }));
  }

  function updateSession(index, patch) {
    setMeeting((current) => ({
      ...current,
      sessions: current.sessions.map((session, sessionIndex) => sessionIndex === index ? { ...session, ...patch } : session)
    }));
  }

  function updateSpeech(index, field, value) {
    setSpeeches((current) => current.map((speech, speechIndex) => speechIndex === index ? { ...speech, [field]: value } : speech));
  }

  function moveEditorItem(type, fromIndex, toIndex) {
    setMeeting((current) => {
      const key = type === 'role' ? 'role_slots' : 'sessions';
      return { ...current, [key]: reorderItem(current[key], fromIndex, toIndex) };
    });
  }

  function startDrag(type, index, event) {
    event.preventDefault();
    event.stopPropagation();
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch (_) {
      // Pointer capture is an enhancement; elementFromPoint reordering still works.
    }
    dragRef.current = { type, index, pointerId: event.pointerId };
    setDragging({ type, index });
    if (type === 'role') setExpandedRole(null);
    else setExpandedSession(null);
  }

  function moveDrag(type, event) {
    const drag = dragRef.current;
    if (!drag || drag.type !== type || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const edge = 84;
    if (event.clientY < edge) window.scrollBy({ top: -18, behavior: 'auto' });
    else if (event.clientY > window.innerHeight - edge) window.scrollBy({ top: 18, behavior: 'auto' });
    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest(`[data-drag-type="${type}"]`);
    const targetIndex = Number(target?.dataset.index);
    if (!Number.isInteger(targetIndex) || targetIndex === drag.index) return;
    moveEditorItem(type, drag.index, targetIndex);
    drag.index = targetIndex;
    setDragging({ type, index: targetIndex });
  }

  function endDrag(event) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(null);
  }

  function moveByButton(type, index, direction) {
    const list = type === 'role' ? meeting.role_slots : meeting.sessions;
    const target = Math.max(0, Math.min(list.length - 1, index + direction));
    moveEditorItem(type, index, target);
  }

  function addRole() {
    const key = newKey('slot');
    setMeeting((current) => ({
      ...current,
      role_slots: [...current.role_slots, { id: null, _key: key, role_id: null, role_name: '', label: '', custom_label: '', voting_group: '', is_optional: false, is_bookable: true, taker_id: null, taker_name: '' }]
    }));
    setExpandedRole(key);
  }

  function addSession() {
    const key = newKey('session');
    setMeeting((current) => ({
      ...current,
      sessions: [...current.sessions, { id: null, _key: key, position: current.sessions.length, group_label: '', name: 'New session', duration_minutes: 5, role_slot_id: null, _role_slot_key: null }]
    }));
    setExpandedSession(key);
  }

  function flash(message) {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 2200);
  }

  async function saveWhole() {
    const payload = buildUpsertPayload(meeting, isTemplate);
    if (!payload.title) throw new Error('Title is required.');
    if (!payload.date) throw new Error('Date is required.');
    const desiredSlots = meeting.role_slots;
    let saved = await meetingsApi.upsert(payload);
    if (!meeting.id && desiredSlots.some((slot) => slot.taker_id)) {
      const assigned = saved.role_slots.filter((slot) => slot.is_bookable !== false).map((slot, index) => ({
        ...slot,
        taker_id: desiredSlots[index]?.taker_id || null
      }));
      saved = await meetingsApi.putSlots(saved.id, buildSlotsPayload(assigned));
    }
    return saved;
  }

  async function runSave(job, message = 'Saved') {
    setSaving(true);
    setError('');
    try {
      const detail = await job();
      applyDetail(detail);
      flash(message);
      return detail;
    } catch (err) {
      setError(err.message || 'Save failed.');
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function createOrSaveInfo(event) {
    event?.preventDefault();
    const wasNew = !meeting.id;
    const detail = await runSave(saveWhole, wasNew ? 'Meeting created' : 'Information saved');
    if (detail && wasNew) navigate(`/app/meetings/${detail.id}/edit`, { replace: true });
  }

  async function saveRoles() {
    if (!meeting.id) return createOrSaveInfo();
    const payload = buildSlotsPayload(meeting.role_slots);
    if (payload.some((slot) => !slot.role_id && !slot.role_name)) {
      setError('Each role needs a name.');
      return;
    }
    await runSave(() => meetingsApi.putSlots(meeting.id, payload), 'Roles saved');
  }

  async function saveSessions() {
    if (!meeting.id) return createOrSaveInfo();
    const payload = buildSessionsPayload(meeting.sessions);
    if (payload.some((session) => !session.name)) {
      setError('Each session needs a name.');
      return;
    }
    await runSave(() => meetingsApi.putSessions(meeting.id, payload), 'Sessions saved');
  }

  async function saveSpeeches() {
    const jobs = speeches.filter((speech) => speech.taker_name && speech.title.trim());
    if (!jobs.length) {
      setError('Assign a speaker and enter a title first.');
      return;
    }
    await runSave(async () => {
      let detail = null;
      for (const speech of jobs) {
        detail = await meetingsApi.saveSpeech(meeting.id, speech.role_slot_id, {
          title: speech.title.trim(),
          pathway: speech.pathway.trim(),
          level: String(speech.level).trim() === '' ? null : Number(speech.level),
          purpose: speech.purpose.trim(),
          description: speech.description.trim()
        });
      }
      return detail;
    }, 'Speeches saved');
  }

  async function saveTopics() {
    const participants = topics.map((topic) => ({ role_slot_id: topic.role_slot_id || null, user_id: topic.user_id }));
    if (participants.some((participant) => !participant.user_id)) {
      setError('Select or create every participant.');
      return;
    }
    if (new Set(participants.map((participant) => participant.user_id)).size !== participants.length) {
      setError('A participant can only be added once.');
      return;
    }
    await runSave(() => meetingsApi.putTableTopics(meeting.id, participants), 'Table Topics saved');
  }

  async function togglePublish() {
    if (!meeting.id) {
      setError('Create the meeting before publishing it.');
      return;
    }
    const status = meeting.status === 'published' ? 'draft' : 'published';
    await runSave(() => meetingsApi.setStatus(meeting.id, status), status === 'published' ? 'Meeting published' : 'Meeting moved to draft');
  }

  async function createUserForSlot(index) {
    const displayName = window.prompt('Display name');
    if (!displayName?.trim()) return;
    setSaving(true);
    try {
      const user = await usersApi.create(displayName.trim());
      setUsers((current) => [...current, user]);
      updateSlot(index, { taker_id: user.id, taker_name: user.display_name });
    } catch (err) {
      setError(err.message || 'Could not create user.');
    } finally {
      setSaving(false);
    }
  }

  async function createWalkIn() {
    const displayName = window.prompt('Walk-in participant name');
    if (!displayName?.trim()) return;
    setSaving(true);
    try {
      const attendee = await checkinApi.createWalkIn(meeting.id, displayName.trim());
      setAttendees((current) => [...current, attendee]);
      setTopics((current) => [...current, { role_slot_id: null, user_id: attendee.id, name: attendee.display_name }]);
    } catch (err) {
      setError(err.message || 'Could not add the walk-in.');
    } finally {
      setSaving(false);
    }
  }

  const sessionStarts = useMemo(() => {
    let cursor = toMinutes(meeting?.start_time);
    return (meeting?.sessions || []).map((session, index, list) => {
      const start = toHHMM(cursor);
      cursor += Number(session.duration_minutes) || 0;
      if (index < list.length - 1) cursor += 1;
      return start;
    });
  }, [meeting?.start_time, meeting?.sessions]);

  if (loading) return <PageLoading label="Loading editor…" />;
  if (error && !meeting) return <PageError message={error} onRetry={load} />;
  if (!meeting) return null;

  return (
    <>
      <div class="editor-heading">
        <div>
          <h1>{meeting.id ? `Editing #${meeting.number}` : 'New meeting'}</h1>
          <p>{meeting.title}</p>
        </div>
        <div class="editor-heading-actions">
          <span class={`pill pill-${meeting.status}`}>{meeting.status}</span>
          {meeting.id && <Link class="btn btn-ghost btn-sm" href={`/app/meetings/${meeting.id}/agenda`}>Agenda</Link>}
          <button class="btn btn-secondary btn-sm" type="button" disabled={saving} onClick={togglePublish}>{meeting.status === 'published' ? 'Unpublish' : 'Publish'}</button>
        </div>
      </div>

      {!meeting.id && sources.length > 0 && (
        <section class="card start-card"><div class="field"><label for="start-from">Start from</label><select id="start-from" disabled={saving} onChange={(event) => changeSource(event.currentTarget.value)}>{sources.map((source, index) => <option value={source.value} selected={index === 1}>{source.label}</option>)}</select></div></section>
      )}

      <nav class="editor-tabs" aria-label="Meeting editor sections">
        {TABS.map(([id, label]) => <button class={activeTab === id ? 'active' : ''} type="button" onClick={() => setActiveTab(id)}>{label}</button>)}
      </nav>

      {notice && <div class="toast" role="status">{notice}</div>}
      {error && <p class="error-msg editor-error" role="alert">{error}</p>}

      {activeTab === 'info' && (
        <form class="card editor-panel" onSubmit={createOrSaveInfo}>
          <div class="form-grid">
            <div class="field span-2"><label for="meeting-title">Title</label><input id="meeting-title" value={meeting.title} onInput={(event) => updateMeeting('title', event.currentTarget.value)} required /></div>
            <div class="field"><label for="meeting-number">Number</label><input id="meeting-number" type="number" value={meeting.number} onInput={(event) => updateMeeting('number', event.currentTarget.value)} /></div>
            <div class="field"><label for="meeting-date">Date</label><input id="meeting-date" type="date" value={meeting.date} onInput={(event) => updateMeeting('date', event.currentTarget.value)} required /></div>
            <div class="field"><label for="meeting-theme">Theme</label><input id="meeting-theme" value={meeting.theme} onInput={(event) => updateMeeting('theme', event.currentTarget.value)} /></div>
            <div class="field"><label for="meeting-keyword">Keyword</label><input id="meeting-keyword" value={meeting.keyword} onInput={(event) => updateMeeting('keyword', event.currentTarget.value)} /></div>
            <div class="field"><label for="meeting-venue">Venue</label><input id="meeting-venue" list="venue-options" value={meeting.venue} onInput={(event) => updateMeeting('venue', event.currentTarget.value)} /><datalist id="venue-options">{venues.map((venue) => <option value={venue.name} />)}</datalist></div>
            <div class="field"><label for="meeting-start">Start</label><input id="meeting-start" type="time" value={meeting.start_time} onInput={(event) => updateMeeting('start_time', event.currentTarget.value)} /></div>
            <div class="field"><label>End (computed)</label><input value={computedEndTime(meeting.start_time, meeting.sessions)} readOnly /></div>
            <label class="check-field"><input type="checkbox" checked={isTemplate} onChange={(event) => setIsTemplate(event.currentTarget.checked)} /> Save as reusable template</label>
          </div>
          <button class="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : meeting.id ? 'Save information' : 'Create meeting'}</button>
        </form>
      )}

      {activeTab === 'roles' && (
        <section class="card editor-panel">
          <p class="editor-list-hint">{meeting.role_slots.length} role slots · drag ⋮⋮ to reorder · tap a row to edit</p>
          <div class="editor-list">
            {meeting.role_slots.map((slot, index) => {
              const key = roleKey(slot, index);
              const expanded = expandedRole === key;
              const isDragging = dragging?.type === 'role' && dragging.index === index;
              return (
                <article class={`editor-row expandable-editor-row ${expanded ? 'expanded' : ''} ${isDragging ? 'dragging' : ''}`} key={key} data-drag-type="role" data-index={index}>
                  <div class="editor-row-summary">
                    <button
                      class="drag-handle"
                      type="button"
                      aria-label={`Drag role ${index + 1}`}
                      onPointerDown={(event) => startDrag('role', index, event)}
                      onPointerMove={(event) => moveDrag('role', event)}
                      onPointerUp={endDrag}
                      onPointerCancel={endDrag}
                    >⋮⋮</button>
                    <button class="row-expand-button" type="button" aria-expanded={expanded} onClick={() => setExpandedRole(expanded ? null : key)}>
                      <span class="row-order">{index + 1}</span>
                      <span class="row-summary-copy">
                        <strong>{slot.custom_label || slot.label || slot.role_name || 'New role'}</strong>
                        <small>{slot.role_name && (slot.custom_label || slot.label) ? `${slot.role_name} · ` : ''}Assignee: {slot.taker_name || '—'}</small>
                      </span>
                      <span class="row-chevron" aria-hidden="true">{expanded ? '⌃' : '⌄'}</span>
                    </button>
                  </div>
                  {expanded && (
                    <div class="editor-row-body role-editor-body">
                      <div class="field"><label>Role</label><input list="role-options" value={slot.role_name} onInput={(event) => {
                        const name = event.currentTarget.value;
                        const role = roles.find((item) => item.name.toLowerCase() === name.toLowerCase());
                        updateSlot(index, role ? { role_id: role.id, role_name: role.name, voting_group: role.voting_group } : { role_id: null, role_name: name });
                      }} /></div>
                      <div class="field"><label>Custom label</label><input value={slot.custom_label || ''} placeholder={slot.label} onInput={(event) => updateSlot(index, { custom_label: event.currentTarget.value })} /></div>
                      <div class="field"><label>Voting group</label><input value={slot.voting_group || ''} onInput={(event) => updateSlot(index, { voting_group: event.currentTarget.value })} /></div>
                      <div class="field"><label>Assigned to</label><select value={slot.taker_id || ''} onChange={(event) => {
                        const user = users.find((item) => item.id === Number(event.currentTarget.value));
                        updateSlot(index, { taker_id: user?.id || null, taker_name: user?.display_name || '' });
                      }}><option value="">— unassigned —</option>{users.map((user) => <option value={user.id}>{user.display_name}</option>)}</select></div>
                      <label class="check-field compact"><input type="checkbox" checked={slot.is_optional} onChange={(event) => updateSlot(index, { is_optional: event.currentTarget.checked })} /> Optional</label>
                      <div class="row-tools"><button type="button" aria-label="Move role up" onClick={() => moveByButton('role', index, -1)}>↑</button><button type="button" aria-label="Move role down" onClick={() => moveByButton('role', index, 1)}>↓</button><button type="button" onClick={() => createUserForSlot(index)}>+User</button><button class="danger" type="button" aria-label="Delete role" onClick={() => { setMeeting((current) => ({ ...current, role_slots: current.role_slots.filter((_, slotIndex) => slotIndex !== index) })); setExpandedRole(null); }}>×</button></div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
          <datalist id="role-options">{roles.map((role) => <option value={role.name} />)}</datalist>
          <div class="panel-actions"><button class="btn btn-ghost" type="button" onClick={addRole}>+ Add role</button><button class="btn btn-primary" type="button" disabled={saving} onClick={saveRoles}>Save roles</button></div>
        </section>
      )}

      {activeTab === 'sessions' && (
        <section class="card editor-panel">
          <p class="editor-list-hint">Start times auto-computed · drag ⋮⋮ to reorder · tap a row to edit</p>
          <div class="editor-list">
            {meeting.sessions.map((session, index) => {
              const key = sessionKey(session, index);
              const expanded = expandedSession === key;
              const isDragging = dragging?.type === 'session' && dragging.index === index;
              const role = meeting.role_slots.find((slot) => slot._key === session._role_slot_key || slot.id === session.role_slot_id);
              return (
                <article class={`editor-row expandable-editor-row ${expanded ? 'expanded' : ''} ${isDragging ? 'dragging' : ''}`} key={key} data-drag-type="session" data-index={index}>
                  <div class="editor-row-summary">
                    <button
                      class="drag-handle"
                      type="button"
                      aria-label={`Drag session ${index + 1}`}
                      onPointerDown={(event) => startDrag('session', index, event)}
                      onPointerMove={(event) => moveDrag('session', event)}
                      onPointerUp={endDrag}
                      onPointerCancel={endDrag}
                    >⋮⋮</button>
                    <button class="row-expand-button" type="button" aria-expanded={expanded} onClick={() => setExpandedSession(expanded ? null : key)}>
                      <span class="session-start">{sessionStarts[index]}</span>
                      <span class="row-summary-copy">
                        <strong>{session.name || 'New session'}</strong>
                        <small>{session.duration_minutes}' · {role?.custom_label || role?.label || role?.role_name || 'No role'}</small>
                      </span>
                      <span class="row-chevron" aria-hidden="true">{expanded ? '⌃' : '⌄'}</span>
                    </button>
                  </div>
                  {expanded && (
                    <div class="editor-row-body session-editor-body">
                      <div class="field"><label>Group</label><input value={session.group_label || ''} onInput={(event) => updateSession(index, { group_label: event.currentTarget.value })} /></div>
                      <div class="field session-name"><label>Session</label><input value={session.name} onInput={(event) => updateSession(index, { name: event.currentTarget.value })} /></div>
                      <div class="field duration-field"><label>Minutes</label><input type="number" min="0" value={session.duration_minutes} onInput={(event) => updateSession(index, { duration_minutes: Number(event.currentTarget.value) })} /></div>
                      <div class="field"><label>Role slot</label><select value={session._role_slot_key || ''} onChange={(event) => {
                        const slotKey = event.currentTarget.value || null;
                        const selectedSlot = meeting.role_slots.find((item) => item._key === slotKey);
                        updateSession(index, { _role_slot_key: slotKey, role_slot_id: selectedSlot?.id || null });
                      }}><option value="">— none —</option>{meeting.role_slots.map((slot) => <option value={slot._key}>{slot.custom_label || slot.label || slot.role_name}</option>)}</select></div>
                      <div class="row-tools"><button type="button" aria-label="Move session up" onClick={() => moveByButton('session', index, -1)}>↑</button><button type="button" aria-label="Move session down" onClick={() => moveByButton('session', index, 1)}>↓</button><button class="danger" type="button" aria-label="Delete session" onClick={() => { setMeeting((current) => ({ ...current, sessions: current.sessions.filter((_, sessionIndex) => sessionIndex !== index) })); setExpandedSession(null); }}>×</button></div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
          <div class="panel-actions"><button class="btn btn-ghost" type="button" onClick={addSession}>+ Add session</button><button class="btn btn-primary" type="button" disabled={saving} onClick={saveSessions}>Save sessions</button></div>
        </section>
      )}

      {activeTab === 'speeches' && (
        <section class="card editor-panel">
          {speeches.length === 0 && <p>No prepared-speaker roles are configured.</p>}
          {speeches.map((speech, index) => (
            <article class="speech-editor" key={speech.role_slot_id}>
              <div><h2>{speech.label}</h2><p>{speech.taker_name || 'Assign a speaker in Roles first.'}</p></div>
              {speech.taker_name && <div class="form-grid"><div class="field"><label>Title</label><input value={speech.title} onInput={(event) => updateSpeech(index, 'title', event.currentTarget.value)} /></div><div class="field"><label>Pathway</label><input value={speech.pathway} onInput={(event) => updateSpeech(index, 'pathway', event.currentTarget.value)} /></div><div class="field"><label>Level</label><input type="number" min="1" value={speech.level} onInput={(event) => updateSpeech(index, 'level', event.currentTarget.value)} /></div><div class="field span-2"><label>Purpose</label><textarea maxlength="240" value={speech.purpose} onInput={(event) => updateSpeech(index, 'purpose', event.currentTarget.value)} /></div><div class="field span-2"><label>Description</label><textarea maxlength="240" value={speech.description} onInput={(event) => updateSpeech(index, 'description', event.currentTarget.value)} /></div></div>}
            </article>
          ))}
          {speeches.length > 0 && <div class="panel-actions end"><button class="btn btn-primary" type="button" disabled={saving || !meeting.id} onClick={saveSpeeches}>Save speeches</button></div>}
        </section>
      )}

      {activeTab === 'topics' && (
        <section class="card editor-panel">
          <p class="panel-intro">Table Topics candidates must be checked in. Add a walk-in when someone is not in the attendee list.</p>
          {topics.map((topic, index) => (
            <div class="topic-row" key={topic.role_slot_id || index}><span>{index + 1}</span><select value={topic.user_id || ''} onChange={(event) => {
              const user = attendees.find((item) => item.id === Number(event.currentTarget.value));
              setTopics((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, user_id: user?.id || null, name: user?.display_name || '' } : item));
            }}><option value="">Select attendee</option>{attendees.map((user) => <option value={user.id}>{user.display_name}</option>)}</select><button class="row-delete" type="button" onClick={() => setTopics((current) => current.filter((_, itemIndex) => itemIndex !== index))}>×</button></div>
          ))}
          <div class="panel-actions"><div><button class="btn btn-ghost" type="button" disabled={!meeting.id} onClick={() => setTopics((current) => [...current, { role_slot_id: null, user_id: null, name: '' }])}>+ Participant</button><button class="btn btn-ghost" type="button" disabled={!meeting.id} onClick={createWalkIn}>+ Walk-in</button></div><button class="btn btn-primary" type="button" disabled={saving || !meeting.id} onClick={saveTopics}>Save Table Topics</button></div>
        </section>
      )}
    </>
  );
}
