// pages/checkin/checkin.js
const api = require('../../utils/api.js');

Page({
  data: {
    loading: true,
    canEdit: false,
    message: ''
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
    if (!await app.ensureLogin()) {
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
      if (!this.data.canEdit) {
        this.setData({ loading: false, message: 'Guest accounts cannot check in. You can still view the meeting.' });
        return;
      }
      await api.checkin(meetingId);
      const me = app.globalData.userId;
      wx.setStorageSync(this.storageKey(meetingId, me), {
        meetingId,
        userId: me,
        confirmedAt: new Date().toISOString()
      });
      app.globalData.checkinMeetingId = detail.id;
      wx.switchTab({ url: '/pages/meeting/meeting' });
    } catch (e) {
      console.error(e);
      wx.showToast({ title: '加载失败', icon: 'none' });
      this.setData({ loading: false, message: (e && e.error) || 'Unable to check in. Please try again.' });
    }
  },

  viewMeeting() {
    getApp().globalData.checkinMeetingId = this.meetingId;
    wx.switchTab({ url: '/pages/meeting/meeting' });
  }
});
