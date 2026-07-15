// pages/meeting/meeting.js
const api = require('../../utils/api.js');
const { shortDate, buildAgenda } = require('../../utils/format.js');

Page({
  data: {
    loading: true,
    hasMeeting: false,
    meeting: null,
    agenda: [],
    checkedIn: false
  },

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
        agenda: buildAgenda(detail)
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

  // Check-in / voting / timer are later-stage flows (see design TODO).
  comingSoon() {
    wx.showToast({ title: 'Coming soon', icon: 'none' });
  }
});
