import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const editor = { id: 7, display_name: 'Editor', email: 'editor@example.com', role: 'editor' };
const guest = { id: 8, display_name: 'Guest', email: 'guest@example.com', role: 'guest' };

function runtime({ token = 'stored-token', user = editor, respond } = {}) {
  const storage = new Map(token ? [['token', token]] : []);
  const calls = [];
  const pages = [];
  let app;
  let definition;
  let serverUser = user;
  const wx = {
    getStorageSync: (key) => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: (key) => storage.delete(key),
    getDeviceInfo: () => ({ platform: 'devtools' }),
    showToast: vi.fn(),
    showModal: vi.fn(),
    login: vi.fn(({ success }) => success({ code: 'wechat-code' })),
    navigateTo: vi.fn(({ complete }) => complete?.()),
    redirectTo: vi.fn(),
    switchTab: vi.fn(),
    reLaunch: vi.fn(),
    request: vi.fn((options) => {
      const path = new URL(options.url).pathname;
      calls.push({ path, method: options.method, data: options.data, header: options.header });
      const response = respond?.(path, options);
      Promise.resolve(response === undefined
        ? { statusCode: 200, data: path === '/api/auth/me' ? { user: serverUser } : {} }
        : response).then(options.success, options.fail);
    })
  };
  const cache = new Map();
  const context = vm.createContext({
    wx, getApp: () => app, getCurrentPages: () => pages,
    App: (value) => { app = value; },
    Page: (value) => { definition = value; },
    console, setTimeout, clearTimeout, setInterval, clearInterval
  });
  function load(path) {
    if (cache.has(path)) return cache.get(path);
    if (path.endsWith('.json')) return JSON.parse(readFileSync(path, 'utf8'));
    const module = { exports: {} };
    const wrapper = vm.runInContext(`(function(require,module,exports){${readFileSync(path, 'utf8')}\n})`, context, { filename: path });
    wrapper((name) => load(resolve(dirname(path), name)), module, module.exports);
    cache.set(path, module.exports);
    return module.exports;
  }
  load(resolve(root, 'app.js'));
  const api = load(resolve(root, 'utils/api.js'));
  function page(name, options = {}) {
    load(resolve(root, `pages/${name}/${name}.js`));
    const instance = {
      ...definition,
      data: structuredClone(definition.data),
      route: `pages/${name}/${name}`,
      options,
      setData(patch, complete) { Object.assign(this.data, patch); complete?.(); }
    };
    pages.push(instance);
    instance.onLoad?.(options);
    return instance;
  }
  return {
    app, api, wx, storage, calls, pages, page,
    setUser: (value) => { serverUser = value; },
    async launch() { app.onLaunch(); await app.globalData.ready; }
  };
}

