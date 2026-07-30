// pages/vote/vote.js
const api = require('../../utils/api.js');
const { shortDate } = require('../../utils/format.js');

Page({
  data: {
    loading: true,
    saving: false,
    hasVoted: false,
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
      const [detail, state] = await Promise.all([
        api.meeting(meetingId),
        api.voteState(meetingId)
      ]);

      const selections = state.selections || {};
      const hasVoted = Object.keys(selections).length > 0;
      const groups = (state.groups || []).map((g) => {
        const selectedRoleSlotId = selections[g.voting_group] || null;
        return {
          voting_group: g.voting_group,
          selectedRoleSlotId,
          options: (g.options || []).map((o) => ({
            role_slot_id: o.role_slot_id,
            role_name: o.role_name,
            candidate_name: o.candidate_name,
            selected: selectedRoleSlotId === o.role_slot_id
          }))
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
        hasVoted,
        groups
      });
    } catch (e) {
      console.error(e);
      wx.showToast({ title: (e && e.error) || 'Load failed', icon: 'none' });
      this.setData({ loading: false });
    }
  },

  onPick(e) {
    const groupIndex = parseInt(e.currentTarget.dataset.groupIndex, 10);
    const slotId = parseInt(e.currentTarget.dataset.slotId, 10);
    if (Number.isNaN(groupIndex) || Number.isNaN(slotId)) return;

    const groups = this.data.groups.slice();
    const group = groups[groupIndex];
    if (!group) return;

    group.selectedRoleSlotId = slotId;
    group.options = (group.options || []).map((o) =>
      Object.assign({}, o, { selected: o.role_slot_id === slotId })
    );
    groups[groupIndex] = group;
    this.setData({ groups });
  },

  async saveVotes() {
    if (this.data.saving) return;

    const ballots = (this.data.groups || [])
      .filter((g) => !!g.selectedRoleSlotId)
      .map((g) => ({
        voting_group: g.voting_group,
        role_slot_id: g.selectedRoleSlotId
      }));

    if (!ballots.length) {
      wx.showToast({ title: 'Pick at least one candidate', icon: 'none' });
      return;
    }

    this.setData({ saving: true });
    try {
      await api.submitVotes(this.data.meetingId, ballots);
      this.setData({ hasVoted: true });
      wx.showToast({ title: 'Votes saved', icon: 'success' });
    } catch (e) {
      wx.showToast({ title: (e && e.error) || 'Save failed', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  },

  goResult() {
    const meetingId = this.data.meetingId;
    if (!meetingId) return;
    wx.navigateTo({ url: '/pages/vote-result/vote-result?id=' + meetingId });
  }
});
