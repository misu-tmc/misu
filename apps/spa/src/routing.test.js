import { describe, expect, it } from 'vitest';
import { parse } from 'regexparam';

describe('protected route pattern', () => {
  it('matches nested management URLs', () => {
    const { pattern } = parse('/app/*');
    expect(pattern.test('/app/meetings/42/edit')).toBe(true);
    expect(pattern.test('/app/vote-result/42')).toBe(true);
  });
});