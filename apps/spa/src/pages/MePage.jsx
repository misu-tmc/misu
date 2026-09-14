import { useEffect, useMemo, useState } from 'preact/hooks';
import { Link } from 'wouter-preact';
import { authApi, meetingsApi, usersApi } from '../lib/api.js';
import { shortDate } from '../lib/format.js';
import { authUser } from '../state/auth.js';
import { PageLoading } from '../components/PageState.jsx';
import { LinkEmailForm } from '../components/EmailCredentials.jsx';
import { canEdit, GUEST_NOTICE } from '../lib/permissions.js';

export function MePage() {
  const [meetings, setMeetings] = useState([]);
  const [name, setName] = useState(authUser.value?.display_name || '');
  const [club, setClub] = useState(authUser.value?.club_name || '');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    meetingsApi.upcoming().then(setMeetings).catch((err) => setMessage(err.message || 'Could not load bookings.')).finally(() => setLoading(false));
  }, []);

  const bookings = useMemo(() => meetings.flatMap((meeting) =>
    (meeting.role_slots || [])
      .filter((slot) => slot.taker_id === authUser.value?.id)
      .map((slot) => ({ meeting, slot }))
  ), [meetings, authUser.value?.id]);

  async function saveProfile(event) {
    event.preventDefault();
    if (!canEdit(authUser.value)) {
      setMessage(GUEST_NOTICE);
      return;
    }
    const nextName = name.trim();
    if (!nextName) return;
    const nextClub = club.trim();
    setSaving(true);
    setMessage('');
    try {
      const user = await usersApi.update(authUser.value.id, { display_name: nextName, club_name: nextClub });
      authUser.value = user;
      setName(user.display_name);
      setClub(user.club_name || '');
      setMessage('Profile saved.');
    } catch (err) {
      setMessage(err.message || 'Could not save profile.');
    } finally {
      setSaving(false);
    }
  }

  async function signOut() {
    setSigningOut(true);
    setMessage('');
    try {
      await authApi.logout();
      authUser.value = null;
      window.location.assign('/login');
    } catch (err) {
      setMessage(err.message || 'Could not sign out.');
      setSigningOut(false);
    }
  }

  if (loading) return <PageLoading label="Loading profile…" />;

  return (
    <div class="profile-layout">
      <section class="card profile-card">
        <div class="profile-header">
          <div class="avatar">{(authUser.value?.display_name || '?').slice(0, 1).toUpperCase()}</div>
          <div class="profile-identity"><h1>{authUser.value?.display_name || 'MISU member'}</h1><p class="account-email">{authUser.value?.email || 'Existing account without email'}</p><p>{canEdit(authUser.value) ? 'Editor' : 'Guest (read-only)'}</p></div>
        </div>
        <form onSubmit={saveProfile}>
          <div class="field"><label for="profile-name">Display name</label><input id="profile-name" value={name} maxlength="255" readOnly={!canEdit(authUser.value)} onInput={(event) => setName(event.currentTarget.value)} required /></div>
          <div class="field"><label for="profile-club">Club (optional)</label><input id="profile-club" value={club} autocomplete="organization" readOnly={!canEdit(authUser.value)} onInput={(event) => setClub(event.currentTarget.value)} /></div>
          {canEdit(authUser.value) && <button class="btn btn-primary" disabled={saving}>Save profile</button>}
        </form>
        {message && <p class="form-message" role="status">{message}</p>}
      </section>

      <section class="card">
        <h2>Your bookings</h2>
        {bookings.length === 0 ? <p>No upcoming roles yet.</p> : bookings.map(({ meeting, slot }) => (
          <div class="slot-row" key={`${meeting.id}-${slot.id}`}>
            <span class="role-label">#{meeting.number} · {shortDate(meeting.date)}</span>
            <strong>{slot.label || slot.role_name}</strong>
          </div>
        ))}
        <Link class="btn btn-ghost btn-sm" href="/app/booking">{canEdit(authUser.value) ? 'Manage bookings' : 'View bookings'}</Link>
      </section>

      <section class="card">
        {authUser.value?.email
          ? <><h2>Email sign-in</h2><p>Use <span class="account-email">{authUser.value.email}</span> and your password to sign in on any device.</p></>
          : <LinkEmailForm />}
      </section>

      <section class="card signout-card">
        <div><h2>Session</h2><p>Sign out of MISU on this browser.</p></div>
        <button class="btn btn-ghost signout-button" type="button" disabled={signingOut} onClick={signOut}>{signingOut ? 'Signing out…' : 'Sign out'}</button>
      </section>
    </div>
  );
}