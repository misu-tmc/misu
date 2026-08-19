// Tests for pages/checkin/checkin.js failure semantics.
//
// The mini-program runtime (Page, getApp, wx) only exists on-device, so this harness
// fakes the globals checkin.js expects and swaps the utils/api.js module in
// require.cache with a mock before requiring checkin.js. That lets us capture the
// object passed to Page(...) and drive its lifecycle methods directly in Node.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const checkinPath = require.resolve('./checkin.js');
const apiPath = require.resolve('../../utils/api.js');

// Minimal call-recording stub — no test-double dependency needed.
function spy(impl) {
  const fn = (...args) => {
    fn.calls.push(args);
    return impl ? impl(...args) : undefined;
  };
  fn.calls = [];
  return fn;
}

// Installs fake getApp/wx globals and a mocked utils/api.js module, then requires
// checkin.js fresh so Page(...) runs against the mocks and we capture its definition.
function loadCheckinPage({ apiMock, appGlobalData }) {
  delete require.cache[checkinPath];
  require.cache[apiPath] = {
    id: apiPath,
    filename: apiPath,
    loaded: true,
    exports: apiMock
  };

  const wx = {
    setStorageSync: spy(),
    switchTab: spy(),
    showToast: spy(),
    stopPullDownRefresh: spy()
  };

  const app = {
    globalData: Object.assign(
      { ready: null, token: 'session-token', userId: 7 },
      appGlobalData
    )
  };

  let pageDefinition;
  global.Page = (def) => {
    pageDefinition = def;
  };
  global.getApp = () => app;
  global.wx = wx;

  require(checkinPath);

  return { pageDefinition, wx, app };
}

// Builds a fresh page instance from the captured Page(...) definition, with its own
// `data` copy and a setData that mutates it (mirroring the real mini-program runtime).
function createPageInstance(pageDefinition) {
  const instance = Object.assign({}, pageDefinition);
  instance.data = Object.assign({}, pageDefinition.data);
  instance.setData = function setData(patch) {
    Object.assign(this.data, patch);
  };
  return instance;
}

test('check-in failure: does not cache or navigate, shows failure toast', async () => {
  const apiMock = {
    upcomingMeetings: spy(async () => []),
    meeting: spy(async (id) => ({ id, title: 'Toastmasters Weekly' })),
    checkin: spy(async () => {
      throw new Error('checkin rejected');
    })
  };

  const { pageDefinition, wx, app } = loadCheckinPage({ apiMock });
  const page = createPageInstance(pageDefinition);
  page.onLoad({ meetingId: '42' });

  // Keep test output clean: the outer catch in checkin.js logs the rejection.
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    await page.load();
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(wx.setStorageSync.calls.length, 0, 'must not write a check-in cache entry');
  assert.equal(wx.switchTab.calls.length, 0, 'must not navigate away on failure');
  assert.equal(page.data.loading, false, 'loading must be cleared on failure');
  assert.equal(wx.showToast.calls.length, 1, 'must show a failure toast');
  assert.equal(wx.showToast.calls[0][0].title, '加载失败');
  assert.equal(app.globalData.checkinMeetingId, undefined, 'must not record a check-in meeting id');
});

test('check-in success: caches the confirmation and switches to the meeting tab', async () => {
  const apiMock = {
    upcomingMeetings: spy(async () => []),
    meeting: spy(async (id) => ({ id, title: 'Toastmasters Weekly' })),
    checkin: spy(async () => ({ ok: true }))
  };

  const { pageDefinition, wx, app } = loadCheckinPage({ apiMock });
  const page = createPageInstance(pageDefinition);
  page.onLoad({ meetingId: '42' });

  await page.load();

  assert.equal(wx.setStorageSync.calls.length, 1, 'must write the check-in cache entry');
  const [key, record] = wx.setStorageSync.calls[0];
  assert.equal(key, 'checkin:42:7');
  assert.equal(record.meetingId, 42);
  assert.equal(record.userId, 7);
  assert.equal(typeof record.confirmedAt, 'string');

  assert.equal(app.globalData.checkinMeetingId, 42);

  assert.equal(wx.switchTab.calls.length, 1, 'must switch to the meeting tab');
  assert.equal(wx.switchTab.calls[0][0].url, '/pages/meeting/meeting');
});
