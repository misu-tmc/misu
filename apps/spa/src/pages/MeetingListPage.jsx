import { useEffect, useState } from 'preact/hooks';
import { Link } from 'wouter-preact';
import { meetingsApi } from '../lib/api.js';
import { shortDate } from '../lib/format.js';
import { EmptyState, PageError, PageLoading } from '../components/PageState.jsx';

function localMeetingDate(meeting, field) {
  const time = meeting[field] || (field === 'start_time' ? '00:00' : '23:59');
  return new Date(`${meeting.date}T${time.length === 5 ? `${time}:00` : time}`);
}

export function isMeetingOngoing(meeting, now = new Date()) {
  const start = localMeetingDate(meeting, 'start_time');
  let end = localMeetingDate(meeting, 'end_time');
  if (end < start) end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
  return now >= start && now <= end;
}

export function sortMeetingsForDisplay(meetings, now = new Date()) {
  return meetings.slice().sort((left, right) => {
    const leftOngoing = isMeetingOngoing(left, now);
    const rightOngoing = isMeetingOngoing(right, now);
    if (leftOngoing !== rightOngoing) return leftOngoing ? -1 : 1;
    return localMeetingDate(left, 'start_time') - localMeetingDate(right, 'start_time');
  });
}

export function MeetingListPage() {
  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      setMeetings(sortMeetingsForDisplay(await meetingsApi.list('open')));
    } catch (err) {
      setError(err.message || 'Could not load meetings.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  if (loading) return <PageLoading label="Loading meetings…" />;
  if (error) return <PageError message={error} onRetry={load} />;

  return (
    <div class="meeting-list-page">
      <div class="attendee-page-heading meeting-list-heading">
        <div><p class="eyebrow">Club schedule</p><h1>Meetings</h1></div>
        <Link class="btn btn-primary btn-sm" href="/app/meetings/new">+ New meeting</Link>
      </div>

      {meetings.length === 0 ? (
        <EmptyState
          title="No upcoming meetings"
          message="Create the next meeting to get started."
          action={<Link class="btn btn-primary" href="/app/meetings/new">New meeting</Link>}
        />
      ) : (
        <div class="meeting-card-grid">
          {meetings.map((meeting, index) => {
            const ongoing = isMeetingOngoing(meeting);
            return (
              <Link class={`meeting-overview-card ${ongoing ? 'ongoing' : ''}`} href={`/app/meetings/${meeting.id}`} key={meeting.id}>
                <div class="meeting-overview-topline">
                  <span class={`meeting-state ${ongoing ? 'ongoing' : index === 0 ? 'next' : ''}`}>
                    {ongoing ? 'Ongoing' : index === 0 ? 'Next meeting' : shortDate(meeting.date)}
                  </span>
                  <span class={`pill pill-${meeting.status}`}>{meeting.status}</span>
                </div>
                <h2>#{meeting.number} · {meeting.title}</h2>
                {meeting.theme && <p class="meeting-overview-theme">{meeting.theme}</p>}
                <dl class="meeting-overview-meta">
                  <div><dt>Date</dt><dd>{shortDate(meeting.date)}</dd></div>
                  <div><dt>Time</dt><dd>{meeting.start_time}–{meeting.end_time}</dd></div>
                  <div><dt>Venue</dt><dd>{meeting.venue || 'To be confirmed'}</dd></div>
                </dl>
                <span class="meeting-card-action">View meeting <span aria-hidden="true">→</span></span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
