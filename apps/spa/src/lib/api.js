export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

async function request(path, options = {}) {
  const { method = 'GET', body, signal } = options;
  let response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      signal,
      headers: { 'content-type': 'application/json', ...(options.headers || {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError(0, 'Cannot reach MISU. Check your connection and try again.');
  }

  let data = {};
  const ct = response.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    try { data = await response.json(); } catch (_) {}
  }

  if (response.ok) return data;
  throw new ApiError(response.status, data.error || `Request failed (${response.status}).`);
}

export const authApi = {
  me: () => request('/api/auth/me'),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  challenge: (credentialId) => request('/api/auth/device/challenge', { method: 'POST', body: { credential_id: credentialId } }),
  verify: (challengeId, signature) => request('/api/auth/device/verify', { method: 'POST', body: { challenge_id: challengeId, signature } }),
  register: (payload) => request('/api/auth/device/register', { method: 'POST', body: payload }),
  migrate: (payload) => request('/api/auth/device/migrate', { method: 'POST', body: payload }),
  migrationCode: () => request('/api/auth/device/migration-code', { method: 'POST', body: {} })
};

export const meetingsApi = {
  upcoming: () => request('/api/meetings/upcoming'),
  get: (id) => request(`/api/meetings/${id}`),
  list: (scope = 'open') => request(`/api/meetings?scope=${encodeURIComponent(scope)}`),
  templates: () => request('/api/templates'),
  upsert: (meeting) => request('/api/meetings', { method: 'POST', body: meeting }),
  updateInfo: (id, info) => request(`/api/meetings/${id}/info`, { method: 'PUT', body: info }),
  putSlots: (id, slots) => request(`/api/meetings/${id}/slots`, { method: 'PUT', body: { slots } }),
  putSessions: (id, sessions) => request(`/api/meetings/${id}/sessions`, { method: 'PUT', body: { sessions } }),
  setStatus: (id, status) => request(`/api/meetings/${id}/status`, { method: 'PUT', body: { status } }),
  putTableTopics: (id, participants) => request(`/api/meetings/${id}/table-topics`, { method: 'PUT', body: { participants } }),
  saveSpeech: (id, roleSlotId, speech) => request(`/api/meetings/${id}/speech`, {
    method: 'PUT',
    body: { role_slot_id: roleSlotId, ...speech }
  })
};

export const bookingApi = {
  book: (meetingId, roleSlotId, cancel = false, userId = undefined) =>
    request('/api/book', {
      method: 'POST',
      body: {
        meeting_id: meetingId,
        role_slot_id: roleSlotId,
        cancel,
        ...(userId !== undefined ? { user_id: userId } : {})
      }
    })
};

export const checkinApi = {
  status: (meetingId) => request(`/api/meetings/${meetingId}/checkin`),
  checkin: (meetingId) => request(`/api/meetings/${meetingId}/checkin`, { method: 'POST' }),
  umbrella: (meetingId) => request('/api/checkin', {
    method: 'POST',
    body: meetingId === null ? {} : { meeting_id: meetingId }
  }),
  attendees: (meetingId) => request(`/api/meetings/${meetingId}/attendees`),
  createWalkIn: (meetingId, displayName) => request(`/api/meetings/${meetingId}/attendees`, {
    method: 'POST', body: { display_name: displayName }
  })
};

export const votingApi = {
  state: (meetingId) => request(`/api/meetings/${meetingId}/vote`),
  submit: (meetingId, ballots) => request(`/api/meetings/${meetingId}/vote`, {
    method: 'POST', body: { ballots }
  }),
  result: (meetingId) => request(`/api/meetings/${meetingId}/vote/result`)
};

export const usersApi = {
  list: () => request('/api/users'),
  create: (displayName) => request('/api/users', { method: 'POST', body: { display_name: displayName } }),
  update: (id, profile) => request(`/api/users/${id}`, { method: 'POST', body: profile })
};

export const catalogApi = {
  roles: () => request('/api/roles'),
  createRole: (name, votingGroup = '') => request('/api/roles', { method: 'POST', body: { name, voting_group: votingGroup } }),
  venues: () => request('/api/venues'),
  createVenue: (name) => request('/api/venues', { method: 'POST', body: { name } })
};

export const clubApi = {
  info: () => request('/api/club-info')
};

export { request };
