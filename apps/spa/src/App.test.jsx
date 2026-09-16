import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.jsx';
import { authApi, catalogApi, checkinApi, meetingsApi, usersApi } from './lib/api.js';
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

describe('canonical Meeting routes', () => {
  beforeEach(() => {
    authReady.value = true;
    authUser.value = { id: 1, display_name: 'Member' };
    vi.spyOn(meetingsApi, 'list').mockResolvedValue([]);
    vi.spyOn(meetingsApi, 'get').mockResolvedValue(archivedMeeting);
    vi.spyOn(checkinApi, 'status').mockResolvedValue({ checked_in: false });
    vi.spyOn(checkinApi, 'attendees').mockResolvedValue([]);
    vi.spyOn(catalogApi, 'roles').mockResolvedValue([]);
    vi.spyOn(catalogApi, 'venues').mockResolvedValue([]);
    vi.spyOn(usersApi, 'list').mockResolvedValue([]);
    vi.spyOn(meetingsApi, 'templates').mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    authReady.value = false;
    authUser.value = null;
    window.history.replaceState({}, '', '/');
  });

  function expectMeetingTab() {
    for (const name of ['Main navigation', 'Tab navigation']) {
      const navigation = within(screen.getByRole('navigation', { name }));
      expect(navigation.getAllByRole('link').filter((link) => link.classList.contains('active'))
        .map((link) => link.textContent)).toEqual(['Meeting']);
    }
    expect(document.body.classList.contains('attendee-layout')).toBe(true);
  }

  it.each([
    ['/app/meetings', 'list'],
    ['/app/meetings/?scope=open#upcoming', 'list'],
    ['/app/meetings/new', 'editor'],
    ['/app/meetings/42', 'detail'],
    ['/app/meetings/42/edit?tab=info#information', 'editor'],
    ['/app/meetings/42/agenda', 'agenda']
  ])('loads %s directly and after remounting at the same URL', async (path, page) => {
    window.history.replaceState({}, '', path);

    for (let load = 0; load < 2; load += 1) {
      const { unmount } = render(<App />);
      if (page === 'list') {
        await screen.findByRole('heading', { name: 'No upcoming meetings' });
        expect(meetingsApi.list).toHaveBeenLastCalledWith('open');
      } else if (page === 'editor') {
        await screen.findByLabelText('Title');
      } else if (page === 'detail') {
        await screen.findByRole('link', { name: 'Edit' });
      } else {
        await screen.findByRole('button', { name: 'Save PDF' });
      }
      if (path.includes('/42')) expect(meetingsApi.get).toHaveBeenCalledWith(42);
      expectMeetingTab();
      expect(screen.getByRole('banner', { name: 'Site header' }).classList.contains('editor-topbar'))
        .toBe(page === 'editor');
      expect(screen.queryByText('Edit meeting') !== null).toBe(page === 'editor');
      expect(document.body.classList.contains('editor-detail-layout')).toBe(page === 'editor');
      expect(document.body.classList.contains('agenda-print-layout')).toBe(page === 'agenda');
      expect(window.location.pathname + window.location.search + window.location.hash).toBe(path);
      unmount();
      expect(document.body.classList.contains('attendee-layout')).toBe(false);
      expect(document.body.classList.contains('editor-detail-layout')).toBe(false);
      expect(document.body.classList.contains('agenda-print-layout')).toBe(false);
    }
  });

  it.each([
    ['/app/meeting', ''],
    ['/app/meeting/', ''],
    ['/app/meeting?scope=open&tag=a%2Fb&tag=c+d#next%20meeting', '?scope=open&tag=a%2Fb&tag=c+d#next%20meeting'],
    ['/app/meeting/#upcoming', '#upcoming']
  ])('replaces the legacy URL %s without losing its query or fragment', async (path, suffix) => {
    window.history.replaceState({}, '', path);
    const historyLength = window.history.length;
    render(<App />);

    await screen.findByRole('heading', { name: 'No upcoming meetings' });
    expect(window.location.pathname + window.location.search + window.location.hash)
      .toBe(`/app/meetings${suffix}`);
    expect(window.history.length).toBe(historyLength);
    expect(meetingsApi.list).toHaveBeenLastCalledWith('open');
    expectMeetingTab();
  });

  it.each(['', '?scope=open&tag=a%2Fb#upcoming'])('preserves the current suffix "%s" on client-side legacy navigation', async (suffix) => {
    const initialPath = '/app/misu?unrelated=value#previous';
    window.history.replaceState({}, '', initialPath);
    render(<App />);
    await screen.findByRole('navigation', { name: 'Main navigation' });
    const historyLength = window.history.length;

    act(() => window.history.pushState({}, '', `/app/meeting${suffix}`));

    await screen.findByRole('heading', { name: 'No upcoming meetings' });
    expect(window.location.pathname + window.location.search + window.location.hash)
      .toBe(`/app/meetings${suffix}`);
    expect(window.history.length).toBe(historyLength + 1);
    expect(meetingsApi.list).toHaveBeenCalledOnce();
    expectMeetingTab();

    window.history.back();
    await waitFor(() => expect(window.location.pathname + window.location.search + window.location.hash)
      .toBe(initialPath));
    const navigation = within(screen.getByRole('navigation', { name: 'Tab navigation' }));
    expect(navigation.getByRole('link', { name: 'MISU' }).classList.contains('active')).toBe(true);
    expect(navigation.getByRole('link', { name: 'Meeting' }).classList.contains('active')).toBe(false);
  });

  it.each(['/app/meetings', '/app/meeting'])('checks authentication before loading meetings from %s', async (path) => {
    window.history.replaceState({}, '', `${path}?scope=open#upcoming`);
    authReady.value = false;
    authUser.value = null;
    let finishAuthentication;
    const me = vi.spyOn(authApi, 'me').mockReturnValue(new Promise((resolve) => { finishAuthentication = resolve; }));
    render(<App />);

    await screen.findByText('Checking your account…');
    expect(me).toHaveBeenCalledOnce();
    expect(meetingsApi.list).not.toHaveBeenCalled();
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).toBeNull();
    expect(window.location.pathname + window.location.search + window.location.hash)
      .toBe('/app/meetings?scope=open#upcoming');

    finishAuthentication({ user: { id: 1, display_name: 'Member' } });
    await screen.findByRole('heading', { name: 'No upcoming meetings' });
    expectMeetingTab();
  });
});
