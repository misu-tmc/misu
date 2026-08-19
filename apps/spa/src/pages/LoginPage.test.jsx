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

const { generateCredential, trySilentLogin } = vi.hoisted(() => ({
  generateCredential: vi.fn(),
  trySilentLogin: vi.fn(() => Promise.resolve(null))
}));

vi.mock('../lib/authDevice.js', () => ({
  clearCredential: vi.fn(),
  credentialSupportIssue: vi.fn(() => null),
  generateCredential,
  signChallenge: vi.fn(),
  storedCredential: vi.fn(),
  trySilentLogin
}));

vi.mock('../state/auth.js', () => ({
  authUser: { value: null },
  authReady: { value: false }
}));

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock('wouter-preact', () => ({
  useLocation: () => [window.location.pathname, navigate]
}));

import { ApiError } from '../lib/api.js';
import { LoginPage } from './LoginPage.jsx';

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
    trySilentLogin.mockReset().mockResolvedValue(null);
    navigate.mockReset();
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

async function createAccountVia(displayName = 'Guest') {
  fireEvent.click(await screen.findByRole('button', { name: 'Create an account' }));
  fireEvent.input(await screen.findByLabelText('Your display name'), { target: { value: displayName } });
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
  await waitFor(() => expect(register).toHaveBeenCalled());
}

describe('LoginPage safe redirect after finish', () => {
  beforeEach(() => {
    me.mockReset()
      .mockRejectedValueOnce(new ApiError(401, 'unauthenticated'))
      .mockResolvedValue({ user: { id: 1, display_name: 'Guest', club_name: '' } });
    register.mockReset().mockResolvedValue({ ok: true });
    generateCredential.mockReset().mockResolvedValue({
      local: {},
      request: { credential_id: 'credential', public_key: 'public-key', device_name: 'Phone' }
    });
    trySilentLogin.mockReset().mockResolvedValue(null);
    navigate.mockReset();
  });

  it('auto-returns to an explicit valid next after account creation', async () => {
    window.history.pushState({}, '', '/login?next=%2Fapp%2Fmeeting');
    render(<LoginPage />);

    await createAccountVia();

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/app/meeting', { replace: true }));
    expect(screen.queryByText(/Welcome,/)).toBeNull();
  });

  it('retains the account confirmation view when next is missing', async () => {
    window.history.pushState({}, '', '/login');
    render(<LoginPage />);

    await createAccountVia();

    expect(await screen.findByText(/Welcome,/)).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Continue' }).getAttribute('href')).toBe('/app/booking');
  });

  it('retains the account confirmation view and never navigates off-origin when next is invalid', async () => {
    window.history.pushState({}, '', '/login?next=%2F%2Fevil.example');
    render(<LoginPage />);

    await createAccountVia();

    expect(await screen.findByText(/Welcome,/)).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Continue' }).getAttribute('href')).toBe('/app/booking');
  });

  it('navigates via the shared finish path when an existing session cookie is present', async () => {
    window.history.pushState({}, '', '/login?next=%2Fapp%2Fmeeting');
    me.mockReset().mockResolvedValue({ user: { id: 1, display_name: 'Guest', club_name: '' } });

    render(<LoginPage />);

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/app/meeting', { replace: true }));
  });

  it('navigates via the shared finish path after a silent device login', async () => {
    window.history.pushState({}, '', '/login?next=%2Fapp%2Fmeeting');
    trySilentLogin.mockReset().mockResolvedValue({ id: 1, display_name: 'Guest', club_name: '' });

    render(<LoginPage />);

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/app/meeting', { replace: true }));
  });

  it('navigates via the shared finish path after a migration code redeems', async () => {
    const { migrate } = await import('../lib/api.js').then((m) => m.authApi);
    migrate.mockReset().mockResolvedValue({ ok: true });
    window.history.pushState({}, '', '/login?next=%2Fapp%2Fmeeting');

    render(<LoginPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'I have a migration code' }));
    fireEvent.input(await screen.findByLabelText('Migration code'), { target: { value: 'ABCD-EFGH-IJKL-MNOP' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect device' }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/app/meeting', { replace: true }));
  });

  it('shows the account view instead of looping when next points back to the prod login route', async () => {
    window.history.pushState({}, '', '/login?next=%2Flogin');
    render(<LoginPage />);

    await createAccountVia();

    expect(await screen.findByText(/Welcome,/)).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Continue' }).getAttribute('href')).toBe('/app/booking');
  });

  it('shows the account view instead of looping when next points back to the dev login route', async () => {
    window.history.pushState({}, '', '/login?next=%2Fapp%2Flogin');
    render(<LoginPage />);

    await createAccountVia();

    expect(await screen.findByText(/Welcome,/)).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Continue' }).getAttribute('href')).toBe('/app/booking');
  });

  it.each([
    ['%2Flogin%2F', 'trailing-slash prod login route'],
    ['%2FLOGIN', 'uppercase prod login route'],
    ['%2FLogin%2F', 'mixed-case trailing-slash prod login route'],
    ['%2Fapp%2Flogin%2F', 'trailing-slash dev login route'],
    ['%2Fapp%2FLogin', 'uppercase dev login route']
  ])('shows the account view instead of looping when next is a %s (%s)', async (encodedNext) => {
    window.history.pushState({}, '', `/login?next=${encodedNext}`);
    render(<LoginPage />);

    await createAccountVia();

    expect(await screen.findByText(/Welcome,/)).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Continue' }).getAttribute('href')).toBe('/app/booking');
  });
});