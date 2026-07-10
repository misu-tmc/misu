// pages/edit-profile/edit-profile.js
const api = require('../../utils/api.js');

Page({
  data: {
    displayName: '',
    avatarUrl: '',
    saving: false
  },

  onLoad() {
    const app = getApp();
    this.setData({
      displayName: app.globalData.displayName || '',
      avatarUrl: wx.getStorageSync('avatarUrl') || ''
    });
  },

  onNameInput(e) {
    this.setData({ displayName: e.detail.value });
  },

  // WeChat avatar picker (button open-type="chooseAvatar").
  onChooseAvatar(e) {
    const url = e.detail.avatarUrl;
    this.setData({ avatarUrl: url });
    wx.setStorageSync('avatarUrl', url);
  },

  onSave() {
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
