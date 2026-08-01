import { describe, expect, it } from 'vitest';
import { buildAgenda, computedEndTime, prepTarget, shortDate } from './format.js';

describe('format helpers', () => {
  it('routes prepared speakers to speech preparation', () => {
    expect(prepTarget('Prepared Speech')).toEqual({ tab: 'speeches', field: '' });
  });

  it('routes grammarian preparation to keyword', () => {
    expect(prepTarget('Grammarian')).toEqual({ tab: 'info', field: 'keyword' });
  });

  it('formats a local calendar date without timezone drift', () => {
    expect(shortDate('2026-08-01')).toMatch(/Aug 1/);
  });

  it('computes agenda starts with a one-minute inter-session buffer', () => {
    const rows = buildAgenda({
      start_time: '19:00',
      role_slots: [],
      sessions: [
        { id: 1, position: 0, name: 'Opening', duration_minutes: 5 },
        { id: 2, position: 1, name: 'Speech', duration_minutes: 7 }
      ]
    });
    expect(rows.map((row) => row.start)).toEqual(['19:00', '19:06']);
    expect(computedEndTime('19:00', rows)).toBe('19:13');
  });

  it('drops sessions for untaken optional roles', () => {
    const rows = buildAgenda({
      start_time: '19:00',
      role_slots: [{ id: 5, is_optional: true, taker_id: null }],
      sessions: [{ id: 1, position: 0, name: 'Optional', duration_minutes: 5, role_slot_id: 5 }]
    });
    expect(rows).toEqual([]);
  });
});