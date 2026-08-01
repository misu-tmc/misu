import { useEffect, useState } from 'preact/hooks';
import { Link } from 'wouter-preact';
import { checkinApi, meetingsApi } from '../lib/api.js';
import { buildAgenda, buildSpeeches, shortDate } from '../lib/format.js';
import { EmptyState, PageError, PageLoading } from '../components/PageState.jsx';

function elapsedLabel(seconds) {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function MeetingPage() {
  const [meeting, setMeeting] = useState(null);
  const [agenda, setAgenda] = useState([]);
  const [speeches, setSpeeches] = useState([]);
  const [checkedIn, setCheckedIn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [checkingIn, setCheckingIn] = useState(false);
  const [timerMode, setTimerMode] = useState(false);
  const [activeTimer, setActiveTimer] = useState(null);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const upcoming = await meetingsApi.upcoming();
      if (!upcoming.length) {
        setMeeting(null);
        return;
      }
      const requested = Number(new URLSearchParams(window.location.search).get('meetingId')) || Number(sessionStorage.getItem('misu:meetingId'));
      const selected = upcoming.find((item) => item.id === requested) || upcoming[0];
      const detail = await meetingsApi.get(selected.id);
      setMeeting(detail);
      setAgenda(buildAgenda(detail).map((row) => ({ ...row, key: `session-${row.id}`, elapsed: 0, isSub: false })));
      setSpeeches(buildSpeeches(detail));
      const status = await checkinApi.status(detail.id).catch(() => ({ checked_in: false }));
      setCheckedIn(!!status.checked_in);
    } catch (err) {
      setError(err.message || 'Could not load the meeting.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!activeTimer) return undefined;
    const ticker = window.setInterval(() => {
      setAgenda((rows) => rows.map((row) => row.key === activeTimer ? { ...row, elapsed: row.elapsed + 1 } : row));
    }, 1000);
    return () => window.clearInterval(ticker);
  }, [activeTimer]);

  async function checkIn() {
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

  function addSubSession(parent) {
    setAgenda((rows) => {
      const parentIndex = rows.findIndex((row) => row.key === parent.key);
      const children = rows.filter((row) => row.parentKey === parent.key).length;
      let insertAt = parentIndex;
      while (insertAt + 1 < rows.length && rows[insertAt + 1].parentKey === parent.key) insertAt += 1;
      const next = rows.slice();
      next.splice(insertAt + 1, 0, {
        ...parent,
        id: `${parent.id}-sub-${children + 1}`,
        key: `${parent.key}-sub-${Date.now()}`,
        parentKey: parent.key,
        isSub: true,
        name: `${parent.sessionName || parent.name} ${children + 1}`,
        start: '',
        taker: '',
        elapsed: 0
      });
      return next;
    });
  }

  if (loading) return <PageLoading label="Loading meeting…" />;
  if (error && !meeting) return <PageError message={error} onRetry={load} />;
  if (!meeting) return <EmptyState title="No upcoming meeting" message="A published meeting will appear here when it is ready." />;

  return (
    <>
      <section class="card meeting-hero">
        <div class="meeting-title-row">
          <div>
            <p class="eyebrow">Current meeting</p>
            <h1>#{meeting.number} · {shortDate(meeting.date)}</h1>
            <p>{meeting.theme || meeting.title} · {meeting.venue || 'Venue to be confirmed'}</p>
            <p class="meeting-time">{meeting.start_time}–{meeting.end_time}{meeting.keyword ? ` · Keyword: ${meeting.keyword}` : ''}</p>
          </div>
          <span class={`pill pill-${meeting.status}`}>{meeting.status}</span>
        </div>
        <div class="action-row">
          <button class={`btn ${checkedIn ? 'btn-secondary' : 'btn-primary'}`} type="button" disabled={checkedIn || checkingIn} onClick={checkIn}>
            {checkedIn ? '✓ Checked in' : checkingIn ? 'Checking in…' : 'Check in'}
          </button>
          <Link class="btn btn-secondary" href={`/app/vote/${meeting.id}`}>Vote</Link>
          <button class="btn btn-ghost" type="button" onClick={toggleTimer}>{timerMode ? 'Exit timer' : 'Timer mode'}</button>
          <Link class="btn btn-ghost" href={`/app/meetings/${meeting.id}/edit`}>Edit</Link>
        </div>
        {error && <p class="error-msg" role="alert">{error}</p>}
      </section>

      <section class="card section-card">
        <details open>
          <summary>Agenda</summary>
          <div class="agenda-list">
            {agenda.map((row) => (
              <div class={`agenda-row ${row.isSub ? 'agenda-sub' : ''}`} key={row.key}>
                <span class="start">{row.start}</span>
                <span class="agenda-name">{row.name}{row.prepMeta && <small>{row.prepMeta}</small>}</span>
                {timerMode ? (
                  <span class="timer-controls">
                    <strong>{elapsedLabel(row.elapsed)}</strong>
                    <button class="timer-button" type="button" onClick={() => toggleRowTimer(row.key)}>{activeTimer === row.key ? 'Pause' : 'Start'}</button>
                    <button class="timer-button" type="button" onClick={() => resetTimer(row.key)}>Reset</button>
                    {!row.isSub && <button class="timer-button" type="button" onClick={() => addSubSession(row)}>+Sub</button>}
                  </span>
                ) : (
                  <><span class="dur">{row.duration_minutes}'</span><span class="taker">{row.taker}</span></>
                )}
              </div>
            ))}
          </div>
        </details>
      </section>

      {speeches.length > 0 && (
        <section class="card section-card">
          <details>
            <summary>Prepared speeches</summary>
            <div class="speech-list">
              {speeches.map((speech) => (
                <article class="speech-item" key={speech.id}>
                  <div><strong>{speech.title}</strong>{speech.speaker && <span> · {speech.speaker}</span>}</div>
                  {speech.meta && <small>{speech.meta}</small>}
                  {speech.purpose && <p>{speech.purpose}</p>}
                  {speech.description && <p>{speech.description}</p>}
                </article>
              ))}
            </div>
          </details>
        </section>
      )}
    </>
  );
}