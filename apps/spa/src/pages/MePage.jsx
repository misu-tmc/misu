import { useEffect, useMemo, useState } from 'preact/hooks';
import { Link } from 'wouter-preact';
import { authApi, meetingsApi, usersApi } from '../lib/api.js';
import { shortDate } from '../lib/format.js';
import { authUser } from '../state/auth.js';
import { PageLoading } from '../components/PageState.jsx';

export function MePage() {
  const [meetings, setMeetings] = useState([]);
  const [name, setName] = useState(authUser.value?.display_name || '');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [code, setCode] = useState('');

  useEffect(() => {
    meetingsApi.upcoming().then(setMeetings).catch(() => setMeetings([])).finally(() => setLoading(false));
  }, []);

  const bookings = useMemo(() => meetings.flatMap((meeting) =>
    (meeting.role_slots || [])
      .filter((slot) => slot.taker_id === authUser.value?.id)
      .map((slot) => ({ meeting, slot }))
  ), [meetings, authUser.value?.id]);

  async function saveProfile(event) {
    event.preventDefault();
    const nextName = name.trim();
    if (!nextName) return;
    setSaving(true);
    setMessage('');
    try {
      const user = await usersApi.update(authUser.value.id, nextName);
      authUser.value = user;
      setMessage('Profile saved.');
    } catch (err) {
      setMessage(err.message || 'Could not save profile.');
    } finally {
      setSaving(false);
    }
  }

  async function generateCode() {
    setSaving(true);
    setMessage('');
    try {
      const response = await authApi.migrationCode();
      setCode(response.code);
    } catch (err) {
      setMessage(err.message || 'Could not generate a code.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <PageLoading label="Loading profile…" />;

  return (
    <div class="profile-layout">
      <section class="card profile-card">
        <div class="profile-header">
          <div class="avatar">{(authUser.value?.display_name || '?').slice(0, 1).toUpperCase()}</div>
          <div><h1>{authUser.value?.display_name || 'MISU member'}</h1><p>Account #{authUser.value?.id}</p></div>
        </div>
        <form onSubmit={saveProfile}>
          <div class="field"><label for="profile-name">Display name</label><input id="profile-name" value={name} maxlength="255" onInput={(event) => setName(event.currentTarget.value)} required /></div>
          <button class="btn btn-primary" disabled={saving}>Save profile</button>
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
        <Link class="btn btn-ghost btn-sm" href="/app/booking">Manage bookings</Link>
      </section>

      <section class="card">
        <h2>Connect another device</h2>
        <p>Generate a single-use code valid for ten minutes.</p>
        <button class="btn btn-secondary" type="button" disabled={saving} onClick={generateCode}>Generate migration code</button>
        {code && <><div class="code-display">{code}</div><button class="btn btn-ghost btn-sm" type="button" onClick={() => navigator.clipboard?.writeText(code)}>Copy code</button></>}
      </section>
    </div>
  );
}