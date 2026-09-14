// pages/edit-profile/edit-profile.js
const api = require('../../utils/api.js');

Page({
  data: {
    canEdit: false,
    displayName: '',
    avatarUrl: '',
    saving: false
  },

  async onShow() {
    const app = getApp();
    if (!await app.ensureLogin()) return;
    if (!this.data.canEdit) {
      wx.showToast({ title: 'Guest accounts are read-only', icon: 'none' });
      wx.switchTab({ url: '/pages/me/me' });
      return;
    }
    this.setData({
      displayName: app.globalData.displayName || '',
      avatarUrl: wx.getStorageSync('avatarUrl') || ''
    });
  },

  onNameInput(e) {
    if (!this.data.canEdit) return;
    this.setData({ displayName: e.detail.value });
  },

  // WeChat avatar picker (button open-type="chooseAvatar").
  async onChooseAvatar(e) {
    if (!this.data.canEdit) return;
    try {
      await getApp().requireEditor();
    } catch (err) {
      wx.showToast({ title: err.error || 'Editor access required', icon: 'none' });
      return;
    }
    const url = e.detail.avatarUrl;
    this.setData({ avatarUrl: url });
    wx.setStorageSync('avatarUrl', url);
  },

  onSave() {
    if (!this.data.canEdit || this.data.saving) return;
    const name = (this.data.displayName || '').trim();
    if (!name) {
      wx.showToast({ title: 'Name is required', icon: 'none' });
      return;
    }
    const app = getApp();
    this.setData({ saving: true });
    api
      .updateUser(app.globalData.userId, name)
      .then((user) => {
        app.globalData.displayName = user.display_name;
        wx.showToast({ title: 'Saved', icon: 'success' });
        setTimeout(() => wx.navigateBack(), 500);
      })
      .catch((err) => {
        wx.showToast({ title: (err && err.error) || 'Failed', icon: 'none' });
      })
      .finally(() => this.setData({ saving: false }));
  }
});
