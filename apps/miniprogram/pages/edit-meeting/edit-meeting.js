// pages/edit-meeting/edit-meeting.js
// Single-page accordion editor for a meeting. Each section (Info / Roles / Sessions)
// saves independently as a batch to its own backend endpoint; a Publish toggle flips
// the meeting status. See design/functionalities/meeting_info.md.
const api = require('../../utils/api.js');
const { shortDate } = require('../../utils/format.js');

const BUFFER_MINUTES = 1;
const NONE_LABEL = '— None —';

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
    open: '', // '', 'info', 'roles', 'sessions'
    info: { title: '', theme: '', keyword: '', date: '', start_time: '', end_time: '', venue: '' },
    slots: [],
    sessions: [],
    roleCatalog: [],
    roleNames: [],
    userCatalog: [],
    userNames: [NONE_LABEL],
    slotPickerLabels: [NONE_LABEL],
    // Which row currently has its swipe actions revealed: { type:'role'|'session', index }.
    swipe: { type: '', index: -1 }
  },

  onLoad(query) {
    this.meetingId = query && query.id ? parseInt(query.id, 10) : null;
    this.load();
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
      const [detail, roles, users] = await Promise.all([
        api.meeting(meetingId),
        api.roles().catch(() => []),
        api.users().catch(() => [])
      ]);
      this.meetingId = meetingId;
      this.applyMeeting(detail, roles, users);
    } catch (e) {
      console.error(e);
      wx.showToast({ title: 'Load failed', icon: 'none' });
      this.setData({ loading: false });
    }
  },

  // Hydrate the page from a meeting DTO. `roles`/`users` are optional; when omitted the
  // current catalogs are kept (used after a section save, which returns only the meeting).
  applyMeeting(detail, roles, users) {
    const roleCatalog = roles || this.data.roleCatalog;
    const userCatalog = users || this.data.userCatalog;

    const slots = (detail.role_slots || []).map((s) => ({
      role_slot_id: s.id,
      role_id: s.role_id,
      role_name: s.role_name,
      label: s.custom_label || '',
      display: s.label,
      is_optional: s.is_optional,
      booker_id: s.booker_id || null,
      booker_name: s.booker_name || '',
      open: false
    }));

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
      userCatalog,
      userNames: [NONE_LABEL].concat(userCatalog.map((u) => u.display_name)),
      slots,
      sessions: this.withStarts(sessions, detail.start_time, slots),
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
  persist(promise, closeSection) {
    this.setData({ saving: true });
    return promise
      .then((detail) => {
        const open = closeSection ? '' : this.data.open;
        this.applyMeeting(detail, this.data.roleCatalog, this.data.userCatalog);
        this.setData({ open });
        wx.showToast({ title: 'Saved', icon: 'success' });
      })
      .catch((err) => wx.showToast({ title: (err && err.error) || 'Save failed', icon: 'none' }))
      .finally(() => this.setData({ saving: false }));
  },

  // --- Accordion --------------------------------------------------------------
  toggleSection(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ open: this.data.open === key ? '' : key, swipe: { type: '', index: -1 } });
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
    this.persist(api.saveMeetingInfo(this.meetingId, info), true);
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
    this.setData({ [`slots[${i}].role_id`]: role.id, [`slots[${i}].role_name`]: role.name });
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
  onSlotBookerPick(e) {
    const i = e.currentTarget.dataset.index;
    const idx = parseInt(e.detail.value, 10);
    if (!idx) {
      this.setData({ [`slots[${i}].booker_id`]: null, [`slots[${i}].booker_name`]: '' });
      return;
    }
    const u = this.data.userCatalog[idx - 1];
    this.setData({ [`slots[${i}].booker_id`]: u.id, [`slots[${i}].booker_name`]: u.display_name });
  },
  addSlot(e) {
    const i = e && e.currentTarget ? e.currentTarget.dataset.index : undefined;
    const newSlot = {
      role_slot_id: null,
      role_id: null,
      role_name: '',
      label: '',
      display: 'New role',
      is_optional: false,
      booker_id: null,
      booker_name: '',
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
        is_optional: !!s.is_optional,
        booker_id: s.booker_id || null
      });
    }
    this.persist(api.saveSlots(this.meetingId, payload), false);
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
    this.persist(api.saveSessions(this.meetingId, payload), false);
  },

  // --- Publish ----------------------------------------------------------------
  togglePublish() {
    const next = this.data.header.published ? 'draft' : 'published';
    this.persist(api.setMeetingStatus(this.meetingId, next), false);
  }
});
