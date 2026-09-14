import { useState } from 'preact/hooks';
import { authApi } from '../lib/api.js';
import { authUser } from '../state/auth.js';

export function EmailCredentials({ newPassword = false, emailRef }) {
  function validatePassword(event) {
    const input = event.currentTarget;
    const length = Array.from(input.value).length;
    input.setCustomValidity(length > 128 || (newPassword && length < 12)
      ? 'Use 12-128 characters for your password.'
      : '');
  }

  return (
    <>
      <div class="field">
        <label for="auth-email">Email</label>
        <input ref={emailRef} id="auth-email" name="email" type="email" autocomplete="username" autocapitalize="none" spellcheck={false} maxlength="254" required />
      </div>
      <div class="field">
        <label for="auth-password">Password</label>
        <input id="auth-password" name="password" type="password" autocomplete={newPassword ? 'new-password' : 'current-password'} onInput={validatePassword} required />
        {newPassword && <small>Use 12-128 characters. You can sign in with this password on any device.</small>}
      </div>
    </>
  );
}

export function emailPayload(form) {
  const data = new FormData(form);
  return {
    email: String(data.get('email') || '').trim().toLowerCase(),
    password: String(data.get('password') || '')
  };
}

export function LinkEmailForm({ onLinked }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function linkEmail(event) {
    event.preventDefault();
    const payload = emailPayload(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      const response = await authApi.linkEmail(payload);
      authUser.value = response.user;
      onLinked?.(response.user);
    } catch (err) {
      setError(err.message || 'Could not connect your email.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={linkEmail}>
      <h2>Connect your email</h2>
      <p>Keep your existing account and records. Add an email and password to sign in on any device.</p>
      <EmailCredentials newPassword />
      {error && <p class="error-msg" role="alert">{error}</p>}
      <button class="btn btn-primary" disabled={busy}>{busy ? 'Connecting...' : 'Connect email'}</button>
    </form>
  );
}
