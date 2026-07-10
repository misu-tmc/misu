// pages/me/me.js
const api = require('../../utils/api.js');
const { shortDate } = require('../../utils/format.js');

Page({
  data: {
    displayName: '',
    avatarUrl: '',
    bookings: []
  },

  onShow() {
    this.refresh();
  },

  async refresh() {
    const app = getApp();
    if (app.globalData.ready) {
      await app.globalData.ready;
    }
    this.setData({
      displayName: app.globalData.displayName || 'MISU member',
      avatarUrl: wx.getStorageSync('avatarUrl') || ''
    });
    if (!app.globalData.token) return;
    try {
      const meetings = await api.upcomingMeetings();
      const me = app.globalData.userId;
      const bookings = [];
      meetings.forEach((m) => {
        (m.role_slots || []).forEach((s) => {
          if (s.booker_id === me) {
            bookings.push({
              key: `${m.id}-${s.id}`,
              number: m.number,
              dateLabel: shortDate(m.date),
              roleLabel: s.label
            });
          }
        });
      });
      this.setData({ bookings });
    } catch (e) {
      console.error(e);
    }
  },

  onEditProfile() {
    wx.navigateTo({ url: '/pages/edit-profile/edit-profile' });
  },

  onGoBookings() {
    wx.switchTab({ url: '/pages/booking/booking' });
  }
});
