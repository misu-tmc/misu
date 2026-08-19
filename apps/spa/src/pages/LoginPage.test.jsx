import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { me, register } = vi.hoisted(() => ({
  me: vi.fn(),
  register: vi.fn()
}));

vi.mock('../lib/api.js', () => ({
  authApi: {
    me,
    register,
    challenge: vi.fn(),
    verify: vi.fn(),
    migrate: vi.fn(),
    migrationCode: vi.fn()
  },
  ApiError: class ApiError extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
      this.name = 'ApiError';
    }
  }
}));

const { generateCredential } = vi.hoisted(() => ({
  generateCredential: vi.fn()
}));

vi.mock('../lib/authDevice.js', () => ({
  clearCredential: vi.fn(),
  credentialSupportIssue: vi.fn(() => null),
  generateCredential,
  signChallenge: vi.fn(),
  storedCredential: vi.fn(),
  trySilentLogin: vi.fn(() => Promise.resolve(null))
}));

vi.mock('../state/auth.js', () => ({
  authUser: { value: null },
  authReady: { value: false }
}));

import { ApiError } from '../lib/api.js';
import { LoginPage, safeNextPath } from './LoginPage.jsx';

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

describe('LoginPage generic account creation', () => {
  beforeEach(() => {
    me.mockReset()
      .mockRejectedValueOnce(new ApiError(401, 'unauthenticated'))
      .mockResolvedValue({ user: { id: 1, display_name: 'Guest', club_name: 'Other TMC' } });
    register.mockReset().mockResolvedValue({ ok: true });
    generateCredential.mockReset().mockResolvedValue({
      local: {},
      request: { credential_id: 'credential', public_key: 'public-key', device_name: 'Phone' }
    });
    window.history.pushState({}, '', '/login');
  });

  it('sends a trimmed club name with the generic registration payload', async () => {
    render(<LoginPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Create an account' }));
    fireEvent.input(await screen.findByLabelText('Your display name'), { target: { value: 'Guest' } });
    fireEvent.input(screen.getByLabelText('Club (optional)'), { target: { value: '  Other TMC  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(register).toHaveBeenCalledWith({
      display_name: 'Guest',
      club_name: 'Other TMC',
      credential_id: 'credential',
      public_key: 'public-key',
      device_name: 'Phone'
    }));
  });

  it('always sends club_name even when left blank', async () => {
    render(<LoginPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Create an account' }));
    fireEvent.input(await screen.findByLabelText('Your display name'), { target: { value: 'Guest' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(register).toHaveBeenCalledWith({
      display_name: 'Guest',
      club_name: '',
      credential_id: 'credential',
      public_key: 'public-key',
      device_name: 'Phone'
    }));
  });
});