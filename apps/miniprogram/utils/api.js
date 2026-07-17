// utils/api.js — thin request wrapper around wx.request.
// Attaches the session token and points at the configured backend base URL.

function base() {
  return getApp().globalData.apiBase;
}

// Low-level request returning a Promise. Rejects on network errors and non-2xx status.
function request(path, { method = 'GET', data, auth = true } = {}) {
  const header = { 'content-type': 'application/json' };
  if (auth) {
    const token = getApp().globalData.token || wx.getStorageSync('token');
    if (token) {
      header['Authorization'] = 'Bearer ' + token;
    }
  }
  return new Promise((resolve, reject) => {
    wx.request({
      url: base() + path,
      method,
      data,
      header,
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
        } else {
          reject(res.data || { error: 'request failed' });
        }
      },
      fail: reject
    });
  });
}

// Auth: exchange a WeChat login code for a session. Does not require a token.
function login(code) {
  return request('/api/auth/wechat', { method: 'POST', data: { code }, auth: false });
}

const api = {
  request,
  login,
  upcomingMeetings: () => request('/api/meetings/upcoming'),
  meeting: (id) => request('/api/meetings/' + id),
  book: (meetingId, roleSlotId, cancel = false) =>
    request('/api/book', {
      method: 'POST',
      data: { meeting_id: meetingId, role_slot_id: roleSlotId, cancel }
    }),
  updateUser: (userId, displayName) =>
    request('/api/users/' + userId, { method: 'POST', data: { display_name: displayName } }),
  clubInfo: () => request('/api/club-info', { auth: false }),

  // Meeting editor: per-section batch saves. Each returns the full updated meeting.
  roles: () => request('/api/roles'),
  users: () => request('/api/users'),
  saveMeetingInfo: (id, info) =>
    request('/api/meetings/' + id + '/info', { method: 'PUT', data: info }),
  saveSlots: (id, slots) =>
    request('/api/meetings/' + id + '/slots', { method: 'PUT', data: { slots } }),
  saveSessions: (id, sessions) =>
    request('/api/meetings/' + id + '/sessions', { method: 'PUT', data: { sessions } }),
  setMeetingStatus: (id, status) =>
    request('/api/meetings/' + id + '/status', { method: 'PUT', data: { status } })
};

module.exports = api;
