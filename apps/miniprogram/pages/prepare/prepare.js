// pages/prepare/prepare.js
// Role "extra info" (speech title/level, evaluatee, etc.) is deferred in the design.
// This page shows the booked role and a note that preparation details are coming.
Page({
  data: {
    role: ''
  },

  onLoad(query) {
    this.setData({ role: decodeURIComponent(query.role || 'this role') });
  }
});
