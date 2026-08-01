import { useEffect, useState } from 'preact/hooks';
import { Link } from 'wouter-preact';
import { meetingsApi, votingApi } from '../lib/api.js';
import { shortDate } from '../lib/format.js';
import { PageError, PageLoading } from '../components/PageState.jsx';

export function VotePage({ params }) {
  const meetingId = Number(params.meetingId);
  const [meeting, setMeeting] = useState(null);
  const [groups, setGroups] = useState([]);
  const [selections, setSelections] = useState({});
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [detail, state] = await Promise.all([meetingsApi.get(meetingId), votingApi.state(meetingId)]);
      setMeeting(detail);
      setGroups(state.groups || []);
      setSelections(state.selections || {});
      setSaved(Object.keys(state.selections || {}).length > 0);
    } catch (err) {
      setError(err.message || 'Could not load voting.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [meetingId]);

  async function submit() {
    const ballots = groups
      .filter((group) => selections[group.voting_group])
      .map((group) => ({ voting_group: group.voting_group, role_slot_id: selections[group.voting_group] }));
    if (!ballots.length) {
      setError('Pick at least one candidate.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await votingApi.submit(meetingId, ballots);
      setSaved(true);
    } catch (err) {
      setError(err.message || 'Could not save votes.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <PageLoading label="Loading ballot…" />;
  if (error && !meeting) return <PageError message={error} onRetry={load} />;

  return (
    <div class="narrow-page">
      <div class="page-heading">
        <div><p class="eyebrow">Meeting #{meeting.number}</p><h1>Vote for the best</h1><p>{shortDate(meeting.date)} · {meeting.venue}</p></div>
        <Link class="btn btn-ghost btn-sm" href={`/app/vote-result/${meetingId}`}>Results</Link>
      </div>
      {saved && <div class="notice success-notice">Your votes are saved. You can update them.</div>}
      {groups.length === 0 && <div class="page-empty"><p>No voting groups are available yet.</p></div>}
      {groups.map((group) => (
        <section class="card vote-group" key={group.voting_group}>
          <h2>{group.voting_group}</h2>
          {(group.options || []).map((option) => (
            <button
              class={`vote-option ${selections[group.voting_group] === option.role_slot_id ? 'selected' : ''}`}
              type="button"
              key={option.role_slot_id}
              onClick={() => setSelections((current) => ({ ...current, [group.voting_group]: option.role_slot_id }))}
            >
              <span class="candidate">{option.candidate_name}</span>
              <span class="role-tag">{option.role_name}</span>
            </button>
          ))}
        </section>
      ))}
      {error && <p class="error-msg" role="alert">{error}</p>}
      {groups.length > 0 && <button class="btn btn-primary btn-wide" type="button" disabled={saving} onClick={submit}>{saving ? 'Saving…' : 'Save votes'}</button>}
    </div>
  );
}