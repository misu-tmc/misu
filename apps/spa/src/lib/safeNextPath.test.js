import { describe, expect, it } from 'vitest';
import { loginRedirectUrl, resolveNextPath } from './safeNextPath.js';

describe('resolveNextPath', () => {
  it('defaults to booking with no explicit next when the query is empty', () => {
    expect(resolveNextPath('')).toEqual({ path: '/app/booking', hasExplicitNext: false });
  });

  it('defaults to booking with no explicit next when next is missing', () => {
    expect(resolveNextPath('?other=1')).toEqual({ path: '/app/booking', hasExplicitNext: false });
  });

  it('keeps a local absolute path', () => {
    expect(resolveNextPath('?next=%2Fapp%2Fmeeting')).toEqual({ path: '/app/meeting', hasExplicitNext: true });
  });

  it('preserves a query string on the requested path', () => {
    expect(resolveNextPath('?next=%2Fapp%2Fmeeting%3Fid%3D5')).toEqual({
      path: '/app/meeting?id=5',
      hasExplicitNext: true
    });
  });

  it('preserves a hash on the requested path', () => {
    expect(resolveNextPath('?next=%2Fapp%2Fmeeting%23agenda')).toEqual({
      path: '/app/meeting#agenda',
      hasExplicitNext: true
    });
  });

  it('preserves both query and hash together', () => {
    expect(resolveNextPath('?next=%2Fapp%2Fmeeting%3Fid%3D5%23agenda')).toEqual({
      path: '/app/meeting?id=5#agenda',
      hasExplicitNext: true
    });
  });

  it('rejects a protocol-relative redirect (literal //)', () => {
    expect(resolveNextPath('?next=%2F%2Fevil.example')).toEqual({ path: '/app/booking', hasExplicitNext: false });
  });

  it('rejects a value that is not local absolute', () => {
    expect(resolveNextPath('?next=evil.example')).toEqual({ path: '/app/booking', hasExplicitNext: false });
    expect(resolveNextPath('?next=https%3A%2F%2Fevil.example')).toEqual({ path: '/app/booking', hasExplicitNext: false });
  });

  it('rejects backslash tricks that resolve off-origin', () => {
    expect(resolveNextPath('?next=%2F%5Cevil.example')).toEqual({ path: '/app/booking', hasExplicitNext: false });
  });

  it('rejects control characters that normalize into an off-origin authority', () => {
    expect(resolveNextPath('?next=%2F%09%2Fevil.example')).toEqual({ path: '/app/booking', hasExplicitNext: false });
  });

  it('rejects a dot-segment bypass that normalizes to a // pathname', () => {
    expect(resolveNextPath('?next=%2F.%2F%2Fevil.example')).toEqual({ path: '/app/booking', hasExplicitNext: false });
  });

  it('accepts dot segments that collapse to a safe single-slash path', () => {
    expect(resolveNextPath('?next=%2Fa%2F..%2F..%2Fapp%2Fmeeting')).toEqual({
      path: '/app/meeting',
      hasExplicitNext: true
    });
  });

  it('rejects a next value that loops back to the prod login route', () => {
    expect(resolveNextPath('?next=%2Flogin')).toEqual({ path: '/app/booking', hasExplicitNext: false });
  });

  it('rejects a next value that loops back to the dev login route', () => {
    expect(resolveNextPath('?next=%2Fapp%2Flogin')).toEqual({ path: '/app/booking', hasExplicitNext: false });
  });

  it('rejects the login route even with a query string or hash attached', () => {
    expect(resolveNextPath('?next=%2Flogin%3Fnext%3D%2Fapp%2Fbooking')).toEqual({
      path: '/app/booking',
      hasExplicitNext: false
    });
    expect(resolveNextPath('?next=%2Fapp%2Flogin%23section')).toEqual({
      path: '/app/booking',
      hasExplicitNext: false
    });
  });

  it('rejects a trailing-slash variant of the prod login route', () => {
    expect(resolveNextPath('?next=%2Flogin%2F')).toEqual({ path: '/app/booking', hasExplicitNext: false });
  });

  it('rejects an uppercase variant of the prod login route', () => {
    expect(resolveNextPath('?next=%2FLOGIN')).toEqual({ path: '/app/booking', hasExplicitNext: false });
  });

  it('rejects a mixed-case trailing-slash variant of the prod login route', () => {
    expect(resolveNextPath('?next=%2FLogin%2F')).toEqual({ path: '/app/booking', hasExplicitNext: false });
  });

  it('rejects a trailing-slash variant of the dev login route', () => {
    expect(resolveNextPath('?next=%2Fapp%2Flogin%2F')).toEqual({ path: '/app/booking', hasExplicitNext: false });
  });

  it('rejects an uppercase variant of the dev login route', () => {
    expect(resolveNextPath('?next=%2Fapp%2FLogin')).toEqual({ path: '/app/booking', hasExplicitNext: false });
  });

  it('does not reject unrelated paths that merely start with the login segment', () => {
    expect(resolveNextPath('?next=%2Flogin%2Fhelp')).toEqual({ path: '/login/help', hasExplicitNext: true });
    expect(resolveNextPath('?next=%2Fapp%2Flogin-help')).toEqual({ path: '/app/login-help', hasExplicitNext: true });
  });
});

describe('loginRedirectUrl', () => {
  it('builds the prod login url with pathname and full search', () => {
    expect(loginRedirectUrl('/app/meeting', '?id=5', false)).toBe(
      `/login?next=${encodeURIComponent('/app/meeting?id=5')}`
    );
  });

  it('builds the dev login url with pathname and full search', () => {
    expect(loginRedirectUrl('/app/meeting', '?id=5&tab=agenda', true)).toBe(
      `/app/login?next=${encodeURIComponent('/app/meeting?id=5&tab=agenda')}`
    );
  });

  it('omits the search entirely when there is none', () => {
    expect(loginRedirectUrl('/app/booking', '', true)).toBe(
      `/app/login?next=${encodeURIComponent('/app/booking')}`
    );
  });
});
