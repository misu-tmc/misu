import { useEffect, useState } from 'preact/hooks';
import { Link } from 'wouter-preact';
import { checkinApi, meetingsApi } from '../lib/api.js';
import { buildAgenda, buildSpeeches, shortDate } from '../lib/format.js';
import { EmptyState, PageError, PageLoading } from '../components/PageState.jsx';

function elapsedLabel(seconds) {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function MeetingPage({ params }) {
  const [meeting, setMeeting] = useState(null);
  const [agenda, setAgenda] = useState([]);
  const [speeches, setSpeeches] = useState([]);
  const [checkedIn, setCheckedIn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [checkingIn, setCheckingIn] = useState(false);
  const [timerMode, setTimerMode] = useState(false);
  const [activeTimer, setActiveTimer] = useState(null);
  const [agendaOpen, setAgendaOpen] = useState(true);
  const [speechesOpen, setSpeechesOpen] = useState(false);

  useEffect(() => {
    document.body.classList.add('meeting-detail-layout');
    return () => document.body.classList.remove('meeting-detail-layout');
  }, []);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const requested = Number(params?.id) || Number(new URLSearchParams(window.location.search).get('meetingId')) || Number(sessionStorage.getItem('misu:meetingId'));
      let meetingId = requested;
      if (!meetingId) {
        const upcoming = await meetingsApi.upcoming();
        meetingId = upcoming[0]?.id || null;
      }
      if (!meetingId) {
        setMeeting(null);
        return;
      }
      const detail = await meetingsApi.get(meetingId);
      setMeeting(detail);
      setAgenda(buildAgenda(detail).map((row) => ({ ...row, key: `session-${row.id}`, elapsed: 0, isSub: false })));
      setSpeeches(buildSpeeches(detail));
      setAgendaOpen(true);
      setSpeechesOpen(false);
      const status = await checkinApi.status(detail.id).catch(() => ({ checked_in: false }));
      setCheckedIn(!!status.checked_in);
    } catch (err) {
      setError(err.message || 'Could not load the meeting.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [params?.id]);

  useEffect(() => {
    if (!activeTimer) return undefined;
    const ticker = window.setInterval(() => {
      setAgenda((rows) => rows.map((row) => row.key === activeTimer ? { ...row, elapsed: row.elapsed + 1 } : row));
    }, 1000);
    return () => window.clearInterval(ticker);
  }, [activeTimer]);

  async function checkIn() {
    if (checkedIn) return;
    setCheckingIn(true);
    setError('');
    try {
      await checkinApi.checkin(meeting.id);
      setCheckedIn(true);
      sessionStorage.setItem('misu:meetingId', String(meeting.id));
    } catch (err) {
      setError(err.message || 'Check-in failed.');
    } finally {
      setCheckingIn(false);
    }
  }

  function toggleTimer() {
    if (timerMode) setActiveTimer(null);
    setTimerMode(!timerMode);
  }

  function toggleRowTimer(key) {
    setActiveTimer((current) => current === key ? null : key);
  }

  function resetTimer(key) {
    setAgenda((rows) => rows.map((row) => row.key === key ? { ...row, elapsed: 0 } : row));
  }

  function addSubSession(source) {
    setAgenda((rows) => {
      const parentKey = source.isSub ? source.parentKey : source.key;
      const parent = rows.find((row) => row.key === parentKey) || source;
      const children = rows.filter((row) => row.parentKey === parentKey).length;
      const insertAt = rows.reduce(
        (last, row, index) => row.key === parentKey || row.parentKey === parentKey ? index : last,
        rows.findIndex((row) => row.key === source.key)
      );
      const next = rows.slice();
      next.splice(insertAt + 1, 0, {
        ...parent,
        id: `${parent.id}-sub-${children + 1}`,
        key: `${parentKey}-sub-${Date.now()}`,
        parentKey,
        isSub: true,
        name: `${parent.name} ${children + 1}`,
        start: '',
        taker: '',
        duration_minutes: 0,
        prepMeta: '',
        elapsed: 0
      });
      return next;
    });
  }

  if (loading) return <PageLoading label="Loading meeting…" />;
  if (error && !meeting) return <PageError message={error} onRetry={load} />;
  if (!meeting) return <EmptyState title="No upcoming meeting" message="A published meeting will appear here when it is ready." />;

  return (
    <div class="meeting-page">
      <section class="card meeting-hero">
        <div class="meeting-title-row">
          <h1>#{meeting.number} · {shortDate(meeting.date).replace(',', '')} · {meeting.start_time}–{meeting.end_time}</h1>
          <Link class="meeting-edit-link" href={`/app/meetings/${meeting.id}/edit`}>Edit</Link>
        </div>
        <p class="meeting-title-sub">{meeting.venue || '—'}</p>
        <div class="meeting-actions">
          <button class={`btn meeting-action ${checkedIn ? 'meeting-action-checked' : 'meeting-action-outline'}`} type="button" disabled={checkingIn} onClick={checkIn}>
            {checkedIn ? 'Checked in' : checkingIn ? 'Checking in…' : 'Check in'}
          </button>
          <Link class="btn meeting-action meeting-action-outline" href={`/app/vote/${meeting.id}`}>Vote for best</Link>
          <button class={`btn meeting-action ${timerMode ? 'meeting-action-timer-on' : 'meeting-action-outline'}`} type="button" onClick={toggleTimer}>{timerMode ? 'Timer on' : 'Timer mode'}</button>
        </div>
        {error && <p class="error-msg" role="alert">{error}</p>}
      </section>

      <section class="card meeting-theme-card" aria-label="Meeting theme and keyword">
        <div>
          <span>Theme</span>
          <strong>{meeting.theme || '—'}</strong>
        </div>
        <div>
          <span>Keyword</span>
          <strong>{meeting.keyword || '—'}</strong>
        </div>
      </section>

      <section class="meeting-section">
        <button class="meeting-section-header" type="button" aria-expanded={agendaOpen} onClick={() => setAgendaOpen(!agendaOpen)}>
          <span class="meeting-fold-toggle" aria-hidden="true">{agendaOpen ? '−' : '+'}</span>
          <span>Agenda</span>
        </button>
        {agendaOpen && (
          <div class="card meeting-section-card">
            {agenda.map((row) => (
              <div class={`meeting-agenda-row ${activeTimer === row.key ? 'running' : ''}`} key={row.key}>
                <span class="meeting-agenda-time">{row.start}</span>
                <div class="meeting-agenda-main">
                  <span class="meeting-agenda-name">{row.name}</span>
                  {row.prepMeta && <span class="meeting-agenda-meta">{row.prepMeta}</span>}
                  <span class="meeting-agenda-meta">{row.duration_minutes}' · {row.taker || '—'}</span>
                  {timerMode && <span class="meeting-agenda-meta meeting-timer-elapsed">Elapsed {elapsedLabel(row.elapsed)}</span>}
                </div>
                {timerMode && (
                  <div class="meeting-timer-actions">
                    {activeTimer === row.key && <button class="meeting-timer-button restart" type="button" aria-label={`Restart ${row.name} timer`} onClick={() => resetTimer(row.key)}>↺</button>}
                    <button class="meeting-timer-button" type="button" aria-label={`${activeTimer === row.key ? 'Pause' : 'Start'} ${row.name} timer`} onClick={() => toggleRowTimer(row.key)}>{activeTimer === row.key ? 'Ⅱ' : '▶'}</button>
                    <button class="meeting-timer-button add" type="button" aria-label={`Add sub-session after ${row.name}`} onClick={() => addSubSession(row)}>+</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {speeches.length > 0 && (
        <section class="meeting-section">
          <button class="meeting-section-header" type="button" aria-expanded={speechesOpen} onClick={() => setSpeechesOpen(!speechesOpen)}>
            <span class="meeting-fold-toggle" aria-hidden="true">{speechesOpen ? '−' : '+'}</span>
            <span>Speeches</span>
          </button>
          {speechesOpen && (
            <div class="card meeting-section-card">
              {speeches.map((speech) => (
                <article class="meeting-speech-row" key={speech.id}>
                  <div class="meeting-speech-head">
                    <strong>{speech.title}</strong>
                    {speech.speaker && <span>{speech.speaker}</span>}
                  </div>
                  {speech.meta && <span class="meeting-speech-meta">{speech.meta}</span>}
                  {speech.purpose && <div class="meeting-speech-detail"><span>Purpose</span><p>{speech.purpose}</p></div>}
                  {speech.description && <div class="meeting-speech-detail"><span>Description</span><p>{speech.description}</p></div>}
                </article>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}