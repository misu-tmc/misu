import { useEffect, useState } from 'preact/hooks';
import { useLocation } from 'wouter-preact';
import { authApi, ApiError } from '../lib/api.js';
import {
  clearCredential,
  credentialSupportIssue,
  generateCredential,
  signChallenge,
  storedCredential,
  trySilentLogin
} from '../lib/authDevice.js';
import { resolveNextPath } from '../lib/safeNextPath.js';
import { authReady, authUser } from '../state/auth.js';

export function LoginPage() {
  const [view, setView] = useState('loading');
  const [message, setMessage] = useState('This browser is not connected to an account yet.');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [user, setUser] = useState(null);
  const [migrationCode, setMigrationCode] = useState('');
  const [, navigate] = useLocation();

  useEffect(() => {
    let active = true;
    async function initialize() {
      try {
        const response = await authApi.me();
        if (!active) return;
        finish(response.user ?? response);
        return;
      } catch (err) {
        if (!(err instanceof ApiError) || err.status !== 401) {
          if (active) showChoice(err.message || 'MISU is temporarily unavailable.');
          return;
        }
      }

      const supportIssue = credentialSupportIssue();
      if (supportIssue) {
        if (active) {
          setMessage(supportIssue);
          setView('unsupported');
        }
        return;
      }

      const signedIn = await trySilentLogin().catch(() => null);
      if (!active) return;
      if (signedIn) finish(signedIn);
      else showChoice();
    }
    initialize();
    return () => { active = false; };
  }, []);

  function showChoice(nextMessage) {
    if (nextMessage) setMessage(nextMessage);
    setError('');
    setView('choice');
  }

  function finish(nextUser) {
    authUser.value = nextUser;
    authReady.value = true;
    setUser(nextUser);
    setError('');
    const { path, hasExplicitNext } = resolveNextPath(window.location.search);
    if (hasExplicitNext) {
      navigate(path, { replace: true });
      return;
    }
    setView('account');
  }

  async function confirmedSession() {
    try {
      const current = await authApi.me();
      return current.user ?? current;
    } catch (_) {
      throw new Error('Your device was connected, but Safari did not retain the session cookie. Reload after opening the site over HTTPS or enabling local HTTP cookies on the server.');
    }
  }

  async function createAccount(event) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const displayName = String(data.get('display_name') || '').trim();
    if (!displayName) return;
    const clubName = String(data.get('club_name') || '').trim();
    setBusy(true);
    setError('');
    let deviceRegistered = false;
    try {
      const generated = await generateCredential();
      await authApi.register({ display_name: displayName, club_name: clubName, ...generated.request });
      deviceRegistered = true;
      finish(await confirmedSession());
    } catch (err) {
      if (!deviceRegistered) await clearCredential().catch(() => {});
      setError(err.message || 'Account creation failed.');
    } finally {
      setBusy(false);
    }
  }

  async function migrateAccount(event) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const code = String(data.get('migration_code') || '').trim().toUpperCase();
    if (!code) return;
    setBusy(true);
    setError('');
    let deviceRegistered = false;
    try {
      const generated = await generateCredential();
      await authApi.migrate({ migration_code: code, ...generated.request });
      deviceRegistered = true;
      finish(await confirmedSession());
    } catch (err) {
      if (!deviceRegistered) await clearCredential().catch(() => {});
      setError(err.message || 'Migration failed. Check the code and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function createMigrationCode() {
    setBusy(true);
    setError('');
    try {
      const response = await authApi.migrationCode();
      setMigrationCode(response.code);
    } catch (err) {
      setError(err.message || 'Could not generate a migration code.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main class="login-page">
      <div class="login-wrap">
        <div class="login-brand"><span class="login-mark">M</span><strong>MISU</strong></div>

        {view === 'loading' && (
          <section class="card"><div class="page-loading"><span class="spinner" /><span>Checking this device…</span></div></section>
        )}

        {view === 'choice' && (
          <section class="card login-card">
            <div class="eyebrow">Device access</div>
            <h1>Welcome to MISU</h1>
            <p>{message}</p>
            <div class="login-stack">
              <button class="btn btn-primary btn-wide" type="button" onClick={() => { setError(''); setView('create'); }}>Create an account</button>
              <button class="btn btn-secondary btn-wide" type="button" onClick={() => { setError(''); setView('migrate'); }}>I have a migration code</button>
            </div>
            <div class="notice">Lost access on every device? Create a new account, then contact an administrator to reconnect your records.</div>
          </section>
        )}

        {view === 'unsupported' && (
          <section class="card login-card">
            <div class="eyebrow">HTTPS required</div>
            <h1>Secure connection needed</h1>
            <p>{message}</p>
            <div class="notice">
              Safari supports device sign-in, but only from HTTPS origins (or localhost on the same device). A phone opening this Mac by LAN IP must use a trusted HTTPS certificate.
            </div>
          </section>
        )}

        {view === 'create' && (
          <section class="card login-card">
            <div class="eyebrow">New account</div>
            <h2>Create your account</h2>
            <p>A private sign-in key will be kept only in this browser.</p>
            <form class="login-stack" onSubmit={createAccount}>
              <div class="field"><label for="display-name">Your display name</label><input id="display-name" name="display_name" maxlength="255" autocomplete="name" required /></div>
              <div class="field"><label for="club-name">Club (optional)</label><input id="club-name" name="club_name" autocomplete="organization" /></div>
              <button class="btn btn-primary btn-wide" disabled={busy}>Create account</button>
              <button class="btn btn-ghost btn-wide" type="button" onClick={() => showChoice()}>Back</button>
            </form>
            {error && <p class="error-msg" role="alert">{error}</p>}
          </section>
        )}

        {view === 'migrate' && (
          <section class="card login-card">
            <div class="eyebrow">Connect this device</div>
            <h2>Enter migration code</h2>
            <p>Generate this code from a device where you are already signed in.</p>
            <form class="login-stack" onSubmit={migrateAccount}>
              <div class="field"><label for="migration-code">Migration code</label><input id="migration-code" name="migration_code" class="code-input" autocomplete="one-time-code" placeholder="XXXX-XXXX-XXXX-XXXX" maxlength="19" required /></div>
              <button class="btn btn-primary btn-wide" disabled={busy}>Connect device</button>
              <button class="btn btn-ghost btn-wide" type="button" onClick={() => showChoice()}>Back</button>
            </form>
            {error && <p class="error-msg" role="alert">{error}</p>}
          </section>
        )}

        {view === 'account' && (
          <section class="card login-card">
            <div class="eyebrow success-msg">Device connected</div>
            <h1>Welcome, {user?.display_name || 'friend'}</h1>
            <p>This browser can securely sign in to your MISU account.</p>
            <div class="login-stack">
              <a class="btn btn-primary btn-wide" href={resolveNextPath(window.location.search).path}>Continue</a>
              <button class="btn btn-secondary btn-wide" type="button" disabled={busy} onClick={createMigrationCode}>Connect another device</button>
            </div>
            {migrationCode && (
              <div class="migration-result">
                <div class="code-display">{migrationCode}</div>
                <p>Enter this on the other device within 10 minutes. It works once.</p>
                <button class="btn btn-ghost btn-sm" type="button" onClick={() => navigator.clipboard?.writeText(migrationCode)}>Copy code</button>
              </div>
            )}
            {error && <p class="error-msg" role="alert">{error}</p>}
          </section>
        )}
      </div>
    </main>
  );
}