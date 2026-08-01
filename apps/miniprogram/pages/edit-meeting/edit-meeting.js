// pages/edit-meeting/edit-meeting.js
// Tabbed meeting editor. A scrollable tab strip switches sections (Info / Roles / Sessions
// / Speeches); each section saves independently as a batch to its own backend endpoint; a
// Publish toggle flips the meeting status. Roles and Sessions share one draggable row;
// left-swipe reveals Delete (content fades). See
// design/functionalities/meeting_info.md.
const api = require('../../utils/api.js');
const { shortDate } = require('../../utils/format.js');

const BUFFER_MINUTES = 1;
const NONE_LABEL = '— None —';
const ATTENDEE_PLACEHOLDER = 'Select checked-in participant';
const CREATE_WALK_IN_LABEL = '+ Create one';

function attendeePickerOptions(users) {
  return [ATTENDEE_PLACEHOLDER]
    .concat((users || []).map((u) => u.display_name))
    .concat([CREATE_WALK_IN_LABEL]);
}

function isPreparedSpeechRole(roleName) {
  const role = (roleName || '').toLowerCase();
  return role.indexOf('speaker') >= 0 || role.indexOf('prepared speech') >= 0;
}

function toMinutes(hhmm) {
  const [h, m] = (hhmm || '0:0').split(':').map((n) => parseInt(n, 10));
  return (h || 0) * 60 + (m || 0);
}

