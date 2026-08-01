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

function refreshLogin() {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (res) => {
        if (!res.code) {
          reject({ error: 'login failed' });
          return;
        }
        request('/api/auth/wechat', {
          method: 'POST',
          data: { code: res.code },
          auth: false,
          retryAuth: false
        })
          .then((data) => {
            const app = getApp();
            app.globalData.token = data.token;
            app.globalData.userId = data.user.id;
            app.globalData.displayName = data.user.display_name;
            wx.setStorageSync('token', data.token);
            resolve(data.token);
          })
          .catch(reject);
      },
      fail: reject
    });
  });
}

// Low-level request returning a Promise. Rejects on network errors and non-2xx status.
function request(path, { method = 'GET', data, auth = true, retryAuth = true } = {}) {
  const header = { 'content-type': 'application/json' };
  if (auth) {
    const token = getApp().globalData.token || wx.getStorageSync('token');
    if (token) {
      header['Authorization'] = 'Bearer ' + token;
    }
  }
  return send(path, { method, data, header }).then((res) => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      return res.data;
    }
    if (auth && retryAuth && res.statusCode === 401) {
      return refreshLogin()
        .then(() => request(path, { method, data, auth, retryAuth: false }))
        .catch((err) => Promise.reject(err || res.data || { error: 'unauthorized' }));
    }
    return Promise.reject(res.data || { error: 'request failed' });
  });
}

// Auth: exchange a WeChat login code for a session. Does not require a token.
function login(code) {
  return request('/api/auth/wechat', { method: 'POST', data: { code }, auth: false });
}

const api = {
  resolveTransport,
  request,
  login,
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