describe('email sessions and permissions', () => {
  it('does not implicitly call WeChat or create an identity on first launch', async () => {
    const env = runtime({ token: '' });
    env.page('booking');
    await env.launch();
    await env.app.ensureLogin();
    expect(env.wx.login).not.toHaveBeenCalled();
    expect(env.calls).toHaveLength(0);
    expect(env.wx.navigateTo.mock.calls[0][0].url).toContain('/pages/auth/auth?returnTo=');
  });

  it('restores only the bearer token and verifies the role with /me', async () => {
    const env = runtime({ user: guest });
    env.storage.set('user', editor);
    const page = env.page('booking');
    await env.launch();
    expect(env.calls[0]).toMatchObject({
      path: '/api/auth/me', header: { Authorization: 'Bearer stored-token' }
    });
    expect(env.app.globalData.user.role).toBe('guest');
    expect(page.data.canEdit).toBe(false);
    expect(env.wx.login).not.toHaveBeenCalled();
  });

  const mutations = [
    ['book', [1, 2]], ['book', [1, 2, true]], ['checkin', [1]],
    ['updateUser', [7, 'New name']], ['createRole', ['Timer']], ['createUser', ['New user']],
    ['createWalkIn', [1, 'Walk in']], ['saveMeetingInfo', [1, {}]],
    ['saveSlots', [1, []]], ['saveSessions', [1, []]], ['saveSpeech', [1, 2, {}]],
    ['setMeetingStatus', [1, 'published']], ['saveTableTopics', [1, []]],
    ['submitVotes', [1, []]], ['request', ['/api/meetings', { method: 'POST' }]]
  ];

  it.each(mutations)('blocks guest content mutation %s before sending it', async (method, args) => {
    const env = runtime({ user: guest });
    await env.launch();
    await expect(env.api[method](...args)).rejects.toMatchObject({ status: 403 });
    expect(env.calls.every((call) => call.path === '/api/auth/me')).toBe(true);
  });

  it.each([undefined, null, 'admin', 'EDITOR'])('fails closed for role %s', async (role) => {
    const env = runtime({ user: { ...guest, role } });
    await env.launch();
    await expect(env.api.book(1, 2)).rejects.toMatchObject({ status: 403 });
  });

  it('refreshes before a write, respecting both promotions and demotions', async () => {
    const env = runtime({ user: guest });
    await env.launch();
    env.setUser(editor);
    await env.api.book(1, 2);
    expect(env.calls.at(-1).path).toBe('/api/book');
    env.setUser(guest);
    await expect(env.api.book(1, 2, true)).rejects.toMatchObject({ status: 403 });
    expect(env.calls.filter((call) => call.path === '/api/book')).toHaveLength(1);
  });

  it('clears edit controls and forbids writes if /me is unavailable', async () => {
    let offline = false;
    const env = runtime({ respond: () => offline ? Promise.reject(new Error('offline')) : undefined });
    const page = env.page('booking');
    await env.launch();
    expect(page.data.canEdit).toBe(true);
    offline = true;
    await expect(env.api.book(1, 2)).rejects.toMatchObject({ error: expect.any(String) });
    expect(page.data.canEdit).toBe(false);
    expect(env.calls.some((call) => call.path === '/api/book')).toBe(false);
  });

  it('handles 401 with email sign-in, preserving the route and never replaying writes', async () => {
    const env = runtime({
      respond: (path) => path === '/api/book' ? { statusCode: 401, data: { error: 'Expired' } } : undefined
    });
    env.pages.push({ route: 'pages/vote/vote', options: { id: '12' }, setData() {} });
    await env.launch();
    await expect(env.api.book(1, 2)).rejects.toMatchObject({ status: 401 });
    expect(env.storage.has('token')).toBe(false);
    expect(env.app.globalData.user).toBeNull();
    expect(env.wx.login).not.toHaveBeenCalled();
    expect(env.wx.navigateTo.mock.calls[0][0].url).toBe('/pages/auth/auth?returnTo=%2Fpages%2Fvote%2Fvote%3Fid%3D12');
    expect(env.calls.filter((call) => call.path === '/api/book')).toHaveLength(1);
  });

  it('does not clear a newer account when an old request later returns 401', async () => {
    let resolveRequest;
    const env = runtime({
      respond: (path) => path === '/api/meetings/1'
        ? new Promise((resolve) => { resolveRequest = resolve; }) : undefined
    });
    await env.launch();
    const pending = env.api.meeting(1);
    env.app.clearSession();
    env.app.globalData.token = 'new-token';
    env.app.setUser(guest);
    resolveRequest({ statusCode: 401, data: {} });
    await expect(pending).rejects.toMatchObject({ status: 401 });
    expect(env.app.globalData.token).toBe('new-token');
  });

  it('does not send a pending mutation under a replacement account', async () => {
    const env = runtime();
    await env.launch();
    env.app.requireEditor = async () => { env.app.globalData.token = 'replacement-token'; };
    await expect(env.api.book(1, 2)).rejects.toMatchObject({ error: 'Account changed. Please retry the action.' });
    expect(env.calls.some((call) => call.path === '/api/book')).toBe(false);
  });

  it('allows guests to read content and explicitly link email or WeChat', async () => {
    const env = runtime({ user: guest });
    await env.launch();
    await env.api.upcomingMeetings();
    await env.api.linkEmail('guest@example.com', 'password123');
    await env.api.linkWechat('explicit-code');
    expect(env.calls.slice(-3).map((call) => call.path)).toEqual([
      '/api/meetings/upcoming', '/api/auth/email/link', '/api/auth/wechat/link'
    ]);
    expect(env.calls.at(-1).header.Authorization).toBe('Bearer stored-token');
    expect(env.wx.login).not.toHaveBeenCalled();
  });

  it('uses bearer auth in Cloud Hosting too', async () => {
    const env = runtime();
    env.app.globalData.apiTransport = 'cloud';
    env.wx.cloud = {
      init: vi.fn(),
      callContainer: vi.fn(async () => ({ statusCode: 200, data: { user: editor } }))
    };
    await env.launch();
    expect(env.wx.cloud.callContainer.mock.calls[0][0]).toMatchObject({
      path: '/api/auth/me',
      header: { Authorization: 'Bearer stored-token', 'X-WX-SERVICE': 'misu-tmc' }
    });
  });

  it('signs out and clears identity-specific local data', async () => {
    const env = runtime();
    await env.launch();
    env.storage.set('avatarUrl', 'private-avatar');
    env.app.signOut();
    expect(env.storage.has('token')).toBe(false);
    expect(env.storage.has('avatarUrl')).toBe(false);
    expect(env.app.globalData.user).toBeNull();
    expect(env.wx.reLaunch).toHaveBeenCalled();
  });
});

