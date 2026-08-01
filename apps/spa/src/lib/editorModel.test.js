import { describe, expect, it } from 'vitest';
import { buildSessionsPayload, buildUpsertPayload, cloneAsTemplate, splitMeeting } from './editorModel.js';

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
  it('maps role slot IDs to positional indexes only for whole-document upserts', () => {
    expect(buildUpsertPayload(meeting).sessions[0].role_slot_index).toBe(1);
  });

  it('keeps direct role slot IDs for section session saves', () => {
    expect(buildSessionsPayload(meeting.sessions)[0].role_slot_id).toBe(101);
  });

  it('clears identities and advances date when cloning a meeting', () => {
    const cloned = cloneAsTemplate(meeting);
    expect(cloned.id).toBeNull();
    expect(cloned.number).toBe(11);
    expect(cloned.date).toBe('2026-08-15');
    expect(cloned.role_slots[0].id).toBeNull();
    expect(buildUpsertPayload(cloned).sessions[0].role_slot_index).toBe(1);
  });

  it('separates non-bookable table-topic slots from editable roles', () => {
    const result = splitMeeting({ ...meeting, role_slots: [...meeting.role_slots, { id: 102, role_name: 'Table Topics Speaker', label: 'Alice', is_bookable: false, taker_id: 3, taker_name: 'Alice' }] }, [{ id: 3, display_name: 'Alice' }]);
    expect(result.meeting.role_slots).toHaveLength(2);
    expect(result.tableTopics).toEqual([{ role_slot_id: 102, user_id: 3, name: 'Alice' }]);
  });
});