import { fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.jsx';
import { catalogApi, checkinApi, meetingsApi, usersApi } from './lib/api.js';
import { authReady, authUser } from './state/auth.js';

const archivedMeeting = {
  id: 42,
  number: 142,
  title: 'Archived meeting',
  theme: 'Looking back',
  keyword: 'Reflect',
  date: '2020-08-08',
  start_time: '19:00',
  end_time: '21:00',
  status: 'published',
  venue: 'Meeting room',
  role_slots: [],
  sessions: []
};

describe('MISU meetings navigation', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/app/misu');
    authReady.value = true;
    authUser.value = { id: 1, display_name: 'Member' };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    authReady.value = false;
    authUser.value = null;
    window.history.replaceState({}, '', '/');
  });

  it('opens and edits an archived meeting from the MISU full list', async () => {
    const list = vi.spyOn(meetingsApi, 'list').mockResolvedValue([archivedMeeting]);
    vi.spyOn(meetingsApi, 'get').mockResolvedValue(archivedMeeting);
    vi.spyOn(checkinApi, 'status').mockResolvedValue({ checked_in: false });
    vi.spyOn(checkinApi, 'attendees').mockResolvedValue([]);
    vi.spyOn(catalogApi, 'roles').mockResolvedValue([]);
    vi.spyOn(catalogApi, 'venues').mockResolvedValue([]);
    vi.spyOn(usersApi, 'list').mockResolvedValue([]);
    vi.spyOn(meetingsApi, 'templates').mockResolvedValue([]);
    const updateInfo = vi.spyOn(meetingsApi, 'updateInfo')
      .mockResolvedValue({ ...archivedMeeting, title: 'Updated archived meeting' });

    render(<App />);
    fireEvent.click(screen.getByRole('link', { name: /^Meetings / }));

    const archivedCard = await screen.findByRole('link', { name: /Archived meeting/ });
    expect(window.location.pathname).toBe('/app/misu/meetings');
    expect(list).toHaveBeenCalledWith('all');
    expect(screen.queryByText('Next meeting')).toBeNull();
    for (const name of ['Main navigation', 'Tab navigation']) {
      const navigation = within(screen.getByRole('navigation', { name }));
      expect(navigation.getByRole('link', { name: 'MISU' }).classList.contains('active')).toBe(true);
      expect(navigation.getByRole('link', { name: 'Meeting' }).classList.contains('active')).toBe(false);
    }

    fireEvent.click(archivedCard);
    const edit = await screen.findByRole('link', { name: 'Edit' });
    expect(window.location.pathname).toBe('/app/meetings/42');
    expect(edit.getAttribute('href')).toBe('/app/meetings/42/edit');
    fireEvent.click(edit);

    const title = await screen.findByLabelText('Title');
    expect(window.location.pathname).toBe('/app/meetings/42/edit');
    expect(title.value).toBe('Archived meeting');
    fireEvent.input(title, { target: { value: 'Updated archived meeting' } });
    fireEvent.submit(title.closest('form'));

    await waitFor(() => expect(updateInfo).toHaveBeenCalledWith(42, {
      title: 'Updated archived meeting',
      theme: archivedMeeting.theme,
      keyword: archivedMeeting.keyword,
      date: archivedMeeting.date,
      start_time: archivedMeeting.start_time,
      end_time: archivedMeeting.end_time,
      venue: archivedMeeting.venue
    }));
    expect(await screen.findByText('Information saved')).toBeTruthy();
  });

  it('loads all meetings by direct URL and keeps the Meeting tab scoped to open meetings', async () => {
    window.history.replaceState({}, '', '/app/misu/meetings');
    const list = vi.spyOn(meetingsApi, 'list').mockResolvedValue([]);
    render(<App />);

    await screen.findByRole('heading', { name: 'No meetings' });
    expect(list).toHaveBeenLastCalledWith('all');

    const navigation = within(screen.getByRole('navigation', { name: 'Tab navigation' }));
    fireEvent.click(navigation.getByRole('link', { name: 'Meeting' }));

    await screen.findByRole('heading', { name: 'No upcoming meetings' });
    expect(window.location.pathname).toBe('/app/meetings');
    expect(list).toHaveBeenLastCalledWith('open');
  });
});