describe('native auth and guarded pages', () => {
  it('places the profile access fallback outside the editor container', () => {
    const source = readFileSync(resolve(root, 'pages/edit-profile/edit-profile.wxml'), 'utf8');
    const fallback = '<view wx:else class="container access-note">Profile editing requires editor access.</view>';
    expect(source.trim().endsWith(fallback)).toBe(true);
    const beforeFallback = source.slice(0, source.indexOf(fallback));
    expect((beforeFallback.match(/<view(?:\s|>)/g) || []).length)
      .toBe((beforeFallback.match(/<\/view>/g) || []).length);
    expect(source.startsWith('<view wx:if="{{canEdit}}"')).toBe(true);
  });

  it.each([[11, false], [12, true], [128, true], [129, false]])(
    'validates registration password length %s in Unicode characters',
    async (length, valid) => {
      const env = runtime({
        token: '', user: guest,
        respond: (path) => path === '/api/auth/email/register'
          ? { statusCode: 200, data: { token: 'email-token', user: guest } } : undefined
      });
      const page = env.page('auth');
      await env.launch();
      page.setData({ mode: 'register', email: 'guest@example.com', displayName: 'Guest', password: '😀'.repeat(length) });
      await page.submit();
      expect(env.calls.some((call) => call.path === '/api/auth/email/register')).toBe(valid);
      if (!valid) expect(page.data.error).toBe('Use 12–128 characters for your password.');
    }
  );

  it('submits email registration without a client-selected role and verifies /me', async () => {
    const env = runtime({
      token: '', user: guest,
      respond: (path) => path === '/api/auth/email/register'
        ? { statusCode: 200, data: { token: 'email-token', user: editor } } : undefined
    });
    const page = env.page('auth', { returnTo: encodeURIComponent('/pages/vote/vote?id=12') });
    await env.launch();
    page.setData({ mode: 'register', email: ' guest@example.com ', password: 'long-password', displayName: ' Guest ', clubName: ' Club ' });
    await page.submit();
    expect(env.calls[0]).toMatchObject({
      path: '/api/auth/email/register',
      data: { email: 'guest@example.com', password: 'long-password', display_name: 'Guest', club_name: 'Club' }
    });
    expect(env.calls[0].data.role).toBeUndefined();
    expect(env.app.globalData.user.role).toBe('guest');
    expect(env.storage.get('token')).toBe('email-token');
    expect(page.data.password).toBe('');
    expect(env.wx.redirectTo).toHaveBeenCalledWith({ url: '/pages/vote/vote?id=12' });
  });

  it('preserves an editor deep link after email login', async () => {
    const env = runtime({
      token: '',
      respond: (path) => path === '/api/auth/email/login'
        ? { statusCode: 200, data: { token: 'email-token', user: editor } } : undefined
    });
    const route = '/pages/edit-meeting/edit-meeting?id=12&tab=speeches&slotId=4';
    const page = env.page('auth', { returnTo: route });
    await env.launch();
    page.setData({ email: 'editor@example.com', password: 'password123' });
    await page.submit();
    expect(env.wx.redirectTo).toHaveBeenCalledWith({ url: route });
  });

  it.each([
    ['/pages/edit-meeting/edit-meeting?id=12', '/pages/meeting/meeting'],
    ['/pages/edit-profile/edit-profile', '/pages/me/me'],
    ['https://example.com', '/pages/booking/booking']
  ])('redirects a guest away from unsafe return route %s', async (route, target) => {
    const env = runtime({ user: guest });
    await env.launch();
    env.app.finishSignIn(route);
    expect(env.wx.switchTab).toHaveBeenCalledWith({ url: target });
  });

  it('keeps unknown WeChat recovery on auth without creating another identity', async () => {
    const env = runtime({
      token: '',
      respond: (path) => path === '/api/auth/wechat'
        ? { statusCode: 403, data: { error: 'Register with email first.' } } : undefined
    });
    const page = env.page('auth');
    await env.launch();
    await page.recoverWechat();
    expect(env.wx.login).toHaveBeenCalledTimes(1);
    expect(env.calls.map((call) => call.path)).toEqual(['/api/auth/wechat']);
    expect(page.data.error).toContain('Register with email');
    expect(env.storage.has('token')).toBe(false);
  });

  it('recovers an existing legacy editor and offers email linking on the same account', async () => {
    const legacy = { ...editor, email: null };
    const env = runtime({
      token: '', user: legacy,
      respond: (path) => path === '/api/auth/wechat'
        ? { statusCode: 200, data: { token: 'legacy-token', user: legacy } } : undefined
    });
    const page = env.page('auth');
    await env.launch();
    await page.recoverWechat();
    expect(page.data.mode).toBe('link');
    expect(env.app.globalData.user.id).toBe(editor.id);
    expect(env.app.globalData.user.role).toBe('editor');
  });

  it('returns to email sign-in if the authenticated linking session expires', async () => {
    const env = runtime({
      user: { ...editor, email: null },
      respond: (path) => path === '/api/auth/email/link'
        ? { statusCode: 401, data: { error: 'Expired session' } } : undefined
    });
    const page = env.page('auth', { mode: 'link' });
    await env.launch();
    page.setData({ email: 'editor@example.com', password: 'password1234' });
    await page.submit();
    expect(page.data.mode).toBe('login');
    expect(page.data.password).toBe('');
    expect(page.data.error).toBe('Expired session');
    expect(env.wx.login).not.toHaveBeenCalled();
  });

  it('persists the email-link response token and verifies the guest role again', async () => {
    const env = runtime({
      user: { ...guest, email: null },
      respond: (path) => {
        if (path !== '/api/auth/email/link') return undefined;
        env.setUser(guest);
        return { statusCode: 200, data: { token: 'linked-token', user: guest } };
      }
    });
    const page = env.page('auth', { mode: 'link' });
    await env.launch();
    page.setData({ email: 'guest@example.com', password: 'password1234' });
    await page.submit();
    expect(env.storage.get('token')).toBe('linked-token');
    expect(env.app.globalData.user.role).toBe('guest');
    expect(env.app.globalData.user.email).toBe('guest@example.com');
    expect(env.calls.at(-1)).toMatchObject({
      path: '/api/auth/me', header: { Authorization: 'Bearer linked-token' }
    });
    expect(env.wx.switchTab).toHaveBeenCalled();
  });

  it('persists the explicit WeChat-link response token', async () => {
    const env = runtime({
      user: guest,
      respond: (path) => path === '/api/auth/wechat/link'
        ? { statusCode: 200, data: { token: 'wechat-linked-token', user: guest } } : undefined
    });
    const page = env.page('me');
    await env.launch();
    await page.onLinkWechat();
    expect(env.wx.login).toHaveBeenCalledTimes(1);
    expect(env.storage.get('token')).toBe('wechat-linked-token');
    expect(env.app.globalData.user.role).toBe('guest');
    expect(env.calls.at(-1)).toMatchObject({
      path: '/api/auth/me', header: { Authorization: 'Bearer wechat-linked-token' }
    });
  });

  it('guest QR check-in neither writes nor stores a false confirmation', async () => {
    const env = runtime({
      user: guest,
      respond: (path) => path === '/api/meetings/12' ? { statusCode: 200, data: { id: 12 } } : undefined
    });
    const page = env.page('checkin', { meetingId: '12' });
    await env.launch();
    await page.load();
    expect(env.calls.some((call) => call.method === 'POST')).toBe(false);
    expect([...env.storage.keys()].some((key) => key.startsWith('checkin:'))).toBe(false);
    expect(page.data.message).toContain('Guest accounts cannot check in');
  });

  it('a failed editor check-in does not record a success or navigate away', async () => {
    const env = runtime({
      respond: (path) => {
        if (path === '/api/meetings/12') return { statusCode: 200, data: { id: 12 } };
        if (path === '/api/meetings/12/checkin') return { statusCode: 500, data: { error: 'Unavailable' } };
      }
    });
    const page = env.page('checkin', { meetingId: '12' });
    await env.launch();
    await page.load();
    expect([...env.storage.keys()].some((key) => key.startsWith('checkin:'))).toBe(false);
    expect(env.wx.switchTab).not.toHaveBeenCalled();
    expect(page.data.message).toBe('Unavailable');
  });

  it.each(['edit-meeting', 'edit-profile'])('guards direct guest %s navigation', async (name) => {
    const env = runtime({ user: guest });
    const page = env.page(name, { id: '12' });
    await env.launch();
    if (name === 'edit-meeting') await page.load();
    else await page.onShow();
    expect(page.data.canEdit).toBe(false);
    expect(env.wx.switchTab).toHaveBeenCalled();
    expect(env.calls.every((call) => call.path === '/api/auth/me')).toBe(true);
  });
});

