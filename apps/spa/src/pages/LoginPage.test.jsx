import { describe, expect, it } from 'vitest';
import { safeNextPath } from './LoginPage.jsx';

describe('safeNextPath', () => {
  it('keeps a local return path', () => {
    expect(safeNextPath('?next=%2Fapp%2Fmeeting')).toBe('/app/meeting');
  });

  it('rejects protocol-relative redirects', () => {
    expect(safeNextPath('?next=%2F%2Fevil.example')).toBe('/app/booking');
  });

  it('defaults to booking', () => {
    expect(safeNextPath('')).toBe('/app/booking');
  });
});