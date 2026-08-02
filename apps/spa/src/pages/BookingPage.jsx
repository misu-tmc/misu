import { useEffect, useMemo, useState } from 'preact/hooks';
import { bookingApi, meetingsApi } from '../lib/api.js';
import { shortDate, prepTarget } from '../lib/format.js';
import { authUser } from '../state/auth.js';

export function BookingPage() {
  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(new Set());
  const [busy, setBusy] = useState('');

  async function load() {
    setError('');
    try {
      const data = await meetingsApi.upcoming();
      setMeetings(data);
      setExpanded((current) => current.size ? current : new Set(data[0] ? [data[0].id] : []));
    } catch (err) {
      setError(err.message || 'Could not load meetings.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const bookings = useMemo(() => {
    const me = authUser.value?.id;
    return meetings.flatMap((meeting) =>
      (meeting.role_slots || [])
        .filter((slot) => slot.is_bookable !== false && slot.taker_id === me)
        .map((slot) => ({ meeting, slot, target: prepTarget(slot.role_name) }))
    );
  }, [meetings, authUser.value?.id]);

  async function changeBooking(meetingId, slotId, cancel) {
    if (cancel && !window.confirm('Cancel this booking? The role will become available again.')) return;
    const key = `${meetingId}:${slotId}`;
    setBusy(key);
    try {
      await bookingApi.book(meetingId, slotId, cancel);
      await load();
    } catch (err) {
      setError(err.message || 'Booking failed.');
    } finally {
      setBusy('');
    }
  }

  function toggle(meetingId) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(meetingId)) next.delete(meetingId);
      else next.add(meetingId);
      return next;
    });
  }

  if (loading) return <div class="page-loading"><span class="spinner" /><span>Loading meetings…</span></div>;

  return (
    <div class="booking-page">
      {error && <p class="error-msg" role="alert">{error}</p>}

      {bookings.length > 0 && (
        <section class="card booking-summary">
          <details open>
            <summary><span>Your bookings</span><span class="booking-count">{bookings.length}</span></summary>
            <div class="booking-summary-list">
              {bookings.map(({ meeting, slot, target }) => (
                <div class="booking-summary-row" key={`${meeting.id}:${slot.id}`}>
                  <span class="booking-summary-meeting">#{meeting.number} · {shortDate(meeting.date)}</span>
                  <strong>{slot.label || slot.role_name}</strong>
                  <span class="booking-summary-actions">
                    <a class="btn btn-ghost btn-sm" href={`/app/meetings/${meeting.id}/edit?tab=${target.tab}${target.field ? `&field=${target.field}` : ''}&slotId=${slot.id}`}>Prepare</a>
                    <button
                      class="btn btn-ghost btn-sm cancel-booking"
                      type="button"
                      disabled={busy === `${meeting.id}:${slot.id}`}
                      onClick={() => changeBooking(meeting.id, slot.id, true)}
                      aria-label={`Cancel ${slot.label || slot.role_name}`}
                    >×</button>
                  </span>
                </div>
              ))}
            </div>
          </details>
        </section>
      )}

      {meetings.length === 0 && <div class="page-empty"><p>No upcoming meetings.</p></div>}
      {meetings.map((meeting) => {
        const open = expanded.has(meeting.id);
        const slots = (meeting.role_slots || []).filter((slot) => slot.is_bookable !== false);
        return (
          <section class="card meeting-card" key={meeting.id}>
            <button class="meeting-card-header" type="button" onClick={() => toggle(meeting.id)} style="width:100%;border:0;background:none;padding:0;text-align:left">
              <h3>#{meeting.number} · {shortDate(meeting.date)}</h3>
              <span class="date">{meeting.theme || ''}</span>
              <span style="color:var(--muted);margin-left:auto">{open ? '▲' : '▼'}</span>
            </button>
            {open && (
              <div>
                {slots.length === 0 && <p class="page-empty" style="padding:12px 0">No bookable roles</p>}
                {slots.map((slot) => {
                  const key = `${meeting.id}:${slot.id}`;
                  const mine = slot.taker_id === authUser.value?.id;
                  return (
                    <div class="slot-row" key={slot.id}>
                      <span class="role-label">{slot.label || slot.role_name}</span>
                      {slot.taker_id
                        ? <span class="taker">{mine ? <strong>You</strong> : (slot.taker_name || '—')}</span>
                        : <button class="btn btn-secondary btn-sm" type="button" disabled={busy === key} onClick={() => changeBooking(meeting.id, slot.id, false)}>Take!</button>}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}