function toHHMM(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

Page({
  data: {
    loading: true,
    saving: false,
    meetingId: null,
    header: null,
    activeTab: 'info',
    tabs: [
      { id: 'info', label: 'Information' },
      { id: 'roles', label: 'Roles' },
      { id: 'sessions', label: 'Sessions' },
      { id: 'speeches', label: 'Speeches' },
      { id: 'topics', label: 'Table Topics' }
    ],
    edgeLeft: false,
    edgeRight: true,
    highlightField: '',
    highlightSlotId: null,
    drag: { type: '', index: -1, offset: 0 },
    info: { title: '', theme: '', keyword: '', date: '', start_time: '', end_time: '', venue: '' },
    slots: [],
    sessions: [],
    speeches: [],
    tableTopics: [],
    roleCatalog: [],
    roleNames: [],
    venueCatalog: [],
    venueNames: [],
    userCatalog: [],
    userNames: [NONE_LABEL],
    attendeeCatalog: [],
    attendeeNames: attendeePickerOptions([]),
    slotPickerLabels: [NONE_LABEL],
    // Which row currently has its swipe actions revealed: { type:'role'|'session', index }.
    swipe: { type: '', index: -1 }
  },

  onLoad(query) {
    query = query || {};
    this.meetingId = query.id ? parseInt(query.id, 10) : null;
    const valid = ['info', 'roles', 'sessions', 'speeches', 'topics'];
    const patch = {};
    if (query.tab && valid.indexOf(query.tab) >= 0) patch.activeTab = query.tab;
    if (query.field) patch.highlightField = query.field;
    if (query.slotId) patch.highlightSlotId = parseInt(query.slotId, 10) || null;
    if (Object.keys(patch).length) this.setData(patch);
    this.load();
  },

  onReady() {
    // Measure the tab strip width so scroll can decide when to show the ‹ / › chevrons.
    wx.createSelectorQuery()
      .select('.tabs')
      .boundingClientRect((r) => {
        if (r) this._tabsView = r.width;
      })
      .exec();
  },

  async load() {
    const app = getApp();
    if (app.globalData.ready) {
      await app.globalData.ready;
    }
    if (!app.globalData.token) {
      this.setData({ loading: false });
      return;
    }
    try {
      let meetingId = this.meetingId;
      if (!meetingId) {
        const list = await api.upcomingMeetings();
        if (!list.length) {
          this.setData({ loading: false });
          return;
        }
        meetingId = list[0].id;
      }
      const [detail, roles, venues, users, attendees] = await Promise.all([
        api.meeting(meetingId),
        api.roles().catch(() => []),
        api.venues().catch(() => []),
        api.users().catch(() => []),
        api.attendees(meetingId)
      ]);
      this.meetingId = meetingId;
      this.applyMeeting(detail, roles, venues, users, attendees);
    } catch (e) {
      console.error(e);
      wx.showToast({ title: 'Load failed', icon: 'none' });
      this.setData({ loading: false });
    }
  },

  // Hydrate the page from a meeting DTO. Catalogs are optional; when omitted the
  // current catalogs are kept (used after a section save, which returns only the meeting).
  applyMeeting(detail, roles, venues, users, attendees) {
    const roleCatalog = roles
      ? roles.filter((role) => role.is_bookable !== false)
      : this.data.roleCatalog;
    const venueCatalog = venues || this.data.venueCatalog;
    const userCatalog = users || this.data.userCatalog;
    const attendeeCatalog = attendees || this.data.attendeeCatalog;

    const allSlots = (detail.role_slots || []).map((s) => ({
      role_slot_id: s.id,
      role_id: s.role_id,
      role_name: s.role_name,
      label: s.custom_label || '',
      display: s.label,
      voting_group: s.voting_group || '',
      is_optional: s.is_optional,
      is_bookable: s.is_bookable !== false,
      taker_id: s.taker_id || null,
      taker_name: s.taker_name || '',
      speech: s.speech || {},
      open: false
    }));

    const slots = allSlots.filter((s) => s.is_bookable);
    const tableTopics = allSlots
      .filter((s) => !s.is_bookable)
      .map((s) => {
        const attendeePosition = s.taker_id
          ? attendeeCatalog.findIndex((u) => u.id === s.taker_id)
          : -1;
        const hasCheckedInUser = attendeePosition >= 0;
        const attendeeIndex = hasCheckedInUser ? attendeePosition + 1 : 0;
        const legacyName = hasCheckedInUser ? '' : (s.taker_name || s.label || '');
        return {
          role_slot_id: s.role_slot_id,
          user_id: hasCheckedInUser ? s.taker_id : null,
          name: s.taker_name || s.label || '',
          legacy_name: legacyName,
          attendee_index: attendeeIndex,
          needs_mapping: !hasCheckedInUser
        };
      });

    const speeches = allSlots
      .filter((s) => isPreparedSpeechRole(s.role_name))
      .map((s) => {
        const sp = s.speech || {};
        return {
          role_slot_id: s.role_slot_id,
          display: s.display,
          taker_name: s.taker_name || '',
          title: sp.title || '',
          pathway: sp.pathway || '',
          level: sp.level == null ? '' : String(sp.level),
          purpose: sp.purpose || '',
          description: sp.description || ''
        };
      });

    const sessions = (detail.sessions || [])
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((s) => ({
        id: s.id,
        group_label: s.group_label || '',
        name: s.name,
        duration_minutes: s.duration_minutes,
        role_slot_id: s.role_slot_id || null,
        open: false
      }));

    this.setData({
      loading: false,
      meetingId: detail.id,
      header: {
        number: detail.number,
        title: detail.title,
        theme: detail.theme,
        venue: detail.venue,
        status: detail.status,
        published: detail.status === 'published',
        dateLabel: shortDate(detail.date),
        timeLabel: detail.end_time ? `${detail.start_time}–${detail.end_time}` : detail.start_time
      },
      info: {
        title: detail.title,
        theme: detail.theme,
        keyword: detail.keyword,
        date: detail.date,
        start_time: detail.start_time,
        end_time: detail.end_time,
        venue: detail.venue
      },
      roleCatalog,
      roleNames: roleCatalog.map((r) => r.name),
      venueCatalog,
      venueNames: venueCatalog.map((v) => v.name),
      userCatalog,
      userNames: [NONE_LABEL].concat(userCatalog.map((u) => u.display_name)),
      attendeeCatalog,
      attendeeNames: attendeePickerOptions(attendeeCatalog),
      slots,
      speeches,
      sessions: this.withStarts(sessions, detail.start_time, slots),
      tableTopics,
      slotPickerLabels: [NONE_LABEL].concat(slots.map((s) => s.display)),
      swipe: { type: '', index: -1 }
    });
  },

  // Compute each session's start label from the meeting start + cumulative durations +
  // inter-session buffer, and resolve its role slot's display label.
  withStarts(sessions, startTime, slots) {
    const byId = {};
    (slots || []).forEach((s) => {
      if (s.role_slot_id) byId[s.role_slot_id] = s;
    });
    let cursor = toMinutes(startTime || this.data.info.start_time);
    return sessions.map((s, idx) => {
      const start = toHHMM(cursor);
      cursor += Number(s.duration_minutes) || 0;
      if (idx < sessions.length - 1) cursor += BUFFER_MINUTES;
      const slot = s.role_slot_id ? byId[s.role_slot_id] : null;
      return Object.assign({}, s, { start, roleLabel: slot ? slot.display : '' });
    });
  },

  recomputeStarts() {
    this.setData({
      sessions: this.withStarts(this.data.sessions, this.data.info.start_time, this.data.slots)
    });
  },

  // Run a section-save promise (returns the updated meeting), re-hydrate, and toast.
  persist(promise) {
    this.setData({ saving: true });
    return promise
      .then((detail) => {
        this.applyMeeting(
          detail,
          this.data.roleCatalog,
          this.data.venueCatalog,
          this.data.userCatalog,
          this.data.attendeeCatalog
        );
        wx.showToast({ title: 'Saved', icon: 'success' });
      })
      .catch((err) => wx.showToast({ title: (err && err.error) || 'Save failed', icon: 'none' }))
      .finally(() => this.setData({ saving: false }));
  },

  // --- Tabs -------------------------------------------------------------------
  switchTab(e) {
    this.setData({ activeTab: e.currentTarget.dataset.tab, swipe: { type: '', index: -1 } });
  },
  onTabsScroll(e) {
    const { scrollLeft, scrollWidth } = e.detail;
    const view = this._tabsView || 0;
    this.setData({
      edgeLeft: scrollLeft > 4,
      edgeRight: scrollLeft < scrollWidth - view - 4
    });
  },
  noop() {},

  // --- Drag handle to reorder (roles & sessions share one behavior) -----------
  onDragStart(e) {
    const type = e.currentTarget.dataset.type;
    const index = e.currentTarget.dataset.index;
    this._drag = { type, index, startY: e.touches[0].clientY };
    this.setData({ drag: { type, index, offset: 0 }, swipe: { type: '', index: -1 } });
  },
  onDragMove(e) {
    if (!this._drag) return;
    this.setData({ 'drag.offset': e.touches[0].clientY - this._drag.startY });
  },
  onDragEnd() {
    if (!this._drag) return;
    const { type, index } = this._drag;
    const ROW = 72; // approx row height in px; tune on device
    const steps = Math.round((this.data.drag.offset || 0) / ROW);
    this._drag = null;
    if (!steps) {
      this.setData({ drag: { type: '', index: -1, offset: 0 } });
      return;
    }
    const key = type === 'role' ? 'slots' : 'sessions';
    const list = this.data[key].slice();
    const target = Math.max(0, Math.min(list.length - 1, index + steps));
    const [item] = list.splice(index, 1);
    list.splice(target, 0, item);
    const patch = { drag: { type: '', index: -1, offset: 0 } };
    if (type === 'session') {
      patch.sessions = this.withStarts(list, this.data.info.start_time, this.data.slots);
    } else {
      patch.slots = list;
      patch.slotPickerLabels = [NONE_LABEL].concat(list.map((s) => s.display));
    }
    this.setData(patch);
  },

  // --- Swipe-to-reveal row actions --------------------------------------------
  onSwipeStart(e) {
    this._sx = e.touches[0].clientX;
    this._sy = e.touches[0].clientY;
  },
  onSwipeEnd(e) {
    const dx = e.changedTouches[0].clientX - (this._sx || 0);
    const dy = e.changedTouches[0].clientY - (this._sy || 0);
    // Ignore taps and mostly-vertical moves; those are handled by tap-to-expand.
    if (Math.abs(dx) < 30 || Math.abs(dx) < Math.abs(dy)) return;
    const type = e.currentTarget.dataset.type;
    const index = e.currentTarget.dataset.index;
    if (dx < 0) {
      this.setData({ swipe: { type, index } });
    } else if (this.data.swipe.index === index && this.data.swipe.type === type) {
      this.setData({ swipe: { type: '', index: -1 } });
    }
  },
  closeSwipe() {
    if (this.data.swipe.index !== -1) this.setData({ swipe: { type: '', index: -1 } });
  },

  // --- Info -------------------------------------------------------------------
  onInfoInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [`info.${field}`]: e.detail.value });
  },
  onDateChange(e) {
    this.setData({ 'info.date': e.detail.value });
  },
  onStartChange(e) {
    this.setData({ 'info.start_time': e.detail.value }, () => this.recomputeStarts());
  },
  onEndChange(e) {
    this.setData({ 'info.end_time': e.detail.value });
  },
  onVenuePick(e) {
    const venue = this.data.venueCatalog[e.detail.value];
    if (!venue) return;
    this.setData({ 'info.venue': venue.name });
  },
  saveInfo() {
    const info = this.data.info;
    if (!info.title.trim()) {
      wx.showToast({ title: 'Title is required', icon: 'none' });
      return;
    }
    if (!info.date) {
      wx.showToast({ title: 'Date is required', icon: 'none' });
      return;
    }
    this.persist(api.saveMeetingInfo(this.meetingId, info));
  },

  // --- Roles ------------------------------------------------------------------
  toggleSlot(e) {
    const i = e.currentTarget.dataset.index;
    const slots = this.data.slots.map((s, idx) => Object.assign({}, s, { open: idx === i ? !s.open : false }));
    this.setData({ slots, swipe: { type: '', index: -1 } });
  },
  onSlotRolePick(e) {
    const i = e.currentTarget.dataset.index;
    const role = this.data.roleCatalog[e.detail.value];
    if (!role) return;
    this.setData({
      [`slots[${i}].role_id`]: role.id,
      [`slots[${i}].role_name`]: role.name,
      [`slots[${i}].voting_group`]: role.voting_group || ''
    });
  },
  onSlotRoleInput(e) {
    // Typing a name creates/looks up a role by name on save; clear any picked id.
    const i = e.currentTarget.dataset.index;
    this.setData({ [`slots[${i}].role_name`]: e.detail.value, [`slots[${i}].role_id`]: null });
  },
  onSlotLabelInput(e) {
    const i = e.currentTarget.dataset.index;
    this.setData({ [`slots[${i}].label`]: e.detail.value });
  },
  onSlotVotingGroupInput(e) {
    const i = e.currentTarget.dataset.index;
    this.setData({ [`slots[${i}].voting_group`]: e.detail.value });
  },
  onSlotTakerPick(e) {
    const i = e.currentTarget.dataset.index;
    const idx = parseInt(e.detail.value, 10);
    if (!idx) {
      this.setData({ [`slots[${i}].taker_id`]: null, [`slots[${i}].taker_name`]: '' });
      return;
    }
    const u = this.data.userCatalog[idx - 1];
    this.setData({ [`slots[${i}].taker_id`]: u.id, [`slots[${i}].taker_name`]: u.display_name });
  },
  addSlot(e) {
    const i = e && e.currentTarget ? e.currentTarget.dataset.index : undefined;
    const newSlot = {
      role_slot_id: null,
      role_id: null,
      role_name: '',
      label: '',
      display: 'New role',
      voting_group: '',
      is_optional: false,
      taker_id: null,
      taker_name: '',
      open: true
    };
    const slots = this.data.slots.slice();
    if (i === undefined || i === null || i === '') {
      slots.push(newSlot);
    } else {
      slots.splice(i + 1, 0, newSlot);
    }
    this.setData({ slots });
  },
  deleteSlot(e) {
    const i = e.currentTarget.dataset.index;
    const slots = this.data.slots.slice();
    slots.splice(i, 1);
    this.setData({ slots });
  },
  saveSlots() {
    const payload = [];
    for (const s of this.data.slots) {
      if (!s.role_id && !(s.role_name || '').trim()) {
        wx.showToast({ title: 'Each role needs a name', icon: 'none' });
        return;
      }
      payload.push({
        role_slot_id: s.role_slot_id || null,
        role_id: s.role_id || null,
        role_name: (s.role_name || '').trim() || null,
        label: (s.label || '').trim() || null,
        voting_group: (s.voting_group || '').trim() || null,
        is_optional: !!s.is_optional,
        taker_id: s.taker_id || null
      });
    }
    this.persist(api.saveSlots(this.meetingId, payload));
  },

  // --- Sessions ---------------------------------------------------------------
  toggleSession(e) {
    const i = e.currentTarget.dataset.index;
    const sessions = this.data.sessions.map((s, idx) => Object.assign({}, s, { open: idx === i ? !s.open : false }));
    this.setData({ sessions, swipe: { type: '', index: -1 } });
  },
  onSessionInput(e) {
    const i = e.currentTarget.dataset.index;
    const field = e.currentTarget.dataset.field;
    let value = e.detail.value;
    if (field === 'duration_minutes') value = parseInt(value, 10) || 0;
    this.setData({ [`sessions[${i}].${field}`]: value });
    if (field === 'duration_minutes') this.recomputeStarts();
  },
  onSessionRolePick(e) {
    const i = e.currentTarget.dataset.index;
    const idx = parseInt(e.detail.value, 10);
    const slotId = idx ? this.data.slots[idx - 1].role_slot_id || null : null;
    this.setData({ [`sessions[${i}].role_slot_id`]: slotId }, () => this.recomputeStarts());
  },
  moveSession(e) {
    const i = e.currentTarget.dataset.index;
    const dir = e.currentTarget.dataset.dir === 'up' ? -1 : 1;
    const j = i + dir;
    const sessions = this.data.sessions.slice();
    if (j < 0 || j >= sessions.length) return;
    const tmp = sessions[i];
    sessions[i] = sessions[j];
    sessions[j] = tmp;
    this.setData({ sessions: this.withStarts(sessions, this.data.info.start_time, this.data.slots) });
  },
  addSession(e) {
    const i = e && e.currentTarget ? e.currentTarget.dataset.index : undefined;
    const newSession = {
      id: null,
      group_label: '',
      name: 'New session',
      duration_minutes: 5,
      role_slot_id: null,
      open: true
    };
    const sessions = this.data.sessions.slice();
    if (i === undefined || i === null || i === '') {
      sessions.push(newSession);
    } else {
      sessions.splice(i + 1, 0, newSession);
    }
    this.setData({ sessions: this.withStarts(sessions, this.data.info.start_time, this.data.slots) });
  },
  deleteSession(e) {
    const i = e.currentTarget.dataset.index;
    const sessions = this.data.sessions.slice();
    sessions.splice(i, 1);
    this.setData({ sessions: this.withStarts(sessions, this.data.info.start_time, this.data.slots) });
  },
  saveSessions() {
    const payload = this.data.sessions.map((s) => ({
      group_label: (s.group_label || '').trim(),
      name: (s.name || '').trim(),
      duration_minutes: Number(s.duration_minutes) || 0,
      role_slot_id: s.role_slot_id || null
    }));
    for (const s of payload) {
      if (!s.name) {
        wx.showToast({ title: 'Each session needs a name', icon: 'none' });
        return;
      }
    }
    this.persist(api.saveSessions(this.meetingId, payload));
  },

  // --- Prepared speeches -----------------------------------------------------
  onSpeechInput(e) {
    const i = e.currentTarget.dataset.index;
    const field = e.currentTarget.dataset.field;
    this.setData({ [`speeches[${i}].${field}`]: e.detail.value });
  },
  saveSpeeches() {
    const speeches = this.data.speeches || [];
    if (!speeches.length) {
      wx.showToast({ title: 'No speaker slots', icon: 'none' });
      return;
    }
    // A speech must be performed by someone and needs a title; other fields are optional.
    const booked = speeches.filter(
      (s) => (s.taker_name || '').trim() && (s.title || '').trim()
    );
    if (!booked.length) {
      wx.showToast({ title: 'Add a speaker and title', icon: 'none' });
      return;
    }
    const jobs = booked.map((s) =>
      api.saveSpeech(this.meetingId, s.role_slot_id, {
        title: (s.title || '').trim(),
        pathway: (s.pathway || '').trim(),
        level: String(s.level || '').trim() === '' ? null : Number(s.level),
        purpose: (s.purpose || '').trim(),
        description: (s.description || '').trim()
      })
    );
    this.persist(Promise.all(jobs).then((results) => results[results.length - 1]));
  },

  // --- Publish ----------------------------------------------------------------
  togglePublish() {
    const next = this.data.header.published ? 'draft' : 'published';
    this.persist(api.setMeetingStatus(this.meetingId, next));
  },

  // --- Table Topics -----------------------------------------------------------
  onTopicPick(e) {
    const i = e.currentTarget.dataset.index;
    const attendeeIndex = parseInt(e.detail.value, 10);
    if (attendeeIndex === this.data.attendeeCatalog.length + 1) {
      this.promptWalkIn(i);
      return;
    }
    const list = this.data.tableTopics.slice();
    const current = list[i];
    if (!attendeeIndex) {
      list[i] = Object.assign({}, current, {
        user_id: null,
        name: current.legacy_name || '',
        attendee_index: 0,
        needs_mapping: true
      });
    } else {
      const attendee = this.data.attendeeCatalog[attendeeIndex - 1];
      if (!attendee) return;
      list[i] = Object.assign({}, current, {
        user_id: attendee.id,
        name: attendee.display_name,
        attendee_index: attendeeIndex,
        needs_mapping: false
      });
    }
    this.setData({ tableTopics: list });
  },
  addTopic() {
    const list = this.data.tableTopics.slice();
    list.push({
      role_slot_id: null,
      user_id: null,
      name: '',
      legacy_name: '',
      attendee_index: 0,
      needs_mapping: true
    });
    this.setData({ tableTopics: list });
  },
  addWalkIn(e) {
    const rawIndex = e && e.currentTarget ? e.currentTarget.dataset.index : undefined;
    const replaceIndex = rawIndex === undefined ? -1 : Number(rawIndex);
    this.promptWalkIn(replaceIndex);
  },
  promptWalkIn(replaceIndex) {
    const current = replaceIndex >= 0 ? this.data.tableTopics[replaceIndex] : null;
    wx.showModal({
      title: 'Add walk-in',
      content: '',
      editable: true,
      placeholderText: (current && current.name) || 'Participant name',
      confirmText: 'Create',
      success: (res) => {
        if (!res.confirm) return;
        const name = (res.content || '').trim();
        if (!name) {
          wx.showToast({ title: 'Name is required', icon: 'none' });
          return;
        }
        this.setData({ saving: true });
        api.createWalkIn(this.meetingId, name)
          .then((attendee) => {
            const attendeeCatalog = this.data.attendeeCatalog.concat([attendee]);
            const tableTopics = this.data.tableTopics.slice();
            const participant = {
              role_slot_id: current ? current.role_slot_id : null,
              user_id: attendee.id,
              name: attendee.display_name,
              legacy_name: '',
              attendee_index: attendeeCatalog.length,
              needs_mapping: false
            };
            if (replaceIndex >= 0) {
              tableTopics[replaceIndex] = participant;
            } else {
              tableTopics.push(participant);
            }
            this.setData({
              attendeeCatalog,
              attendeeNames: attendeePickerOptions(attendeeCatalog),
              tableTopics
            });
            wx.showToast({ title: 'Walk-in checked in', icon: 'success' });
          })
          .catch((err) => wx.showToast({
            title: (err && err.error) || 'Could not add walk-in',
            icon: 'none'
          }))
          .finally(() => this.setData({ saving: false }));
      }
    });
  },
  deleteTopic(e) {
    const i = e.currentTarget.dataset.index;
    const list = this.data.tableTopics.slice();
    list.splice(i, 1);
    this.setData({ tableTopics: list });
  },
  saveTableTopics() {
    const participants = [];
    const seenUsers = {};
    for (const participant of this.data.tableTopics) {
      if (!participant.user_id) {
        wx.showToast({ title: 'Select or create every participant', icon: 'none' });
        return;
      }
      if (seenUsers[participant.user_id]) {
        wx.showToast({ title: 'A participant was added twice', icon: 'none' });
        return;
      }
      seenUsers[participant.user_id] = true;
      participants.push({
        role_slot_id: participant.role_slot_id || null,
        user_id: participant.user_id
      });
    }
    this.persist(api.saveTableTopics(this.meetingId, participants));
  }
});
