import { afterEach, describe, expect, it, vi } from 'vitest';
import { authApi } from './api.js';

afterEach(() => { vi.unstubAllGlobals(); });

describe('email authentication API', () => {
  it.each([
    ['register', '/api/auth/email/register'],
    ['login', '/api/auth/email/login'],
    ['linkEmail', '/api/auth/email/link']
  ])('sends %s to the email provider using the HttpOnly session', async (method, path) => {
    const response = { user: { id: 1, email: 'guest@example.test', role: 'guest' } };
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => response
    });
    vi.stubGlobal('fetch', fetch);
    const payload = { email: 'guest@example.test', password: 'a long test password' };

    expect(await authApi[method](payload)).toEqual(response);
    expect(fetch).toHaveBeenCalledWith(path, {
      method: 'POST',
      credentials: 'same-origin',
      signal: undefined,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
  });

  it('surfaces a denied request with the server status and message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ error: 'Guest access is read-only' })
    }));
    await expect(authApi.me()).rejects.toMatchObject({ status: 403, message: 'Guest access is read-only' });
  });
});
