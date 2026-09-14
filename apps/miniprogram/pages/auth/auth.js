const api = require('../../utils/api.js');

function wechatCode() {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (result) => result.code
        ? resolve(result.code)
        : reject({ error: 'WeChat did not return a sign-in code.' }),
      fail: () => reject({ error: 'WeChat is unavailable. Please use email sign-in.' })
    });
  });
}

Page({
  data: {
    mode: 'login',
    email: '',
    password: '',
    displayName: '',
    clubName: '',
    saving: false,
    error: '',
    recovered: false
  },

  onLoad(query) {
    this.returnTo = query.returnTo || '/pages/booking/booking';
    if (this.returnTo[0] !== '/') {
      try {
        this.returnTo = decodeURIComponent(this.returnTo);
      } catch (err) {
        this.returnTo = '/pages/booking/booking';
      }
    }
    if (query.mode === 'link') this.setData({ mode: 'link' });
  },

  async onShow() {
    if (this.data.mode !== 'link') return;
    const app = getApp();
    if (!await app.ensureLogin()) {
      this.setData({ mode: 'login', error: 'Sign in before adding an email address.' });
    } else if (app.globalData.user.email) {
      app.finishSignIn(this.returnTo);
    }
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field;
    if (['email', 'password', 'displayName', 'clubName'].includes(field)) {
      this.setData({ [field]: e.detail.value, error: '' });
    }
  },

  toggleMode() {
    if (this.data.saving || this.data.mode === 'link') return;
    this.setData({ mode: this.data.mode === 'login' ? 'register' : 'login', password: '', error: '' });
  },

  async submit() {
    if (this.data.saving) return;
    const { mode, password } = this.data;
    const email = this.data.email.trim();
    const displayName = this.data.displayName.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.setData({ error: 'Enter a valid email address.' });
      return;
    }
    const passwordLength = Array.from(password).length;
    if (!password || (mode !== 'login' && passwordLength < 12) || passwordLength > 128) {
      this.setData({
        error: mode === 'login' && !password
          ? 'Enter your password.'
          : 'Use 12–128 characters for your password.'
      });
      return;
    }
    if (mode === 'register' && !displayName) {
      this.setData({ error: 'Enter your display name.' });
      return;
    }
    this.setData({ saving: true, error: '' });
    const app = getApp();
    let emailLinked = false;
    try {
      if (mode === 'link') {
        const data = await api.linkEmail(email, password);
        emailLinked = true;
        await app.acceptSession(data);
      } else {
        const data = mode === 'register'
          ? await api.emailRegister({
            email, password, display_name: displayName,
            ...(this.data.clubName.trim() ? { club_name: this.data.clubName.trim() } : {})
          })
          : await api.emailLogin(email, password);
        await app.acceptSession(data);
      }
      this.setData({ password: '' });
      app.finishSignIn(this.returnTo);
    } catch (err) {
      if (mode === 'link' && (emailLinked || !app.globalData.token)) {
        this.setData({ mode: 'login', password: '' });
      }
      this.setData({
        error: emailLinked ? 'Email added. Please sign in with email to continue.'
          : err.error || 'Unable to sign in. Please try again.'
      });
    } finally {
      this.setData({ saving: false });
    }
  },

  async recoverWechat() {
    if (this.data.saving) return;
    this.setData({ saving: true, error: '' });
    const app = getApp();
    try {
      const code = await wechatCode();
      await app.acceptSession(await api.recoverWechat(code));
      this.setData({ password: '' });
      if (!app.globalData.user.email) {
        this.setData({ mode: 'link', recovered: true });
      } else {
        app.finishSignIn(this.returnTo);
      }
    } catch (err) {
      this.setData({ error: err.error || 'No existing WeChat account found. Register with email instead.' });
    } finally {
      this.setData({ saving: false });
    }
  },

  async continueToApp() {
    if (this.data.saving) return;
    const app = getApp();
    if (await app.ensureLogin()) app.finishSignIn(this.returnTo);
  },

  onHide() {
    this.setData({ password: '' });
  }
});
