// pages/me/me.js
const api = require('../../utils/api.js');
const { shortDate } = require('../../utils/format.js');

Page({
  data: {
    canEdit: false,
    signedIn: false,
    displayName: '',
    email: '',
    role: '',
    linkingWechat: false,
    avatarUrl: '',
    bookings: []
  },

  onShow() {
    this.refresh();
  },

  async refresh() {
    const app = getApp();
    this.setData({ displayName: '', email: '', role: '', bookings: [], avatarUrl: '' });
    if (!await app.ensureLogin()) return;
    const user = app.globalData.user;
    this.setData({
      displayName: user.display_name || 'MISU member',
      email: user.email || '',
      role: user.role === 'editor' ? 'Editor' : 'Guest (read-only)',
      avatarUrl: wx.getStorageSync('avatarUrl') || ''
    });
    try {
      const meetings = await api.upcomingMeetings();
      const me = app.globalData.userId;
      const bookings = [];
      meetings.forEach((m) => {
        (m.role_slots || []).forEach((s) => {
          if (s.taker_id === me) {
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
    if (!this.data.canEdit) return;
    wx.navigateTo({ url: '/pages/edit-profile/edit-profile' });
  },

  onGoBookings() {
    wx.switchTab({ url: '/pages/booking/booking' });
  },

  onSignIn() {
    getApp().openSignIn();
  },

  onSignOut() {
    getApp().signOut();
  },

  onLinkEmail() {
    if (!this.data.signedIn || this.data.email) return;
    wx.navigateTo({ url: '/pages/auth/auth?mode=link&returnTo=' + encodeURIComponent('/pages/me/me') });
  },

  async onLinkWechat() {
    if (this.data.linkingWechat || !this.data.signedIn) return;
    this.setData({ linkingWechat: true });
    try {
      const code = await new Promise((resolve, reject) => wx.login({
        success: (result) => result.code ? resolve(result.code) : reject({ error: 'No WeChat code returned.' }),
        fail: () => reject({ error: 'WeChat is unavailable. Please try again.' })
      }));
      const data = await api.linkWechat(code);
      await getApp().acceptSession(data);
      wx.showToast({ title: 'WeChat linked', icon: 'success' });
    } catch (err) {
      wx.showToast({ title: err.error || 'Unable to link WeChat', icon: 'none' });
    } finally {
      this.setData({ linkingWechat: false });
    }
  }
});
