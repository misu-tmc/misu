import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useLocation } from 'wouter-preact';
import { catalogApi, checkinApi, meetingsApi, usersApi } from '../lib/api.js';
import {
  assignCatalogRole,
  assignRoleUser,
  assignTopicUser,
  buildSessionsPayload,
  buildSlotsPayload,
  buildUpsertPayload,
  cloneAsTemplate,
  emptyMeeting,
  reorderItem,
  splitMeeting
} from '../lib/editorModel.js';
import { isPreparedSpeechSlot, shortDate, toHHMM, toMinutes } from '../lib/format.js';
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
  const [swipedRow, setSwipedRow] = useState(null);
  const [tabEdges, setTabEdges] = useState({ left: false, right: true });
  const [newUserTarget, setNewUserTarget] = useState(null);
  const [newUserName, setNewUserName] = useState('');
  const [newRoleSlotIndex, setNewRoleSlotIndex] = useState(null);
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleVotingGroup, setNewRoleVotingGroup] = useState('');
  const [addingVenue, setAddingVenue] = useState(false);
  const [newVenueName, setNewVenueName] = useState('');
  const dragRef = useRef(null);
  const swipeRef = useRef(null);
  const suppressRowClickRef = useRef(false);
  const tabsRef = useRef(null);
  const newUserInputRef = useRef(null);
  const newRoleInputRef = useRef(null);
  const newVenueInputRef = useRef(null);

  useEffect(() => {
    document.body.classList.add('editor-detail-layout');
    return () => document.body.classList.remove('editor-detail-layout');
  }, []);

  function updateTabEdges() {
    const tabs = tabsRef.current;
    if (!tabs) return;
    setTabEdges({
      left: tabs.scrollLeft > 4,
      right: tabs.scrollLeft < tabs.scrollWidth - tabs.clientWidth - 4
    });
  }

  useEffect(() => {
    const frame = window.requestAnimationFrame(updateTabEdges);
    window.addEventListener('resize', updateTabEdges);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', updateTabEdges);
    };
  }, [meeting]);

  useEffect(() => {
    if (!newUserTarget) return undefined;
    const frame = window.requestAnimationFrame(() => newUserInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [newUserTarget]);

  useEffect(() => {
    if (newRoleSlotIndex === null) return undefined;
    const frame = window.requestAnimationFrame(() => newRoleInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [newRoleSlotIndex]);

  useEffect(() => {
    if (!addingVenue) return undefined;
    const frame = window.requestAnimationFrame(() => newVenueInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [addingVenue]);

  function switchTab(id) {
    setActiveTab(id);
    setSwipedRow(null);
    window.requestAnimationFrame(updateTabEdges);
  }

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

  function startSwipe(type, index, event) {
    if (event.pointerType === 'mouse') return;
    swipeRef.current = {
      type,
      index,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY
    };
  }

  function endSwipe(type, index, event) {
    const swipe = swipeRef.current;
    swipeRef.current = null;
    if (!swipe || swipe.type !== type || swipe.index !== index || swipe.pointerId !== event.pointerId) return;
    const dx = event.clientX - swipe.x;
    const dy = event.clientY - swipe.y;
    if (dx < -30 && Math.abs(dx) > Math.abs(dy)) {
      suppressRowClickRef.current = true;
      setSwipedRow({ type, index });
      window.setTimeout(() => { suppressRowClickRef.current = false; }, 0);
    } else if (dx > 20) {
      setSwipedRow(null);
    }
  }

  function toggleEditorRow(type, key) {
    if (suppressRowClickRef.current) return;
    if (swipedRow?.type === type) {
      setSwipedRow(null);
      return;
    }
    if (type === 'role') setExpandedRole(expandedRole === key ? null : key);
    else setExpandedSession(expandedSession === key ? null : key);
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
    const saveInfo = wasNew
      ? saveWhole
      : () => meetingsApi.updateInfo(meeting.id, {
        title: meeting.title,
        theme: meeting.theme,
        keyword: meeting.keyword,
        date: meeting.date,
        start_time: meeting.start_time,
        end_time: meeting.end_time,
        venue: meeting.venue
      });
    const detail = await runSave(saveInfo, wasNew ? 'Meeting created' : 'Information saved');
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

  function openUserDialog(type, index) {
    setNewUserName('');
    setNewUserTarget({ type, index });
  }

  function closeUserDialog() {
    if (saving) return;
    setNewUserTarget(null);
    setNewUserName('');
  }

  async function createUser(event) {
    event?.preventDefault();
    const displayName = newUserName.trim();
    const target = newUserTarget;
    if (!displayName || !target) return;
    setSaving(true);
    try {
      if (target.type === 'role') {
        const user = await usersApi.create(displayName);
        setUsers((current) => [...current, user]);
        setMeeting((current) => ({ ...current, role_slots: assignRoleUser(current.role_slots, target.index, user) }));
      } else {
        const attendee = await checkinApi.createWalkIn(meeting.id, displayName);
        setAttendees((current) => [...current, attendee]);
        setTopics((current) => assignTopicUser(current, target.index, attendee));
      }
      setNewUserTarget(null);
      setNewUserName('');
    } catch (err) {
      setError(err.message || 'Could not create the user.');
    } finally {
      setSaving(false);
    }
  }

  function openRoleDialog(slotIndex) {
    setNewRoleName('');
    setNewRoleVotingGroup('');
    setNewRoleSlotIndex(slotIndex);
  }

  function closeRoleDialog() {
    if (saving) return;
    setNewRoleSlotIndex(null);
    setNewRoleName('');
    setNewRoleVotingGroup('');
  }

  async function createRole(event) {
    event?.preventDefault();
    const roleName = newRoleName.trim();
    const slotIndex = newRoleSlotIndex;
    if (!roleName || slotIndex === null) return;
    setSaving(true);
    try {
      const role = await catalogApi.createRole(roleName, newRoleVotingGroup.trim());
      setRoles((current) => current.some((item) => item.id === role.id) ? current : [...current, role]);
      setMeeting((current) => ({ ...current, role_slots: assignCatalogRole(current.role_slots, slotIndex, role) }));
      setNewRoleSlotIndex(null);
      setNewRoleName('');
      setNewRoleVotingGroup('');
    } catch (err) {
      setError(err.message || 'Could not create the role.');
    } finally {
      setSaving(false);
    }
  }

  function openVenueDialog() {
    setNewVenueName('');
    setAddingVenue(true);
  }

  function closeVenueDialog() {
    if (saving) return;
    setAddingVenue(false);
    setNewVenueName('');
  }

  async function createVenue(event) {
    event?.preventDefault();
    const venueName = newVenueName.trim();
    if (!venueName) return;
    setSaving(true);
    try {
      const venue = await catalogApi.createVenue(venueName);
      setVenues((current) => current.some((item) => item.id === venue.id) ? current : [...current, venue]);
      updateMeeting('venue', venue.name);
      setAddingVenue(false);
      setNewVenueName('');
    } catch (err) {
      setError(err.message || 'Could not create the venue.');
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

  const sectionLabel = TABS.find(([id]) => id === activeTab)?.[1] || 'Meeting';
  const saveCurrentSection = {
    info: createOrSaveInfo,
    roles: saveRoles,
    sessions: saveSessions,
    speeches: saveSpeeches,
    topics: saveTopics
  }[activeTab];
  const saveUnavailable = (activeTab === 'speeches' || activeTab === 'topics') && !meeting?.id;

  if (loading) return <PageLoading label="Loading editor…" />;
  if (error && !meeting) return <PageError message={error} onRetry={load} />;
  if (!meeting) return null;

  return (
    <div class="editor-page">
      <header class="editor-heading">
        <div class="editor-heading-main">
          <h1>#{meeting.number} {meeting.title}</h1>
          <p>{meeting.theme || 'No theme'} · {shortDate(meeting.date).replace(',', '')} {meeting.start_time}{meeting.end_time ? `–${meeting.end_time}` : ''}</p>
        </div>
        <div class="editor-heading-actions">
          {meeting.id && <a class="btn btn-ghost btn-sm" href={`/app/meetings/${meeting.id}/agenda`} target="_blank" rel="noreferrer">Printed agenda</a>}
          <span class={`editor-status editor-status-${meeting.status}`}>{meeting.status}</span>
          <button class={`btn editor-publish-button ${meeting.status === 'published' ? 'published' : ''}`} type="button" disabled={saving} onClick={togglePublish}>{meeting.status === 'published' ? 'Unpublish' : 'Publish'}</button>
        </div>
      </header>

      {!meeting.id && sources.length > 0 && (
        <section class="card start-card"><div class="field"><label for="start-from">Start from</label><select id="start-from" disabled={saving} onChange={(event) => changeSource(event.currentTarget.value)}>{sources.map((source, index) => <option value={source.value} selected={index === 1}>{source.label}</option>)}</select></div></section>
      )}

      <div class="editor-tabwrap">
        {tabEdges.left && <span class="editor-tab-edge left" aria-hidden="true">‹</span>}
        <nav class="editor-tabs" aria-label="Meeting editor sections" ref={tabsRef} onScroll={updateTabEdges}>
          {TABS.map(([id, label]) => <button class={activeTab === id ? 'active' : ''} type="button" onClick={() => switchTab(id)} key={id}>{label}</button>)}
        </nav>
        {tabEdges.right && <span class="editor-tab-edge right" aria-hidden="true">›</span>}
      </div>

      {notice && <div class="toast" role="status">{notice}</div>}
      <div class="editor-body">
        {error && <p class="error-msg editor-error" role="alert">{error}</p>}

        {activeTab === 'info' && (
          <form class="card editor-panel editor-info-panel" id="meeting-info-form" onSubmit={createOrSaveInfo}>
            <div class="field"><label for="meeting-title">Title</label><input id="meeting-title" value={meeting.title} onInput={(event) => updateMeeting('title', event.currentTarget.value)} required /></div>
            <div class="field"><label for="meeting-theme">Theme</label><input id="meeting-theme" value={meeting.theme} onInput={(event) => updateMeeting('theme', event.currentTarget.value)} /></div>
            <div class="field"><label for="meeting-keyword">Keyword</label><input id="meeting-keyword" value={meeting.keyword} onInput={(event) => updateMeeting('keyword', event.currentTarget.value)} /></div>
            <div class="field"><label for="meeting-date">Date</label><div class="editor-picker-control"><span>{meeting.date || 'Pick date'}</span><input id="meeting-date" type="date" value={meeting.date} aria-label="Date" onInput={(event) => updateMeeting('date', event.currentTarget.value)} required /></div></div>
            <div class="editor-time-row">
              <div class="field"><label for="meeting-start">Start</label><div class="editor-picker-control"><span>{meeting.start_time || '--:--'}</span><input id="meeting-start" type="time" value={meeting.start_time} aria-label="Start" onInput={(event) => updateMeeting('start_time', event.currentTarget.value)} /></div></div>
              <div class="field"><label for="meeting-end">End</label><div class="editor-picker-control"><span>{meeting.end_time || '--:--'}</span><input id="meeting-end" type="time" value={meeting.end_time} aria-label="End" onInput={(event) => updateMeeting('end_time', event.currentTarget.value)} /></div></div>
            </div>
            <div class="field"><label for="meeting-venue-preset">Venue</label><div class="editor-user-picker"><div class="editor-picker-control"><span>{meeting.venue || 'Pick saved venue'}</span><select id="meeting-venue-preset" value={meeting.venue || ''} aria-label="Saved venue" onChange={(event) => updateMeeting('venue', event.currentTarget.value)}><option value="">Pick saved venue</option>{meeting.venue && !venues.some((venue) => venue.name === meeting.venue) && <option value={meeting.venue}>{meeting.venue}</option>}{venues.map((venue) => <option value={venue.name}>{venue.name}</option>)}</select></div><button class="editor-add-user" type="button" onClick={openVenueDialog}>+Add venue</button></div></div>
            {!meeting.id && <label class="check-field editor-template-field"><input type="checkbox" checked={isTemplate} onChange={(event) => setIsTemplate(event.currentTarget.checked)} /> Save as reusable template</label>}
          </form>
        )}

        {activeTab === 'roles' && (
          <section class="editor-panel editor-list-panel">
            <p class="editor-list-hint">{meeting.role_slots.length} role slots · drag ⋮⋮ to reorder · swipe a row for Delete</p>
            <div class="editor-list">
              {meeting.role_slots.map((slot, index) => {
                const key = roleKey(slot, index);
                const expanded = expandedRole === key;
                const isDragging = dragging?.type === 'role' && dragging.index === index;
                const isSwiped = swipedRow?.type === 'role' && swipedRow.index === index;
                return (
                  <article class={`editor-row ${expanded ? 'expanded' : ''} ${isDragging ? 'dragging' : ''} ${isSwiped ? 'swiped' : ''}`} key={key} data-drag-type="role" data-index={index}>
                    <button class="drag-handle" type="button" aria-label={`Drag role ${index + 1}`} onPointerDown={(event) => startDrag('role', index, event)} onPointerMove={(event) => moveDrag('role', event)} onPointerUp={endDrag} onPointerCancel={endDrag}>⋮⋮</button>
                    <div class="editor-row-main" onPointerDown={(event) => startSwipe('role', index, event)} onPointerUp={(event) => endSwipe('role', index, event)} onPointerCancel={() => { swipeRef.current = null; }}>
                      <button class="row-expand-button" type="button" aria-expanded={expanded} onClick={() => toggleEditorRow('role', key)}>
                        <span class="row-summary-copy"><strong>{slot.role_name || slot.custom_label || slot.label || 'New role'}</strong><small>Assignee: {slot.taker_name || '—'}</small></span>
                      </button>
                      {expanded && (
                        <div class="editor-row-body role-editor-body">
                          <div class="field"><label>Role</label><div class="editor-user-picker"><input list="role-options" value={slot.role_name} onInput={(event) => { const name = event.currentTarget.value; const role = roles.find((item) => item.name.toLowerCase() === name.toLowerCase()); updateSlot(index, role ? { role_id: role.id, role_name: role.name, voting_group: role.voting_group } : { role_id: null, role_name: name }); }} /><button class="editor-add-user" type="button" onClick={() => openRoleDialog(index)}>+Add role</button></div></div>
                          <div class="field"><label>Assignee</label><div class="editor-user-picker"><select value={slot.taker_id || ''} onChange={(event) => { const user = users.find((item) => item.id === Number(event.currentTarget.value)); updateSlot(index, { taker_id: user?.id || null, taker_name: user?.display_name || '' }); }}><option value="">— unassigned —</option>{users.map((user) => <option value={user.id}>{user.display_name}</option>)}</select><button class="editor-add-user" type="button" onClick={() => openUserDialog('role', index)}>+Add user</button></div></div>
                          <label class="check-field compact"><input type="checkbox" checked={slot.is_optional} onChange={(event) => updateSlot(index, { is_optional: event.currentTarget.checked })} /> Optional</label>
                        </div>
                      )}
                    </div>
                    <button class="editor-row-delete" type="button" onClick={() => { setMeeting((current) => ({ ...current, role_slots: current.role_slots.filter((_, slotIndex) => slotIndex !== index) })); setExpandedRole(null); setSwipedRow(null); }}>Delete</button>
                  </article>
                );
              })}
            </div>
            <datalist id="role-options">{roles.map((role) => <option value={role.name} />)}</datalist>
            <button class="btn btn-ghost editor-add-button" type="button" onClick={addRole}>+ Add role</button>
          </section>
        )}

        {activeTab === 'sessions' && (
          <section class="editor-panel editor-list-panel">
            <p class="editor-list-hint">Start times auto-computed · drag ⋮⋮ to reorder · swipe a row for Delete</p>
            <div class="editor-list">
              {meeting.sessions.map((session, index) => {
                const key = sessionKey(session, index);
                const expanded = expandedSession === key;
                const isDragging = dragging?.type === 'session' && dragging.index === index;
                const isSwiped = swipedRow?.type === 'session' && swipedRow.index === index;
                const role = meeting.role_slots.find((slot) => slot._key === session._role_slot_key || slot.id === session.role_slot_id);
                return (
                  <article class={`editor-row ${expanded ? 'expanded' : ''} ${isDragging ? 'dragging' : ''} ${isSwiped ? 'swiped' : ''}`} key={key} data-drag-type="session" data-index={index}>
                    <button class="drag-handle" type="button" aria-label={`Drag session ${index + 1}`} onPointerDown={(event) => startDrag('session', index, event)} onPointerMove={(event) => moveDrag('session', event)} onPointerUp={endDrag} onPointerCancel={endDrag}>⋮⋮</button>
                    <div class="editor-row-main" onPointerDown={(event) => startSwipe('session', index, event)} onPointerUp={(event) => endSwipe('session', index, event)} onPointerCancel={() => { swipeRef.current = null; }}>
                      <button class="row-expand-button" type="button" aria-expanded={expanded} onClick={() => toggleEditorRow('session', key)}>
                        <span class="row-summary-copy"><strong><span class="session-start">{sessionStarts[index]}</span> {session.name || 'New session'}</strong><small>{session.duration_minutes}' · {role?.custom_label || role?.label || role?.role_name || '—'}</small></span>
                      </button>
                      {expanded && (
                        <div class="editor-row-body session-editor-body">
                          <div class="field"><label>Session name</label><input value={session.name} onInput={(event) => updateSession(index, { name: event.currentTarget.value })} /></div>
                          <div class="field"><label>Group</label><input value={session.group_label || ''} onInput={(event) => updateSession(index, { group_label: event.currentTarget.value })} /></div>
                          <div class="field"><label>Duration (min)</label><input type="number" min="0" value={session.duration_minutes} onInput={(event) => updateSession(index, { duration_minutes: Number(event.currentTarget.value) })} /></div>
                          <div class="field"><label>Role</label><select value={session._role_slot_key || ''} onChange={(event) => { const slotKey = event.currentTarget.value || null; const selectedSlot = meeting.role_slots.find((item) => item._key === slotKey); updateSession(index, { _role_slot_key: slotKey, role_slot_id: selectedSlot?.id || null }); }}><option value="">— None —</option>{meeting.role_slots.map((slot) => <option value={slot._key}>{slot.custom_label || slot.label || slot.role_name}</option>)}</select></div>
                        </div>
                      )}
                    </div>
                    <button class="editor-row-delete" type="button" onClick={() => { setMeeting((current) => ({ ...current, sessions: current.sessions.filter((_, sessionIndex) => sessionIndex !== index) })); setExpandedSession(null); setSwipedRow(null); }}>Delete</button>
                  </article>
                );
              })}
            </div>
            <button class="btn btn-ghost editor-add-button" type="button" onClick={addSession}>+ Add session</button>
          </section>
        )}

        {activeTab === 'speeches' && (
          <section class="editor-panel">
            {speeches.length === 0 && <div class="card editor-empty-tab"><strong>Prepared Speeches</strong><p>No prepared speech slots yet. Add Speaker or Prepared Speech roles first.</p></div>}
            {speeches.map((speech, index) => (
              <article class="card editor-speech-card" key={speech.role_slot_id}>
                <div class="editor-speech-head"><strong>{speech.label}</strong><span>{speech.taker_name || 'Unassigned'}</span></div>
                <div class="field"><label>Title</label><input value={speech.title} onInput={(event) => updateSpeech(index, 'title', event.currentTarget.value)} /></div>
                <div class="field"><label>Pathway</label><input value={speech.pathway} onInput={(event) => updateSpeech(index, 'pathway', event.currentTarget.value)} /></div>
                <div class="field"><label>Level</label><input type="number" min="1" value={speech.level} onInput={(event) => updateSpeech(index, 'level', event.currentTarget.value)} /></div>
                <div class="field"><label>Purpose</label><textarea maxlength="240" value={speech.purpose} onInput={(event) => updateSpeech(index, 'purpose', event.currentTarget.value)} /></div>
                <div class="field"><label>Description</label><textarea maxlength="240" value={speech.description} onInput={(event) => updateSpeech(index, 'description', event.currentTarget.value)} /></div>
              </article>
            ))}
          </section>
        )}

        {activeTab === 'topics' && (
          <section class="editor-panel">
            <p class="editor-list-hint">{topics.length} participant{topics.length === 1 ? '' : 's'} · checked-in users only</p>
            <div class="card editor-topics-card">
              {topics.map((topic, index) => (
                <div class="topic-row" key={topic.role_slot_id || index}><span>{index + 1}.</span><select value={topic.user_id || ''} onChange={(event) => { const user = attendees.find((item) => item.id === Number(event.currentTarget.value)); setTopics((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, user_id: user?.id || null, name: user?.display_name || '' } : item)); }}><option value="">Select checked-in participant</option>{attendees.map((user) => <option value={user.id}>{user.display_name}</option>)}</select><button class="editor-add-user" type="button" onClick={() => openUserDialog('topic', index)}>+Add user</button><button class="row-delete" type="button" aria-label={`Delete participant ${index + 1}`} onClick={() => setTopics((current) => current.filter((_, itemIndex) => itemIndex !== index))}>×</button></div>
              ))}
              {topics.length === 0 && <p>No participants yet.</p>}
            </div>
            <button class="btn btn-ghost editor-add-button" type="button" disabled={!meeting.id} onClick={() => setTopics((current) => [...current, { role_slot_id: null, user_id: null, name: '' }])}>+ Add participant</button>
          </section>
        )}
      </div>

      <footer class="editor-savebar">
        <span>Saving {sectionLabel}</span>
        <button class="btn btn-primary" type="button" disabled={saving || saveUnavailable} onClick={saveCurrentSection}>{saving ? 'Saving…' : 'Save'}</button>
      </footer>

      {newUserTarget && (
        <div class="editor-modal-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) closeUserDialog(); }}>
          <section class="card editor-modal" role="dialog" aria-modal="true" aria-labelledby="add-user-title" onKeyDown={(event) => { if (event.key === 'Escape') closeUserDialog(); }}>
            <h2 id="add-user-title">Add user</h2>
            <p>{newUserTarget.type === 'role' ? 'Create a user and assign them to this role.' : 'Create a user and check them into this meeting.'}</p>
            <form onSubmit={createUser}>
              <div class="field"><label for="new-user-name">Display name</label><input id="new-user-name" ref={newUserInputRef} value={newUserName} onInput={(event) => setNewUserName(event.currentTarget.value)} autocomplete="name" autofocus required /></div>
              <div class="editor-modal-actions"><button class="btn btn-ghost" type="button" disabled={saving} onClick={closeUserDialog}>Cancel</button><button class="btn btn-primary" type="submit" disabled={saving || !newUserName.trim()}>{saving ? 'Creating…' : 'Create user'}</button></div>
            </form>
          </section>
        </div>
      )}

      {newRoleSlotIndex !== null && (
        <div class="editor-modal-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) closeRoleDialog(); }}>
          <section class="card editor-modal" role="dialog" aria-modal="true" aria-labelledby="add-role-title" onKeyDown={(event) => { if (event.key === 'Escape') closeRoleDialog(); }}>
            <h2 id="add-role-title">Add role</h2>
            <p>Create a role and select it for this slot.</p>
            <form onSubmit={createRole}>
              <div class="field"><label for="new-role-name">Role name</label><input id="new-role-name" ref={newRoleInputRef} value={newRoleName} onInput={(event) => setNewRoleName(event.currentTarget.value)} autofocus required /></div>
              <div class="field"><label for="new-role-voting-group">Voting group (optional)</label><input id="new-role-voting-group" value={newRoleVotingGroup} onInput={(event) => setNewRoleVotingGroup(event.currentTarget.value)} placeholder="Use automatic default" /></div>
              <div class="editor-modal-actions"><button class="btn btn-ghost" type="button" disabled={saving} onClick={closeRoleDialog}>Cancel</button><button class="btn btn-primary" type="submit" disabled={saving || !newRoleName.trim()}>{saving ? 'Creating…' : 'Create role'}</button></div>
            </form>
          </section>
        </div>
      )}

      {addingVenue && (
        <div class="editor-modal-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) closeVenueDialog(); }}>
          <section class="card editor-modal" role="dialog" aria-modal="true" aria-labelledby="add-venue-title" onKeyDown={(event) => { if (event.key === 'Escape') closeVenueDialog(); }}>
            <h2 id="add-venue-title">Add venue</h2>
            <p>Create a venue and select it for this meeting.</p>
            <form onSubmit={createVenue}>
              <div class="field"><label for="new-venue-name">Venue name</label><input id="new-venue-name" ref={newVenueInputRef} value={newVenueName} onInput={(event) => setNewVenueName(event.currentTarget.value)} autofocus required /></div>
              <div class="editor-modal-actions"><button class="btn btn-ghost" type="button" disabled={saving} onClick={closeVenueDialog}>Cancel</button><button class="btn btn-primary" type="submit" disabled={saving || !newVenueName.trim()}>{saving ? 'Creating…' : 'Create venue'}</button></div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
