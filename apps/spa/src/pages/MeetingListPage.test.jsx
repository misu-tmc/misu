import { describe, expect, it } from 'vitest';
import { isMeetingOngoing, sortMeetingsForDisplay } from './MeetingListPage.jsx';

const meetings = [
  { id: 3, date: '2026-08-03', start_time: '19:00', end_time: '21:00' },
  { id: 1, date: '2026-08-02', start_time: '09:00', end_time: '10:00' },
  { id: 2, date: '2026-08-02', start_time: '14:00', end_time: '16:00' }
];

describe('meeting card ordering', () => {
  it('recognizes a meeting within its scheduled interval', () => {
    expect(isMeetingOngoing(meetings[2], new Date('2026-08-02T15:00:00'))).toBe(true);
    expect(isMeetingOngoing(meetings[2], new Date('2026-08-02T16:30:00'))).toBe(false);
  });

  it('places the ongoing meeting first, then sorts by start time', () => {
    expect(sortMeetingsForDisplay(meetings, new Date('2026-08-02T15:00:00')).map((meeting) => meeting.id))
      .toEqual([2, 1, 3]);
  });
});
