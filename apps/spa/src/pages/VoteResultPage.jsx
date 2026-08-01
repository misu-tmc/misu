import { useEffect, useState } from 'preact/hooks';
import { Link } from 'wouter-preact';
import { meetingsApi, votingApi } from '../lib/api.js';
import { shortDate } from '../lib/format.js';
import { PageError, PageLoading } from '../components/PageState.jsx';

export function VoteResultPage({ params }) {
  const meetingId = Number(params.meetingId);
  const [meeting, setMeeting] = useState(null);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [detail, result] = await Promise.all([meetingsApi.get(meetingId), votingApi.result(meetingId)]);
      setMeeting(detail);
      setGroups(result.groups || []);
    } catch (err) {
      setError(err.message || 'Could not load results.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [meetingId]);
  if (loading) return <PageLoading label="Loading results…" />;
  if (error) return <PageError message={error} onRetry={load} />;

  return (
    <div class="narrow-page">
      <div class="page-heading">
        <div><p class="eyebrow">Meeting #{meeting.number}</p><h1>Vote results</h1><p>{shortDate(meeting.date)}</p></div>
        <Link class="btn btn-ghost btn-sm" href={`/app/vote/${meetingId}`}>My ballot</Link>
      </div>
      {groups.length === 0 && <div class="page-empty"><p>No votes have been recorded.</p></div>}
      {groups.map((group) => {
        const max = Math.max(0, ...(group.options || []).map((option) => option.votes || 0));
        return (
          <section class="card result-group" key={group.voting_group}>
            <div class="result-heading"><h2>{group.voting_group}</h2><span>{group.total_votes} votes</span></div>
            {(group.options || []).map((option) => {
              const percent = max ? Math.round((option.votes / max) * 100) : 0;
              const winner = max > 0 && option.votes === max;
              return (
                <div class={`result-option ${winner ? 'winner' : ''}`} key={option.role_slot_id}>
                  <div class="result-label"><span>{option.candidate_name}<small>{option.role_name}</small></span><strong>{option.votes}</strong></div>
                  <div class="result-bar-wrap"><div class="result-bar" style={{ width: `${percent}%` }} /></div>
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}