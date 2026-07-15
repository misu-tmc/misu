// pages/meeting/meeting.js
const api = require('../../utils/api.js');
const { shortDate, buildAgenda } = require('../../utils/format.js');

Page({
  data: {
    loading: true,
    hasMeeting: false,
    meeting: null,
    agenda: [],
    checkedIn: false,
    timerMode: false,
    activeTimerKey: null
  },

  timer: null,

  onShow() {
    this.load();
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
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
      // Show the checked-in meeting if arriving from a QR/deep link; otherwise the soonest
      // upcoming published meeting (during a meeting this is that meeting).
      const meetings = await api.upcomingMeetings();
      if (!meetings.length) {
        this.setData({ loading: false, hasMeeting: false });
        return;
      }
      const preferred = app.globalData.checkinMeetingId;
      const meetingId = preferred && meetings.some((m) => m.id === preferred) ? preferred : meetings[0].id;
      const detail = await api.meeting(meetingId);
      const checkedIn = !!wx.getStorageSync(this.storageKey(detail.id, app.globalData.userId));
      this.setData({
        loading: false,
        hasMeeting: true,
        checkedIn,
        meeting: {
          id: detail.id,
          number: detail.number,
          theme: detail.theme,
          venue: detail.venue,
          phase: detail.phase,
          dateLabel: shortDate(detail.date),
          timeLabel: `${detail.start_time}–${detail.end_time}`
        },
        agenda: this.prepareAgenda(buildAgenda(detail))
      });
    } catch (e) {
      console.error(e);
      wx.showToast({ title: '加载失败', icon: 'none' });
      this.setData({ loading: false });
    }
  },

  storageKey(meetingId, userId) {
    return `checkin:${meetingId}:${userId}`;
  },

  prepareAgenda(rows) {
    return rows.map((row) => ({
      ...row,
      key: `session-${row.id}`,
      isSub: false,
      elapsedSeconds: 0,
      elapsedText: '00:00',
      running: false
    }));
  },

  formatElapsed(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  },

  clearTimer() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  },

  goCheckIn() {
    if (!this.data.meeting || !this.data.meeting.id) return;
    const app = getApp();
    wx.setStorageSync(this.storageKey(this.data.meeting.id, app.globalData.userId), {
      meetingId: this.data.meeting.id,
      userId: app.globalData.userId,
      confirmedAt: new Date().toISOString()
    });
    this.setData({ checkedIn: true });
    wx.showToast({ title: 'Checked in', icon: 'success' });
  },

  toggleTimerMode() {
    const next = !this.data.timerMode;
    if (!next) {
      this.clearTimer();
      this.setData({
        timerMode: false,
        activeTimerKey: null,
        agenda: this.data.agenda.map((item) => ({ ...item, running: false }))
      });
      return;
    }
    this.setData({ timerMode: true });
  },

  startTicker() {
    this.clearTimer();
    this.timer = setInterval(() => {
      const activeKey = this.data.activeTimerKey;
      if (!activeKey) return;
      const agenda = this.data.agenda.map((item) => {
        if (item.key !== activeKey) return item;
        const elapsedSeconds = (item.elapsedSeconds || 0) + 1;
        return { ...item, elapsedSeconds, elapsedText: this.formatElapsed(elapsedSeconds) };
      });
      this.setData({ agenda });
    }, 1000);
  },

  playTimer(e) {
    const key = e.currentTarget.dataset.key;
    const isActive = this.data.activeTimerKey === key;
    if (isActive) {
      this.clearTimer();
      this.setData({
        activeTimerKey: null,
        agenda: this.data.agenda.map((item) =>
          item.key === key ? { ...item, running: false } : item
        )
      });
      return;
    }
    const agenda = this.data.agenda.map((item) => ({
      ...item,
      running: item.key === key
    }));
    this.setData({ activeTimerKey: key, agenda }, () => this.startTicker());
  },

  stopTimer(e) {
    const key = e.currentTarget.dataset.key;
    this.clearTimer();
    this.setData({
      activeTimerKey: null,
      agenda: this.data.agenda.map((item) =>
        item.key === key ? { ...item, running: false } : item
      )
    });
  },

  addSubSession(e) {
    const key = e.currentTarget.dataset.key;
    const index = this.data.agenda.findIndex((item) => item.key === key);
    if (index < 0) return;
    const parent = this.data.agenda[index];
    const existing = this.data.agenda.filter((item) => item.parentKey === key).length;
    const sub = {
      id: `${parent.id}-sub-${existing + 1}`,
      key: `${parent.key}-sub-${Date.now()}`,
      parentKey: key,
      isSub: true,
      start: '',
      name: `${parent.name} extra`,
      group_label: parent.group_label,
      duration_minutes: 0,
      taker: '',
      elapsedSeconds: 0,
      elapsedText: '00:00',
      running: false
    };
    const agenda = this.data.agenda.slice();
    agenda.splice(index + 1 + existing, 0, sub);
    this.setData({ agenda });
  },

  onUnload() {
    this.clearTimer();
  },

  onHide() {
    this.clearTimer();
    if (this.data.activeTimerKey) {
      this.setData({
        activeTimerKey: null,
        agenda: this.data.agenda.map((item) => ({ ...item, running: false }))
      });
    }
  },

  // Voting is a later-stage flow (see design TODO).
  comingSoon() {
    wx.showToast({ title: 'Coming soon', icon: 'none' });
  }
});
