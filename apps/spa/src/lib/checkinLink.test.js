import { describe, expect, it } from 'vitest';
import { optionalMeetingId } from './checkinLink.js';

describe('optionalMeetingId', () => {
  it('returns null when the query has no meetingId', () => {
    expect(optionalMeetingId('')).toBeNull();
    expect(optionalMeetingId('?other=1')).toBeNull();
  });

  it('returns the parsed number for a decimal positive safe integer', () => {
    expect(optionalMeetingId('?meetingId=42')).toBe(42);
    expect(optionalMeetingId('?meetingId=1')).toBe(1);
  });

  it.each([
    ['0', 'zero'],
    ['-5', 'negative'],
    ['3.5', 'a fraction'],
    ['nope', 'non-numeric text'],
    ['9007199254740993', 'an unsafe-integer overflow'],
    ['1e3', 'exponential notation'],
    ['', 'an empty value'],
    ['  5', 'leading whitespace'],
    ['5  ', 'trailing whitespace']
  ])('throws the exact invalid-link message for %s (%s)', (raw) => {
    expect(() => optionalMeetingId(`?meetingId=${encodeURIComponent(raw)}`)).toThrow(
      'This check-in link is invalid.'
    );
  });
});
