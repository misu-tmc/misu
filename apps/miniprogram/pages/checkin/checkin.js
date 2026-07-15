// pages/checkin/checkin.js
const api = require('../../utils/api.js');
const { shortDate } = require('../../utils/format.js');

Page({
  data: {
    loading: true,
    confirmed: false,
    meeting: null,
    roles: [],
    selectedIds: [],
    noRole: false
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
        this.setData({ loading: false, meeting: null, roles: [] });
        return;
      }
      this.meetingId = meetingId;
      const detail = await api.meeting(meetingId);
      const me = app.globalData.userId;
      const saved = wx.getStorageSync(this.storageKey(meetingId, me));
      const roles = (detail.role_slots || [])
        .map((slot) => {
          const mine = slot.booker_id === me;
          return {
            id: slot.id,
            label: slot.label,
            mine,
            selected: saved ? (saved.roleSlotIds || []).includes(slot.id) : mine
          };
        })
        .sort((a, b) => {
          if (a.mine !== b.mine) return a.mine ? -1 : 1;
          return a.label.localeCompare(b.label);
        });
      const selectedIds = roles.filter((r) => r.selected).map((r) => r.id);
      this.setData({
        loading: false,
        confirmed: !!saved,
        meeting: {
          id: detail.id,
          number: detail.number,
          theme: detail.theme,
          dateLabel: shortDate(detail.date),
          venue: detail.venue
        },
        roles,
        selectedIds,
        noRole: saved ? !!saved.noRole : selectedIds.length === 0
      });
    } catch (e) {
      console.error(e);
      wx.showToast({ title: '加载失败', icon: 'none' });
      this.setData({ loading: false });
    }
  },

  toggleRole(e) {
    const roleId = Number(e.currentTarget.dataset.roleId);
    const roles = this.data.roles.map((r) => {
      if (r.id !== roleId) return r;
      return { ...r, selected: !r.selected };
    });
    const selectedIds = roles.filter((r) => r.selected).map((r) => r.id);
    this.setData({ roles, selectedIds, noRole: selectedIds.length === 0 });
  },

  chooseNoRole() {
    const roles = this.data.roles.map((r) => ({ ...r, selected: false }));
    this.setData({ roles, selectedIds: [], noRole: true });
  },

  confirm() {
    const app = getApp();
    if (!this.data.noRole && this.data.selectedIds.length === 0) {
      wx.showToast({ title: '请选择角色或无角色', icon: 'none' });
      return;
    }
    const payload = {
      meetingId: this.data.meeting.id,
      userId: app.globalData.userId,
      roleSlotIds: this.data.selectedIds,
      noRole: this.data.noRole,
      confirmedAt: new Date().toISOString()
    };
    wx.setStorageSync(this.storageKey(payload.meetingId, payload.userId), payload);
    this.setData({ confirmed: true });
    wx.showToast({ title: 'Checked in', icon: 'success' });
  },

  backToMeeting() {
    wx.switchTab({ url: '/pages/meeting/meeting' });
  }
});
