import { useEffect, useState } from 'preact/hooks';
import { useLocation } from 'wouter-preact';
import { checkinApi } from '../lib/api.js';
import { optionalMeetingId } from '../lib/checkinLink.js';
import { PageError, PageLoading } from '../components/PageState.jsx';

export function CheckinPage() {
  const [, navigate] = useLocation();
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    async function checkIn() {
      try {
        const requestedId = optionalMeetingId(window.location.search);
        const result = await checkinApi.umbrella(requestedId);
        const meetingId = Number(result?.meeting_id);
        if (!Number.isSafeInteger(meetingId) || meetingId <= 0) {
          throw new Error('This check-in link is invalid.');
        }
        sessionStorage.setItem('misu:meetingId', String(meetingId));
        if (active) navigate(`/app/meetings/${meetingId}`, { replace: true });
      } catch (err) {
        if (active) setError(err.message || 'Check-in failed.');
      }
    }
    checkIn();
    return () => { active = false; };
  }, [navigate]);

  return error ? <PageError message={error} /> : <PageLoading label="Checking in…" />;
}