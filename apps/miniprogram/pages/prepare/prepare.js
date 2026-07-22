// pages/prepare/prepare.js
// Prepare now deep-links into the meeting editor. This page is kept only as a fallback
// placeholder for older links.
Page({
  data: {
    role: ''
  },

  onLoad(query) {
    this.setData({ role: decodeURIComponent(query.role || 'this role') });
  }
});
