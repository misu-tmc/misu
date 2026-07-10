// app.js — establishes the WeChat identity session on launch.
const { login } = require('./utils/api.js');

App({
  globalData: {
    // Backend base URL. In WeChat DevTools, enable
    // "Details > Local settings > Do not verify legal domain names" for http/localhost.
    apiBase: 'http://127.0.0.1:8080',
    token: '',
    userId: 0,
    displayName: '',
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
  }
});
