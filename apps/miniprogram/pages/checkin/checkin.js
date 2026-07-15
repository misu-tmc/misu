// pages/checkin/checkin.js
const api = require('../../utils/api.js');
const { shortDate } = require('../../utils/format.js');

Page({
  data: {
    loading: true,
    confirmed: false,
    meeting: null,
    bookedRoles: [],
    welcomeLine: ''
  },

  onLoad(query) {
    this.meetingId = query.meetingId ? Number(query.meetingId) : null;
  },

  onShow() {
    this.load();
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },

  storageKey(meetingId, userId) {
    return `checkin:${meetingId}:${userId}`;
  },

  async resolveMeetingId() {
    if (this.meetingId) return this.meetingId;
    const meetings = await api.upcomingMeetings();
    return meetings.length ? meetings[0].id : null;
  },

  async load() {
    const app = getApp();
    if (app.globalData.ready) await app.globalData.ready;
    if (!app.globalData.token) {
      this.setData({ loading: false });
      return;
    }

    try {
      const meetingId = await this.resolveMeetingId();
      if (!meetingId) {
        this.setData({ loading: false, meeting: null, bookedRoles: [], welcomeLine: '' });
        return;
      }
      this.meetingId = meetingId;
      const detail = await api.meeting(meetingId);
      const me = app.globalData.userId;
      const saved = wx.getStorageSync(this.storageKey(meetingId, me));
      const bookedRoles = (detail.role_slots || [])
        .filter((slot) => slot.booker_id === me)
        .map((slot) => slot.label);
      const payload = {
        ...(saved || {}),
        meetingId,
        userId: me,
        bookedRoles,
        confirmedAt: saved && saved.confirmedAt ? saved.confirmedAt : new Date().toISOString()
      };
      wx.setStorageSync(this.storageKey(meetingId, me), payload);
      this.setData({
        loading: false,
        confirmed: true,
        meeting: {
          id: detail.id,
          number: detail.number,
          theme: detail.theme,
          dateLabel: shortDate(detail.date),
          venue: detail.venue
        },
        bookedRoles: payload.bookedRoles || bookedRoles,
        welcomeLine: bookedRoles.length
          ? `Welcome! You're our ${bookedRoles.join('、')} today, thank you!`
          : "Welcome to today's meeting!"
      });
    } catch (e) {
      console.error(e);
      wx.showToast({ title: '加载失败', icon: 'none' });
      this.setData({ loading: false });
    }
  },

  backToMeeting() {
    wx.switchTab({ url: '/pages/meeting/meeting' });
  }
});
