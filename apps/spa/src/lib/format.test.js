import { describe, expect, it } from 'vitest';
import { prepTarget, shortDate } from './format.js';

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
});