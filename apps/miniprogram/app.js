// app.js — establishes the WeChat identity session on launch.
const { login, updateUser } = require('./utils/api.js');

App({
  globalData: {
    // Backend base URL. In WeChat DevTools, enable
    // "Details > Local settings > Do not verify legal domain names" for http/localhost.
    apiBase: 'http://127.0.0.1:8080',
    token: '',
    userId: 0,
    displayName: '',
    // Guards the first-login name prompt so it shows at most once per launch.
    namePrompted: false,
    // Resolves once the launch login attempt completes (success or failure).
    ready: null
  },

  onLaunch() {
    this.globalData.ready = this.ensureLogin();
  },

  // Runs wx.login -> POST /api/auth/wechat, storing the session token + user.
  ensureLogin() {
    return new Promise((resolve) => {
      wx.login({
        success: (res) => {
          if (!res.code) {
            resolve(false);
            return;
          }
          login(res.code)
            .then((data) => {
              this.globalData.token = data.token;
              this.globalData.userId = data.user.id;
              this.globalData.displayName = data.user.display_name;
              wx.setStorageSync('token', data.token);
              resolve(true);
            })
            .catch((err) => {
              console.error('login failed', err);
              wx.showToast({ title: '登录失败', icon: 'none' });
              resolve(false);
            });
        },
        fail: () => resolve(false)
      });
    });
  },

  // First-login requirement: WeChat no longer exposes real nicknames, so new users have
  // no name yet and must set one before continuing. Shown once per launch, then repeats
  // until saved.
  promptNameIfNeeded() {
    if (this.globalData.namePrompted || !this.globalData.token) return;
    if ((this.globalData.displayName || '').trim()) return;
    this.globalData.namePrompted = true;
    this._askName();
  },

  // Mandatory name entry: no cancel, and it re-opens until a non-empty name is saved.
  _askName() {
    wx.showModal({
      title: 'Set your name',
      content: '',
      editable: true,
      placeholderText: 'Your name',
      showCancel: false,
      confirmText: 'Save',
      success: (res) => {
        const entered = (res.content || '').trim();
        if (!entered) {
          this._askName();
          return;
        }
        updateUser(this.globalData.userId, entered)
          .then((user) => {
            this.globalData.displayName = user.display_name;
            wx.showToast({ title: 'Saved', icon: 'success' });
          })
          .catch(() => {
            wx.showToast({ title: 'Failed, try again', icon: 'none' });
            this._askName();
          });
      },
      fail: () => this._askName()
    });
  }
});
