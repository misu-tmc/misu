import { useEffect, useState } from 'preact/hooks';
import { useLocation } from 'wouter-preact';
import { checkinApi, meetingsApi } from '../lib/api.js';
import { PageError, PageLoading } from '../components/PageState.jsx';

export function CheckinPage() {
  const [, navigate] = useLocation();
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    async function checkIn() {
      try {
        let meetingId = Number(new URLSearchParams(window.location.search).get('meetingId')) || null;
        if (!meetingId) {
          const meetings = await meetingsApi.upcoming();
          meetingId = meetings[0]?.id || null;
        }
        if (!meetingId) throw new Error('No upcoming meeting is available.');
        await checkinApi.checkin(meetingId);
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