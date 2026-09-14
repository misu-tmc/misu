import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authApi, ApiError } from '../lib/api.js';
import { authReady, authUser } from '../state/auth.js';
import { LoginPage, safeNextPath } from './LoginPage.jsx';
import { credentialSupportIssue, trySilentLogin } from '../lib/authDevice.js';

vi.mock('../lib/authDevice.js', () => ({
  credentialSupportIssue: vi.fn(() => null),
  trySilentLogin: vi.fn()
}));

const guest = { id: 1, email: 'guest@example.test', display_name: 'Guest', club_name: null, role: 'guest' };

function fillCredentials(email = 'guest@example.test', password = 'a long test password') {
  fireEvent.input(screen.getByLabelText('Email'), { target: { value: email } });
  fireEvent.input(screen.getByLabelText('Password'), { target: { value: password } });
}

describe('safeNextPath', () => {
  it('keeps a local return path', () => {
    expect(safeNextPath('?next=%2Fapp%2Fmeeting')).toBe('/app/meeting');
    expect(safeNextPath('?next=%2Fapp%2Fcheckin%3FmeetingId%3D42')).toBe('/app/checkin?meetingId=42');
  });

  it.each(['//evil.example', '/\\evil.example', '/\nevil.example', 'https://evil.example'])('rejects unsafe redirects: %s', (path) => {
    expect(safeNextPath(`?next=${encodeURIComponent(path)}`)).toBe('/app/booking');
  });

  it('defaults to booking', () => {
    expect(safeNextPath('')).toBe('/app/booking');
  });
});

describe('email authentication', () => {
  beforeEach(() => {
    authUser.value = null;
    authReady.value = false;
    vi.spyOn(authApi, 'me').mockRejectedValue(new ApiError(401, 'Unauthorized'));
    vi.spyOn(authApi, 'register').mockResolvedValue({ user: guest });
    vi.spyOn(authApi, 'login').mockResolvedValue({ user: guest });
    vi.spyOn(authApi, 'linkEmail').mockResolvedValue({ user: guest });
    trySilentLogin.mockReset().mockResolvedValue(null);
    credentialSupportIssue.mockReturnValue(null);
    window.history.replaceState({}, '', '/login?next=%2Fapp%2Fmeeting');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    authUser.value = null;
    authReady.value = false;
  });

  it('offers email sign-in without requiring browser keys or silently recovering them', async () => {
    credentialSupportIssue.mockReturnValue('Web Crypto unavailable');
    render(<LoginPage />);
    await screen.findByRole('button', { name: 'Sign in' });
    expect(screen.getByLabelText('Email').type).toBe('email');
    expect(screen.getByLabelText('Password').autocomplete).toBe('current-password');
    expect(trySilentLogin).not.toHaveBeenCalled();
  });

  it('focuses the first field after switching between sign-in and registration', async () => {
    render(<LoginPage />);
    const register = await screen.findByRole('button', { name: 'Create an account' });
    register.focus();
    fireEvent.click(register);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Email')));
    const signIn = screen.getByRole('button', { name: 'Back to sign in' });
    signIn.focus();
    fireEvent.click(signIn);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Email')));
  });

  it.each([11, 12, 128, 129])('counts %s Unicode password characters consistently with the server and mini program', async (length) => {
    render(<LoginPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Create an account' }));
    const password = screen.getByLabelText('Password');
    fireEvent.input(password, { target: { value: '\u{1f512}'.repeat(length) } });
    expect(password.getAttribute('maxlength')).toBeNull();
    expect(password.validity.valid).toBe(length >= 12 && length <= 128);
    expect(Array.from(password.value)).toHaveLength(length);
  });

  it('registers normalized email credentials and confirms the guest session', async () => {
    render(<LoginPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Create an account' }));
    fillCredentials('  Guest@Example.test  ', ' password with spaces ');
    fireEvent.input(screen.getByLabelText('Your display name'), { target: { value: '  Guest  ' } });
    fireEvent.input(screen.getByLabelText('Club (optional)'), { target: { value: '  Other TMC  ' } });
    authApi.me.mockResolvedValue({ user: guest });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(authApi.register).toHaveBeenCalledWith({
      email: 'guest@example.test',
      password: ' password with spaces ',
      display_name: 'Guest',
      club_name: 'Other TMC'
    }));
    expect(await screen.findByText(/Guest access is read-only/)).toBeTruthy();
    expect(authUser.value).toEqual(guest);
    expect(authReady.value).toBe(true);
    expect(screen.getByRole('link', { name: 'Continue to MISU' }).getAttribute('href')).toBe('/app/meeting');
  });

  it('logs into an existing email account and preserves the server role', async () => {
    const editor = { ...guest, role: 'editor' };
    render(<LoginPage />);
    await screen.findByRole('button', { name: 'Sign in' });
    fillCredentials();
    authApi.me.mockResolvedValue({ user: editor });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByRole('link', { name: 'Continue to MISU' });
    expect(authApi.login).toHaveBeenCalledWith({ email: guest.email, password: 'a long test password' });
    expect(authUser.value.role).toBe('editor');
    expect(authApi.register).not.toHaveBeenCalled();
  });

  it('surfaces rejected credentials without authenticating the browser', async () => {
    authApi.login.mockRejectedValue(new ApiError(401, 'Invalid email or password'));
    render(<LoginPage />);
    await screen.findByRole('button', { name: 'Sign in' });
    fillCredentials();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Invalid email or password');
    expect(authUser.value).toBeNull();
  });

  it('does not report success when the session cookie was not retained', async () => {
    render(<LoginPage />);
    await screen.findByRole('button', { name: 'Sign in' });
    fillCredentials();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByRole('alert');
    expect(authUser.value).toBeNull();
    expect(screen.queryByRole('link', { name: 'Continue to MISU' })).toBeNull();
  });

  it('recovers an existing device account only on request and attaches email to that account', async () => {
    const existing = { id: 7, display_name: 'Member', email: null, role: 'editor' };
    const linked = { ...existing, email: guest.email };
    trySilentLogin.mockResolvedValue(existing);
    authApi.linkEmail.mockResolvedValue({ user: linked });
    render(<LoginPage />);
    fireEvent.click(await screen.findByText('Already have a device-based account?'));
    fireEvent.click(screen.getByRole('button', { name: 'Use existing device account' }));
    await screen.findByRole('heading', { name: 'Connect your email' });
    fillCredentials();
    fireEvent.click(screen.getByRole('button', { name: 'Connect email' }));
    await waitFor(() => expect(authUser.value).toEqual(linked));
    expect(authApi.linkEmail).toHaveBeenCalledWith({ email: guest.email, password: 'a long test password' });
    expect(authApi.register).not.toHaveBeenCalled();
  });

  it('surfaces service errors rather than silently switching to device authentication', async () => {
    authApi.me.mockRejectedValue(new ApiError(503, 'Database unavailable'));
    render(<LoginPage />);
    expect((await screen.findByRole('alert')).textContent).toBe('Database unavailable');
    expect(trySilentLogin).not.toHaveBeenCalled();
  });
});
