// pages/booking/booking.js
const api = require('../../utils/api.js');
const { shortDate } = require('../../utils/format.js');

Page({
  data: {
    loading: true,
    bookings: [],
    meetings: []
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
      const meetings = await api.upcomingMeetings();
      const me = app.globalData.userId;
      const bookings = [];
      const cards = meetings.map((m) => {
        const dateLabel = shortDate(m.date);
        const slots = (m.role_slots || []).map((s) => {
          const mine = s.booker_id === me;
          if (mine) {
            bookings.push({
              meetingId: m.id,
              slotId: s.id,
              number: m.number,
              dateLabel,
              roleLabel: s.label
            });
          }
          return {
            id: s.id,
            label: s.label,
            takerName: s.booker_name,
            taken: s.booker_id !== null,
            mine
          };
        });
        return {
          id: m.id,
          number: m.number,
          dateLabel,
          theme: m.theme,
          slots
        };
      });
      this.setData({ meetings: cards, bookings, loading: false });
    } catch (e) {
      console.error(e);
      wx.showToast({ title: '加载失败', icon: 'none' });
      this.setData({ loading: false });
    }
  },

  onTake(e) {
    const { meetingId, slotId } = e.currentTarget.dataset;
    api
      .book(meetingId, slotId, false)
      .then(() => {
        wx.showToast({ title: 'Booked', icon: 'success' });
        this.load();
      })
      .catch((err) => {
        wx.showToast({ title: (err && err.error) || 'Failed', icon: 'none' });
        this.load();
      });
  },

  onCancel(e) {
    const { meetingId, slotId } = e.currentTarget.dataset;
    wx.showModal({
      title: 'Cancel booking?',
      content: 'This role will become open again.',
      success: (res) => {
        if (!res.confirm) return;
        api
          .book(meetingId, slotId, true)
          .then(() => {
            wx.showToast({ title: 'Cancelled', icon: 'none' });
            this.load();
          })
          .catch((err) => {
            wx.showToast({ title: (err && err.error) || 'Failed', icon: 'none' });
          });
      }
    });
  },

  onPrepare(e) {
    const { meetingId, slotId, roleLabel } = e.currentTarget.dataset;
    wx.navigateTo({
      url: `/pages/prepare/prepare?meetingId=${meetingId}&slotId=${slotId}&role=${encodeURIComponent(
        roleLabel
      )}`
    });
  }
});
