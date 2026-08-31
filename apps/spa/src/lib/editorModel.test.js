import { describe, expect, it } from 'vitest';
import { assignCatalogRole, assignRoleUser, assignTopicUser, buildSessionsPayload, buildUpsertPayload, cloneAsTemplate, emptyMeeting, reorderItem, splitMeeting } from './editorModel.js';

const meeting = {
  id: 9, number: 10, title: 'Meeting', theme: '', keyword: '', date: '2026-08-01',
  start_time: '19:00', end_time: '20:00', venue: 'Room A', status: 'draft',
  role_slots: [
    { id: 100, role_id: 1, role_name: 'Timer', label: 'Timer', custom_label: null, is_optional: false, is_bookable: true },
    { id: 101, role_id: 2, role_name: 'Speaker', label: 'Speaker 1', custom_label: 'Speaker 1', is_optional: false, is_bookable: true }
  ],
  sessions: [{ id: 1, position: 0, group_label: '', name: 'Speech', duration_minutes: 7, role_slot_id: 101 }]
};

describe('editor model', () => {
  it('uses an unnumbered title for a blank meeting', () => {
    expect(emptyMeeting(146).title).toBe('Regular Meeting');
  });

  it('maps role slot IDs to positional indexes only for whole-document upserts', () => {
    const payload = buildUpsertPayload(meeting);
    expect(payload.sessions[0].role_slot_index).toBe(1);
    expect(payload.end_time).toBe('20:00');
  });

  it('keeps direct role slot IDs for section session saves', () => {
    expect(buildSessionsPayload(meeting.sessions)[0].role_slot_id).toBe(101);
  });

  it('clears identities and advances date when cloning a meeting', () => {
    const cloned = cloneAsTemplate({ ...meeting, theme: 'Previous theme', keyword: 'Previous keyword' });
    expect(cloned.id).toBeNull();
    expect(cloned.number).toBe(11);
    expect(cloned.title).toBe('Meeting');
    expect(cloned.theme).toBe('');
    expect(cloned.keyword).toBe('');
    expect(cloned.date).toBe('2026-08-15');
    expect(cloned.role_slots[0].id).toBeNull();
    expect(buildUpsertPayload(cloned).sessions[0].role_slot_index).toBe(1);
  });

  it('separates non-bookable table-topic slots from editable roles', () => {
    const result = splitMeeting({ ...meeting, role_slots: [...meeting.role_slots, { id: 102, role_name: 'Table Topics Speaker', label: 'Alice', is_bookable: false, taker_id: 3, taker_name: 'Alice' }] }, [{ id: 3, display_name: 'Alice' }]);
    expect(result.meeting.role_slots).toHaveLength(2);
    expect(result.tableTopics).toEqual([{ role_slot_id: 102, user_id: 3, name: 'Alice' }]);
  });

  it('moves one row without changing the row objects', () => {
    const rows = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const reordered = reorderItem(rows, 0, 2);
    expect(reordered.map((row) => row.id)).toEqual([2, 3, 1]);
    expect(reordered[2]).toBe(rows[0]);
  });

  it('fills the same table-topic row with a newly created user', () => {
    const topics = [{ role_slot_id: 7, user_id: null, name: '' }, { role_slot_id: 8, user_id: 2, name: 'Existing' }];
    const assigned = assignTopicUser(topics, 0, { id: 9, display_name: 'New participant' });
    expect(assigned[0]).toEqual({ role_slot_id: 7, user_id: 9, name: 'New participant' });
    expect(assigned[1]).toBe(topics[1]);
  });

  it('assigns a newly created user to the same role slot', () => {
    const slots = [{ id: 1, taker_id: null, taker_name: '' }, { id: 2, taker_id: 3, taker_name: 'Existing' }];
    const assigned = assignRoleUser(slots, 0, { id: 9, display_name: 'New assignee' });
    expect(assigned[0]).toEqual({ id: 1, taker_id: 9, taker_name: 'New assignee' });
    expect(assigned[1]).toBe(slots[1]);
  });

  it('selects a newly created catalog role in the same role slot', () => {
    const slots = [{ id: 1, role_id: null, role_name: '', voting_group: '' }, { id: 2, role_id: 3, role_name: 'Timer', voting_group: 'Best role' }];
    const assigned = assignCatalogRole(slots, 0, { id: 9, name: 'Listener', voting_group: 'Best evaluator' });
    expect(assigned[0]).toEqual({ id: 1, role_id: 9, role_name: 'Listener', voting_group: 'Best evaluator' });
    expect(assigned[1]).toBe(slots[1]);
  });
});