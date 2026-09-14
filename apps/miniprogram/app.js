// Email sessions are restored with /me, never by creating a WeChat identity.
const { currentUser, resolveTransport } = require('./utils/api.js');
const { currentRoute, safeReturnRoute, isTabRoute } = require('./utils/navigation.js');

App({
  globalData: {
    // "auto": DevTools uses request; real devices, trial and release use cloud.
    // Set "request" or "cloud" to override runtime detection.
    apiTransport: 'auto',
    // Used by the request transport. In WeChat DevTools, enable "Do not verify legal
    // domain names" for local HTTP; production wx.request requires an HTTPS legal domain.
    apiBase: 'http://127.0.0.1:8080',
    // Used by the cloud transport. cloudEnv is the environment ID, while cloudService
    // is the Cloud Hosting service name sent as X-WX-SERVICE.
    cloudEnv: 'prod-d3g3mkrg99c537861',
    cloudService: 'misu-tmc',
    token: '',
    userId: 0,
    displayName: '',
    user: null,
    // Resolves once the stored session has been checked.
    ready: null
  },

  onLaunch() {
    this.initApiTransport();
    this.globalData.token = wx.getStorageSync('token') || '';
    this.globalData.ready = this.refreshSession();
  },

  onShow() {
    if (this.globalData.token) this.refreshSession();
  },

  initApiTransport() {
    if (resolveTransport(this.globalData) !== 'cloud') return;
    if (!this.globalData.cloudEnv || !this.globalData.cloudService) {
      console.error('cloud transport requires cloudEnv and cloudService');
      return;
    }
    if (!wx.cloud || typeof wx.cloud.init !== 'function') {
      console.error('wx.cloud is unavailable; update the mini program base library');
      return;
    }
    wx.cloud.init({
      env: this.globalData.cloudEnv,
      traceUser: true
    });
  },

  setUser(user) {
    this.globalData.user = user;
    this.globalData.userId = user ? user.id : 0;
    this.globalData.displayName = user ? user.display_name : '';
    getCurrentPages().forEach((page) => {
      page.setData({ canEdit: !!user && user.role === 'editor', signedIn: !!user });
    });
  },

  clearSession() {
    this.globalData.token = '';
    this.globalData.checkinMeetingId = null;
    this._sessionRequest = null;
    this.setUser(null);
    wx.removeStorageSync('token');
    wx.removeStorageSync('avatarUrl');
  },

  refreshSession() {
    if (!this.globalData.token) {
      this.setUser(null);
      return Promise.resolve(false);
    }
    if (this._sessionRequest) return this._sessionRequest;
    const token = this.globalData.token;
    this.setUser(null);
    const pending = currentUser().then(({ user }) => {
      if (token !== this.globalData.token) return false;
      if (!user || !user.id) throw { error: 'Invalid session response' };
      this.setUser(user);
      return true;
    }).catch(() => {
      if (token === this.globalData.token) this.setUser(null);
      return false;
    }).finally(() => {
      if (this._sessionRequest === pending) this._sessionRequest = null;
    });
    this._sessionRequest = pending;
    return pending;
  },

  async ensureLogin() {
    if (this.globalData.ready) await this.globalData.ready;
    if (await this.refreshSession()) return true;
    if (!this.globalData.token) this.openSignIn();
    else wx.showToast({ title: 'Cannot verify session. Try again.', icon: 'none' });
    return false;
  },

  async requireEditor() {
    if (!await this.ensureLogin()) throw { error: 'Please sign in and verify your session.' };
    if (this.globalData.user.role !== 'editor') {
      throw { status: 403, error: 'Guest accounts are read-only. Ask an administrator for access.' };
    }
  },

  async acceptSession(data) {
    if (!data || !data.token) throw { error: 'Invalid sign-in response' };
    this.clearSession();
    this.globalData.token = data.token;
    wx.setStorageSync('token', data.token);
    if (!await this.refreshSession()) throw { error: 'Cannot verify session. Please try again.' };
  },

  openSignIn() {
    if (!getCurrentPages().length) return;
    const route = currentRoute();
    if (route.split('?')[0] === '/pages/auth/auth' || this._openingAuth) return;
    this._openingAuth = true;
    const url = '/pages/auth/auth?returnTo=' + encodeURIComponent(route);
    wx.navigateTo({
      url,
      fail: () => wx.redirectTo({ url }),
      complete: () => { this._openingAuth = false; }
    });
  },

  finishSignIn(returnTo) {
    const route = safeReturnRoute(returnTo, this.globalData.user);
    if (isTabRoute(route)) wx.switchTab({ url: route.split('?')[0] });
    else wx.redirectTo({ url: route });
  },

  signOut() {
    this.clearSession();
    wx.reLaunch({ url: '/pages/auth/auth?returnTo=' + encodeURIComponent('/pages/me/me') });
  }
});
