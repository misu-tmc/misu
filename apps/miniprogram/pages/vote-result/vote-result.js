const api = require('../../utils/api.js');
const { shortDate } = require('../../utils/format.js');

Page({
  data: {
    loading: true,
    meetingId: null,
    meeting: null,
    groups: []
  },

  onLoad(query) {
    query = query || {};
    const meetingId = parseInt(query.id, 10) || null;
    this.setData({ meetingId });
  },

  onShow() {
    this.load();
  },

  async load() {
    const meetingId = this.data.meetingId;
    if (!meetingId) {
      this.setData({ loading: false, groups: [] });
      return;
    }

    const app = getApp();
    if (app.globalData.ready) {
      await app.globalData.ready;
    }
    if (!app.globalData.token) {
      this.setData({ loading: false });
      return;
    }

    try {
      const [detail, result] = await Promise.all([
        api.meeting(meetingId),
        api.voteResult(meetingId)
      ]);

      const groups = (result.groups || []).map((g) => {
        const maxVotes = (g.options || []).reduce((m, o) => Math.max(m, o.votes || 0), 0);
        const totalVotes = g.total_votes || 0;
        return {
          voting_group: g.voting_group,
          total_votes: totalVotes,
          options: (g.options || []).map((o) => {
            const votes = o.votes || 0;
            const ratio = maxVotes > 0 ? Math.round((votes / maxVotes) * 100) : 0;
            return {
              role_slot_id: o.role_slot_id,
              role_name: o.role_name,
              candidate_name: o.candidate_name,
              votes,
              ratio,
              isLeader: maxVotes > 0 && votes === maxVotes
            };
          })
        };
      });

      this.setData({
        loading: false,
        meeting: {
          id: detail.id,
          number: detail.number,
          title: detail.title,
          dateLabel: shortDate(detail.date),
          timeLabel: `${detail.start_time}–${detail.end_time}`,
          venue: detail.venue
        },
        groups
      });
    } catch (e) {
      console.error(e);
      wx.showToast({ title: (e && e.error) || 'Load failed', icon: 'none' });
      this.setData({ loading: false });
    }
  }
});
