// utils/api.js — thin request wrapper around wx.request / wx.cloud.callContainer.
// Attaches the session token and selects the transport configured in app.js.

function resolveTransport(config) {
  const configured = config.apiTransport || 'request';
  if (configured !== 'auto') return configured;

  try {
    const device = typeof wx.getDeviceInfo === 'function'
      ? wx.getDeviceInfo()
      : wx.getSystemInfoSync();
    return device.platform === 'devtools' ? 'request' : 'cloud';
  } catch (err) {
    // Prefer the deploy-safe transport if runtime detection is unavailable.
    return 'cloud';
  }
}

function send(path, { method, data, header }) {
  const config = getApp().globalData;
  const transport = resolveTransport(config);

  if (transport === 'cloud') {
    if (!wx.cloud || typeof wx.cloud.callContainer !== 'function') {
      return Promise.reject({ error: 'wx.cloud.callContainer is unavailable' });
    }
    if (!config.cloudEnv || !config.cloudService) {
      return Promise.reject({ error: 'cloudEnv and cloudService are required' });
    }

    return wx.cloud.callContainer({
      config: { env: config.cloudEnv },
      path,
      method,
      data,
      header: Object.assign({}, header, {
        'X-WX-SERVICE': config.cloudService
      })
    });
  }

  if (transport !== 'request') {
    return Promise.reject({ error: 'unsupported apiTransport: ' + transport });
  }

  return new Promise((resolve, reject) => {
    wx.request({
      url: config.apiBase.replace(/\/$/, '') + path,
      method,
      data,
      header,
      success: resolve,
      fail: reject
    });
  });
}

// Low-level request returning a Promise. Rejects on network errors and non-2xx status.
async function request(path, { method = 'GET', data, auth = true } = {}) {
  const app = getApp();
  const originalToken = app.globalData.token;
  method = method.toUpperCase();
  // Account linking is allowed for guests; every content write requires a fresh /me.
  const accountLink = path === '/api/auth/email/link' || path === '/api/auth/wechat/link';
  const publicAuth = path === '/api/auth/email/login' ||
    path === '/api/auth/email/register' || path === '/api/auth/wechat';
  if (method !== 'GET' && method !== 'HEAD' && !accountLink && !publicAuth) {
    await app.requireEditor();
    if (originalToken !== app.globalData.token) {
      throw { error: 'Account changed. Please retry the action.' };
    }
  }
  const header = { 'content-type': 'application/json' };
  const token = app.globalData.token;
  if (auth) {
    if (!token) {
      app.openSignIn();
      throw { status: 401, error: 'Please sign in with email.' };
    }
    header['Authorization'] = 'Bearer ' + token;
  }
  return send(path, { method, data, header }).then((res) => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      return res.data;
    }
    if (auth && res.statusCode === 401 && app.globalData.token === token) {
      app.clearSession();
      app.openSignIn();
    }
    if (auth && res.statusCode === 403 && app.globalData.token === token) {
      app.setUser(null);
    }
    return Promise.reject(Object.assign({ error: 'Request failed' }, res.data, { status: res.statusCode }));
  });
}

const api = {
  resolveTransport,
  request,
  emailLogin: (email, password) =>
    request('/api/auth/email/login', { method: 'POST', data: { email, password }, auth: false }),
  emailRegister: (data) =>
    request('/api/auth/email/register', { method: 'POST', data, auth: false }),
  currentUser: () => request('/api/auth/me'),
  linkEmail: (email, password) =>
    request('/api/auth/email/link', { method: 'POST', data: { email, password } }),
  recoverWechat: (code) =>
    request('/api/auth/wechat', { method: 'POST', data: { code }, auth: false }),
  linkWechat: (code) =>
    request('/api/auth/wechat/link', { method: 'POST', data: { code } }),
  upcomingMeetings: () => request('/api/meetings/upcoming'),
  meeting: (id) => request('/api/meetings/' + id),
  book: (meetingId, roleSlotId, cancel = false) =>
    request('/api/book', {
      method: 'POST',
      data: { meeting_id: meetingId, role_slot_id: roleSlotId, cancel }
    }),
  checkinStatus: (meetingId) => request('/api/meetings/' + meetingId + '/checkin'),
  checkin: (meetingId) => request('/api/meetings/' + meetingId + '/checkin', { method: 'POST' }),
  updateUser: (userId, displayName) =>
    request('/api/users/' + userId, { method: 'POST', data: { display_name: displayName } }),
  clubInfo: () => request('/api/club-info', { auth: false }),

  // Meeting editor: per-section batch saves. Each returns the full updated meeting.
  roles: () => request('/api/roles'),
  createRole: (name) => request('/api/roles', { method: 'POST', data: { name } }),
  venues: () => request('/api/venues'),
  users: () => request('/api/users'),
  createUser: (displayName) =>
    request('/api/users', { method: 'POST', data: { display_name: displayName } }),
  attendees: (meetingId) => request('/api/meetings/' + meetingId + '/attendees'),
  createWalkIn: (meetingId, displayName) =>
    request('/api/meetings/' + meetingId + '/attendees', {
      method: 'POST',
      data: { display_name: displayName }
    }),
  saveMeetingInfo: (id, info) =>
    request('/api/meetings/' + id + '/info', { method: 'PUT', data: info }),
  saveSlots: (id, slots) =>
    request('/api/meetings/' + id + '/slots', { method: 'PUT', data: { slots } }),
  saveSessions: (id, sessions) =>
    request('/api/meetings/' + id + '/sessions', { method: 'PUT', data: { sessions } }),
  saveSpeech: (meetingId, roleSlotId, speech) =>
    request('/api/meetings/' + meetingId + '/speech', {
      method: 'PUT',
      data: Object.assign({ role_slot_id: roleSlotId }, speech)
    }),
  setMeetingStatus: (id, status) =>
    request('/api/meetings/' + id + '/status', { method: 'PUT', data: { status } })
  ,
  saveTableTopics: (id, participants) =>
    request('/api/meetings/' + id + '/table-topics', { method: 'PUT', data: { participants } }),
  voteState: (meetingId) => request('/api/meetings/' + meetingId + '/vote'),
  voteResult: (meetingId) => request('/api/meetings/' + meetingId + '/vote/result'),
  submitVotes: (meetingId, ballots) =>
    request('/api/meetings/' + meetingId + '/vote', { method: 'POST', data: { ballots } })
};

module.exports = api;
