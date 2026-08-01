import { useEffect, useState } from 'preact/hooks';
import { Link } from 'wouter-preact';
import { meetingsApi } from '../lib/api.js';
import { PageError, PageLoading } from '../components/PageState.jsx';

export function MeetingsPage() {
  const [scope, setScope] = useState('open');
  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load(nextScope = scope) {
    setLoading(true);
    setError('');
    try {
      setMeetings(await meetingsApi.list(nextScope));
    } catch (err) {
      setError(err.message || 'Could not load meetings.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(scope); }, [scope]);

  return (
    <>
      <div class="page-heading">
        <div><p class="eyebrow">Management</p><h1>Meetings</h1></div>
        <Link class="btn btn-primary" href="/app/meetings/new">+ New meeting</Link>
      </div>
      <div class="segmented" role="tablist" aria-label="Meeting scope">
        {['open', 'archived', 'all'].map((value) => (
          <button class={scope === value ? 'active' : ''} type="button" role="tab" aria-selected={scope === value} onClick={() => setScope(value)}>{value}</button>
        ))}
      </div>
      {loading ? <PageLoading label="Loading meetings…" /> : error ? <PageError message={error} onRetry={() => load()} /> : (
        meetings.length === 0 ? <div class="page-empty"><p>No meetings here yet.</p></div> : (
          <div class="card table-wrapper">
            <table class="meeting-table">
              <thead><tr><th>#</th><th>Meeting</th><th>Date</th><th>Time</th><th>Venue</th><th>Status</th><th /></tr></thead>
              <tbody>
                {meetings.map((meeting) => (
                  <tr key={meeting.id}>
                    <td><strong>{meeting.number}</strong></td>
                    <td><strong>{meeting.title}</strong>{meeting.theme && <small>{meeting.theme}</small>}</td>
                    <td>{meeting.date}</td>
                    <td>{meeting.start_time}–{meeting.end_time}</td>
                    <td>{meeting.venue || '—'}</td>
                    <td><span class={`pill pill-${meeting.status}`}>{meeting.status}</span></td>
                    <td class="row-actions"><Link class="btn btn-ghost btn-sm" href={`/app/meetings/${meeting.id}/edit`}>Edit</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </>
  );
}