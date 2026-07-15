// pages/checkin/checkin.js
const api = require('../../utils/api.js');

Page({
  data: {
    loading: true
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
        this.setData({ loading: false });
        return;
      }
      this.meetingId = meetingId;
      const detail = await api.meeting(meetingId);
      const me = app.globalData.userId;
      const saved = wx.getStorageSync(this.storageKey(meetingId, me));
      const payload = {
        ...(saved || {}),
        meetingId,
        userId: me,
        confirmedAt: saved && saved.confirmedAt ? saved.confirmedAt : new Date().toISOString()
      };
      wx.setStorageSync(this.storageKey(meetingId, me), payload);
      app.globalData.checkinMeetingId = detail.id;
      wx.switchTab({ url: '/pages/meeting/meeting' });
    } catch (e) {
      console.error(e);
      wx.showToast({ title: '加载失败', icon: 'none' });
      this.setData({ loading: false });
    }
  }
});
