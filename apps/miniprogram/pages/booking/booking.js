// pages/booking/booking.js
const api = require('../../utils/api.js');
const { meetingInfo, shortDate } = require('../../utils/format.js');

function prepTarget(roleName) {
  const role = (roleName || '').toLowerCase();
  if (role.indexOf('grammarian') >= 0) return { tab: 'info', field: 'keyword' };
  if (role.indexOf('table topics master') >= 0) return { tab: 'info', field: 'theme' };
  if (role.indexOf('speaker') >= 0 || role.indexOf('prepared speech') >= 0) {
    return { tab: 'speeches', field: '' };
  }
  return { tab: 'roles', field: '' };
}

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
      const previousExpanded = {};
      (this.data.meetings || []).forEach((m) => {
        previousExpanded[m.id] = !!m.expanded;
      });
      const cards = meetings.map((m, index) => {
        const dateLabel = shortDate(m.date);
        const slots = (m.role_slots || []).map((s) => {
          const mine = s.booker_id === me;
          if (mine) {
            const target = prepTarget(s.role_name);
            bookings.push({
              meetingId: m.id,
              slotId: s.id,
              number: m.number,
              dateLabel,
              roleLabel: s.label,
              roleName: s.role_name,
              prepTab: target.tab,
              prepField: target.field
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
          theme: meetingInfo(m).theme,
          expanded: previousExpanded[m.id] == null ? index === 0 : previousExpanded[m.id],
          slots
        };
      });
      this.setData({ meetings: cards, bookings, loading: false });
      app.promptNameIfNeeded();
    } catch (e) {
      console.error(e);
      wx.showToast({ title: '加载失败', icon: 'none' });
      this.setData({ loading: false });
    }
  },

  onToggleMeeting(e) {
    const meetingId = Number(e.currentTarget.dataset.meetingId);
    const meetings = this.data.meetings.map((m) =>
      m.id === meetingId ? { ...m, expanded: !m.expanded } : m
    );
    this.setData({ meetings });
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
    const { meetingId, slotId, tab, field } = e.currentTarget.dataset;
    let url = `/pages/edit-meeting/edit-meeting?id=${meetingId}&tab=${tab || 'roles'}&slotId=${slotId}`;
    if (field) url += `&field=${field}`;
    wx.navigateTo({ url });
  }
});
