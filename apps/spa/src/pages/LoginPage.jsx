import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { authApi, ApiError } from '../lib/api.js';
import { credentialSupportIssue, trySilentLogin } from '../lib/authDevice.js';
import { canEdit, GUEST_NOTICE } from '../lib/permissions.js';
import { EmailCredentials, emailPayload, LinkEmailForm } from '../components/EmailCredentials.jsx';
import { authReady, authUser } from '../state/auth.js';

export function safeNextPath(search) {
  const value = new URLSearchParams(search).get('next');
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u001f]/.test(value)) return '/app/booking';
  return value;
}

export function LoginPage() {
  const [view, setView] = useState('loading');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [user, setUser] = useState(null);
  const emailRef = useRef(null);
  const focusRequested = useRef(null);

  useLayoutEffect(() => {
    if (focusRequested.current === view) {
      emailRef.current?.focus();
      focusRequested.current = null;
    }
  }, [view]);

  useEffect(() => {
    let active = true;
    authApi.me().then((response) => {
      if (active) finish(response.user);
    }).catch((err) => {
      if (!active) return;
      if (!(err instanceof ApiError) || err.status !== 401) setError(err.message || 'MISU is temporarily unavailable.');
      setView('login');
    });
    return () => { active = false; };
  }, []);

  function finish(nextUser) {
    authUser.value = nextUser;
    authReady.value = true;
    setUser(nextUser);
    setError('');
    setView('account');
  }

  async function submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = emailPayload(form);
    if (view === 'register') {
      const data = new FormData(form);
      payload.display_name = String(data.get('display_name') || '').trim();
      payload.club_name = String(data.get('club_name') || '').trim();
    }
    setBusy(true);
    setError('');
    try {
      if (view === 'register') await authApi.register(payload);
      else await authApi.login(payload);
      // Confirm the HttpOnly cookie is usable before offering authenticated navigation.
      const response = await authApi.me();
      finish(response.user);
    } catch (err) {
      setError(err.message || 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  }

  async function recoverDeviceAccount() {
    setBusy(true);
    setError('');
    try {
      const issue = credentialSupportIssue();
      if (issue) throw new Error(issue);
      const recovered = await trySilentLogin();
      if (!recovered) throw new Error('No existing account was found on this browser. Sign in with email, or use a browser where your old account is connected.');
      finish(recovered);
    } catch (err) {
      setError(err.message || 'Could not recover your existing account.');
    } finally {
      setBusy(false);
    }
  }

  function changeView(next) {
    focusRequested.current = next;
    setError('');
    setView(next);
  }

  return (
    <main class="login-page">
      <div class="login-wrap">
        <div class="login-brand"><span class="login-mark">M</span><strong>MISU</strong></div>
        <section class="card login-card">
          {view === 'loading' && <div class="page-loading"><span class="spinner" /><span>Checking your account…</span></div>}
          {(view === 'login' || view === 'register') && (
            <>
              <div class="eyebrow">Email access</div>
              <h1>{view === 'register' ? 'Create your account' : 'Welcome to MISU'}</h1>
              <p>{view === 'register' ? 'New accounts start as guests with read-only access.' : 'Sign in with your email and password.'}</p>
              <form onSubmit={submit} key={view}>
                <EmailCredentials newPassword={view === 'register'} emailRef={emailRef} />
                {view === 'register' && (
                  <>
                    <div class="field"><label for="display-name">Your display name</label><input id="display-name" name="display_name" autocomplete="nickname" maxlength="255" required /></div>
                    <div class="field"><label for="club-name">Club (optional)</label><input id="club-name" name="club_name" autocomplete="organization" maxlength="255" /></div>
                  </>
                )}
                <button class="btn btn-primary btn-wide" disabled={busy}>{busy ? 'Please wait…' : view === 'register' ? 'Create account' : 'Sign in'}</button>
              </form>
              <button class="btn btn-ghost btn-wide" type="button" disabled={busy} onClick={() => changeView(view === 'login' ? 'register' : 'login')}>
                {view === 'login' ? 'Create an account' : 'Back to sign in'}
              </button>
              {view === 'login' && (
                <details>
                  <summary>Already have a device-based account?</summary>
                  <p>Recover it on a previously connected browser, then add your email. Your records and access will stay with the same account.</p>
                  <button class="btn btn-secondary" type="button" disabled={busy} onClick={recoverDeviceAccount}>Use existing device account</button>
                </details>
              )}
            </>
          )}
          {view === 'account' && (
            <>
              <h1>Welcome, {user.display_name}</h1>
              <p class="account-email">{user.email || 'Existing device account'}</p>
              {!canEdit(user) && <p class="notice">{GUEST_NOTICE}</p>}
              {!user.email && <LinkEmailForm onLinked={finish} />}
              <a class="btn btn-primary btn-wide" href={safeNextPath(window.location.search)}>Continue to MISU</a>
            </>
          )}
          {error && <p class="error-msg" role="alert">{error}</p>}
        </section>
      </div>
    </main>
  );
}
