import { useEffect, useState } from 'preact/hooks';
import { usersApi } from '../lib/api.js';
import { PageError, PageLoading } from '../components/PageState.jsx';

export function UsersPage() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try { setUsers(await usersApi.list()); }
    catch (err) { setError(err.message || 'Could not load users.'); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function createUser(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const name = String(new FormData(form).get('display_name') || '').trim();
    if (!name) return;
    setCreating(true);
    setError('');
    try {
      const user = await usersApi.create(name);
      setUsers((current) => [...current, user]);
      form.reset();
    } catch (err) {
      setError(err.message || 'Could not create user.');
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <div class="page-heading"><div><p class="eyebrow">Management</p><h1>Users</h1></div></div>
      <section class="card create-user-card">
        <form onSubmit={createUser}>
          <div class="field"><label for="new-user-name">New display name</label><input id="new-user-name" name="display_name" maxlength="255" required /></div>
          <button class="btn btn-primary" disabled={creating}>{creating ? 'Creating…' : 'Create user'}</button>
        </form>
        <p>Creates an identity-less record that can be assigned to meeting roles.</p>
      </section>
      {error && <p class="error-msg" role="alert">{error}</p>}
      {loading ? <PageLoading label="Loading users…" /> : error && users.length === 0 ? <PageError message={error} onRetry={load} /> : (
        <section class="card table-wrapper">
          <table><thead><tr><th>ID</th><th>Display name</th></tr></thead><tbody>
            {users.map((user) => <tr key={user.id}><td>{user.id}</td><td>{user.display_name || '—'}</td></tr>)}
          </tbody></table>
        </section>
      )}
    </>
  );
}