describe('meeting editor draft lifecycle', () => {
  function editorRuntime(options = {}) {
    return runtime({
      ...options,
      respond: (path, request) => {
        const response = options.respond?.(path, request);
        if (response !== undefined) return response;
        if (/^\/api\/meetings\/\d+$/.test(path)) {
          return {
            statusCode: 200,
            data: {
              id: Number(path.split('/').at(-1)), number: 12, title: 'Persisted title',
              date: '2026-09-15', start_time: '19:00', end_time: '21:00',
              role_slots: [], sessions: []
            }
          };
        }
        if (path !== '/api/auth/me') return { statusCode: 200, data: [] };
      }
    });
  }

  it('rechecks /me on foreground without replacing any same-account meeting draft', async () => {
    const env = editorRuntime();
    const page = env.page('edit-meeting', { id: '12' });
    await env.launch();
    await page.onShow();
    const draft = {
      info: { ...page.data.info, title: 'Unsaved title' },
      slots: [{ label: 'Unsaved role' }],
      sessions: [{ name: 'Unsaved session' }],
      speeches: [{ title: 'Unsaved speech' }],
      tableTopics: [{ name: 'Unsaved participant' }]
    };
    page.setData(draft);
    const checksBefore = env.calls.filter((call) => call.path === '/api/auth/me').length;
    env.app.onShow();
    await page.onShow();
    expect(page.data).toMatchObject(draft);
    expect(page.data.canEdit).toBe(true);
    expect(env.calls.filter((call) => call.path === '/api/auth/me').length).toBeGreaterThan(checksBefore);
    expect(env.calls.filter((call) => call.path === '/api/meetings/12')).toHaveLength(1);
  });

  it('discards every draft section and redirects after a guest downgrade', async () => {
    const env = editorRuntime();
    const page = env.page('edit-meeting', { id: '12' });
    await env.launch();
    await page.onShow();
    page.setData({
      info: { title: 'Private draft' }, slots: [{}], sessions: [{}],
      speeches: [{}], tableTopics: [{}], userCatalog: [editor]
    });
    env.setUser({ ...editor, role: 'guest' });
    await page.onShow();
    expect(page.data.canEdit).toBe(false);
    expect(page.data.header).toBeNull();
    expect(page.data.info.title).toBe('');
    for (const field of ['slots', 'sessions', 'speeches', 'tableTopics', 'userCatalog']) {
      expect(page.data[field]).toEqual([]);
    }
    expect(env.wx.switchTab).toHaveBeenCalledWith({ url: '/pages/meeting/meeting' });
    env.setUser(editor);
    await page.onShow();
    expect(page.data.info.title).toBe('Persisted title');
  });

  it('discards the previous account draft before loading another editor', async () => {
    const env = editorRuntime();
    const page = env.page('edit-meeting', { id: '12' });
    await env.launch();
    await page.onShow();
    page.setData({ info: { title: 'Old account draft' } });
    env.setUser({ ...editor, id: 99 });
    await page.onShow();
    expect(page.data.info.title).toBe('Persisted title');
    expect(page._draftOwnerId).toBe(99);
    expect(env.calls.filter((call) => call.path === '/api/meetings/12')).toHaveLength(2);
  });

  it('does not reuse a draft for a different meeting', async () => {
    const env = editorRuntime();
    const page = env.page('edit-meeting', { id: '12' });
    await env.launch();
    await page.onShow();
    page.setData({ info: { title: 'Meeting 12 draft' } });
    page.meetingId = 13;
    await page.onShow();
    expect(page.data.info.title).toBe('Persisted title');
    expect(page.data.meetingId).toBe(13);
  });

  it('keeps a same-account draft hidden through a temporary /me failure', async () => {
    let offline = false;
    const env = editorRuntime({
      respond: (path) => path === '/api/auth/me' && offline ? Promise.reject(new Error('offline')) : undefined
    });
    const page = env.page('edit-meeting', { id: '12' });
    await env.launch();
    await page.onShow();
    page.setData({ info: { title: 'Offline draft' } });
    offline = true;
    await page.onShow();
    expect(page.data.canEdit).toBe(false);
    expect(page.data.info.title).toBe('Offline draft');
    offline = false;
    await page.onShow();
    expect(page.data.canEdit).toBe(true);
    expect(page.data.info.title).toBe('Offline draft');
    expect(env.calls.filter((call) => call.path === '/api/meetings/12')).toHaveLength(1);
  });

  it('clears drafts when session verification returns 401', async () => {
    let expired = false;
    const env = editorRuntime({
      respond: (path) => path === '/api/auth/me' && expired
        ? { statusCode: 401, data: { error: 'Expired' } } : undefined
    });
    const page = env.page('edit-meeting', { id: '12' });
    await env.launch();
    await page.onShow();
    page.setData({ info: { title: 'Expired account draft' } });
    expired = true;
    await page.onShow();
    expect(page.data.header).toBeNull();
    expect(page.data.info.title).toBe('');
    expect(page.data.canEdit).toBe(false);
  });

  it('does not restore an in-flight meeting load after a guest downgrade', async () => {
    let finishMeeting;
    const env = editorRuntime({
      respond: (path) => path === '/api/meetings/12'
        ? new Promise((resolve) => { finishMeeting = resolve; }) : undefined
    });
    const page = env.page('edit-meeting', { id: '12' });
    await env.launch();
    const pendingLoad = page.onShow();
    await vi.waitFor(() => expect(finishMeeting).toBeTypeOf('function'));
    env.setUser({ ...editor, role: 'guest' });
    await page.onShow();
    finishMeeting({
      statusCode: 200,
      data: { id: 12, title: 'Stale meeting', date: '2026-09-15', role_slots: [], sessions: [] }
    });
    await pendingLoad;
    expect(page.data.header).toBeNull();
    expect(page.data.info.title).toBe('');
    expect(page.data.canEdit).toBe(false);
  });
});
