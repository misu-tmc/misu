import { useEffect, useState } from 'preact/hooks';
import { Link } from 'wouter-preact';
import { meetingsApi } from '../lib/api.js';
import { buildAgenda, buildSpeeches, shortDate } from '../lib/format.js';
import { PageError, PageLoading } from '../components/PageState.jsx';

export function AgendaPage({ params }) {
  const meetingId = Number(params.id);
  const [meeting, setMeeting] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    meetingsApi.get(meetingId).then(setMeeting).catch((err) => setError(err.message || 'Could not load agenda.'));
  }, [meetingId]);

  if (error) return <PageError message={error} />;
  if (!meeting) return <PageLoading label="Loading agenda…" />;
  const agenda = buildAgenda(meeting);
  const speeches = buildSpeeches(meeting);

  return (
    <div class="agenda-page">
      <div class="agenda-toolbar no-print">
        <Link class="btn btn-ghost btn-sm" href={`/app/meetings/${meetingId}/edit`}>← Editor</Link>
        <a class="btn btn-secondary btn-sm" href={`/meetings/${meetingId}/agenda`} target="_blank" rel="noreferrer">Branded two-page agenda</a>
        <button class="btn btn-primary btn-sm" type="button" onClick={() => window.print()}>Print this view</button>
      </div>
      <article class="agenda-sheet">
        <header>
          <img src="/static/Toastmasters_2011.png" alt="Toastmasters International" />
          <div><p class="eyebrow">Microsoft Suzhou Toastmasters Club</p><h1>{meeting.title}</h1><p>#{meeting.number} · {shortDate(meeting.date)} · {meeting.start_time}–{meeting.end_time}</p></div>
        </header>
        <section class="agenda-meta"><div><strong>Theme</strong><span>{meeting.theme || '—'}</span></div><div><strong>Keyword</strong><span>{meeting.keyword || '—'}</span></div><div><strong>Venue</strong><span>{meeting.venue || '—'}</span></div></section>
        <table class="agenda-table"><thead><tr><th>Time</th><th>Session</th><th>Minutes</th><th>Role taker</th></tr></thead><tbody>
          {agenda.map((row) => <tr key={row.id}><td>{row.start}</td><td><strong>{row.name}</strong>{row.prepMeta && <small>{row.prepMeta}</small>}</td><td>{row.duration_minutes}</td><td>{row.taker}</td></tr>)}
        </tbody></table>
        {speeches.length > 0 && <section class="agenda-speeches"><h2>Prepared speeches</h2>{speeches.map((speech) => <div key={speech.id}><strong>{speech.title}</strong><span>{speech.speaker}{speech.meta ? ` · ${speech.meta}` : ''}</span>{speech.purpose && <p>{speech.purpose}</p>}</div>)}</section>}
      </article>
    </div>
  );
}