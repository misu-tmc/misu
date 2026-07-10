// pages/misu/misu.js — club introduction, served from GET /api/club-info.
const api = require('../../utils/api.js');

Page({
  data: {
    info: null
  },

  onLoad() {
    api
      .clubInfo()
      .then((info) => this.setData({ info }))
      .catch((e) => console.error(e));
  }
});
