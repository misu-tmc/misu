import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.jsx';
import { bookingApi, checkinApi, meetingsApi, usersApi, votingApi } from './lib/api.js';
import { canEdit } from './lib/permissions.js';
import { authReady, authUser } from './state/auth.js';

const guest = { id: 7, display_name: 'Guest', email: 'guest@example.test', role: 'guest', club_name: 'Test club' };
const meeting = {
  id: 42, number: 142, title: 'Test meeting', theme: 'Learn', date: '2026-09-14',
  start_time: '19:00', end_time: '21:00', status: 'published', venue: 'Room',
  role_slots: [
    { id: 10, role_name: 'Timer', is_bookable: true, taker_id: null },
    { id: 11, role_name: 'Grammarian', is_bookable: true, taker_id: 7 }
  ],
  sessions: []
};

function open(path) {
  window.history.replaceState({}, '', path);
  return render(<App />);
}

describe('guest read-only access', () => {
  beforeEach(() => {
    authReady.value = true;
    authUser.value = guest;
    vi.spyOn(meetingsApi, 'upcoming').mockResolvedValue([meeting]);
    vi.spyOn(meetingsApi, 'list').mockResolvedValue([meeting]);
    vi.spyOn(meetingsApi, 'get').mockResolvedValue(meeting);
    vi.spyOn(usersApi, 'list').mockResolvedValue([guest]);
    vi.spyOn(usersApi, 'update').mockResolvedValue(guest);
    vi.spyOn(usersApi, 'create').mockResolvedValue(guest);
    vi.spyOn(bookingApi, 'book').mockResolvedValue({});
    vi.spyOn(checkinApi, 'status').mockResolvedValue({ checked_in: false });
    vi.spyOn(checkinApi, 'checkin').mockResolvedValue({});
    vi.spyOn(votingApi, 'state').mockResolvedValue({
      groups: [{ voting_group: 'Best role', options: [{ role_slot_id: 10, candidate_name: 'Member', role_name: 'Timer' }] }]
    });
    vi.spyOn(votingApi, 'submit').mockResolvedValue({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    authReady.value = false;
    authUser.value = null;
  });

  it.each([null, {}, { role: 'guest' }, { role: 'unknown' }])('fails closed for a user without editing access: %j', (user) => {
    expect(canEdit(user)).toBe(false);
    expect(canEdit({ role: 'editor' })).toBe(true);
  });

  it('shows bookings without booking, cancellation or preparation actions', async () => {
    open('/app/booking');
    await screen.findByText('Available');
    expect(screen.getByText(/Guest access is read-only/).classList.contains('no-print')).toBe(true);
    expect(screen.getByText('Your bookings')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Take!' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Cancel/ })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Prepare' })).toBeNull();
    expect(bookingApi.book).not.toHaveBeenCalled();
  });

  it('shows meeting details without edit or check-in controls', async () => {
    open('/app/meetings/42');
    await screen.findByText('Room');
    expect(screen.queryByRole('link', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Check in' })).toBeNull();
    expect(screen.getByRole('link', { name: 'View ballot' })).toBeTruthy();
    expect(checkinApi.checkin).not.toHaveBeenCalled();
  });

  it.each(['/app/meetings/42/edit', '/app/meetings/new'])('blocks a directly opened editor route: %s', async (path) => {
    open(path);
    expect(await screen.findByRole('heading', { name: 'Read-only access' })).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(meetingsApi.get).not.toHaveBeenCalled();
  });

  it('does not auto-check-in guests opening a QR/deep link', async () => {
    open('/app/checkin?meetingId=42');
    await screen.findByRole('alert');
    expect(checkinApi.checkin).not.toHaveBeenCalled();
  });

  it('shows the ballot without selection or vote submission', async () => {
    open('/app/vote/42');
    const candidate = await screen.findByRole('button', { name: /Member/ });
    expect(candidate.disabled).toBe(true);
    fireEvent.click(candidate);
    expect(screen.queryByRole('button', { name: 'Save votes' })).toBeNull();
    expect(votingApi.submit).not.toHaveBeenCalled();
  });

  it('shows user records without user creation', async () => {
    open('/app/misu/users');
    await screen.findByRole('table');
    expect(screen.queryByRole('button', { name: 'Create user' })).toBeNull();
    expect(screen.queryByLabelText('New display name')).toBeNull();
  });

  it('shows profile fields as read-only and prevents implicit form submission', async () => {
    open('/app/me');
    const name = await screen.findByLabelText('Display name');
    expect(name.readOnly).toBe(true);
    expect(screen.getByLabelText('Club (optional)').readOnly).toBe(true);
    expect(screen.queryByRole('button', { name: 'Save profile' })).toBeNull();
    fireEvent.submit(name.closest('form'));
    await waitFor(() => expect(usersApi.update).not.toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Generate migration code' })).toBeNull();
  });

  it('keeps browsing tools but removes the new meeting action', () => {
    open('/app/misu');
    expect(screen.getByRole('link', { name: /^Meetings / })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Users/ })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /New meeting/ })).toBeNull();
  });

  it.each(['all', 'open'])('hides creation controls in the %s meeting list', async (scope) => {
    meetingsApi.list.mockResolvedValue([]);
    open(scope === 'all' ? '/app/misu/meetings' : '/app/meeting');
    await screen.findByRole('heading', { name: /No .*meetings/ });
    expect(screen.queryByRole('link', { name: /New meeting/ })).toBeNull();
  });
});
