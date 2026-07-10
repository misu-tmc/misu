// pages/meeting/meeting.js
const api = require('../../utils/api.js');
const { shortDate, buildAgenda } = require('../../utils/format.js');

Page({
  data: {
    loading: true,
    hasMeeting: false,
    meeting: null,
    agenda: []
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
      // Show the soonest upcoming published meeting (during a meeting this is that meeting).
      const meetings = await api.upcomingMeetings();
      if (!meetings.length) {
        this.setData({ loading: false, hasMeeting: false });
        return;
      }
      const detail = await api.meeting(meetings[0].id);
      this.setData({
        loading: false,
        hasMeeting: true,
        meeting: {
          id: detail.id,
          number: detail.number,
          theme: detail.theme,
          venue: detail.venue,
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

  // Check-in / voting / timer are later-stage flows (see design TODO).
  comingSoon() {
    wx.showToast({ title: 'Coming soon', icon: 'none' });
  }
});
