import { act, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authUser } from '../state/auth.js';
import { meetingsApi } from '../lib/api.js';
import { isMeetingOngoing, MeetingListPage, sortMeetingsForDisplay } from './MeetingListPage.jsx';

beforeEach(() => { authUser.value = { id: 7, role: 'editor' }; });
afterEach(() => {
  authUser.value = null;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const meetings = [
  { id: 3, date: '2026-08-03', start_time: '19:00', end_time: '21:00' },
  { id: 1, date: '2026-08-02', start_time: '09:00', end_time: '10:00' },
  { id: 2, date: '2026-08-02', start_time: '14:00', end_time: '16:00' }
];

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('meeting card ordering', () => {
  it('recognizes a meeting within its scheduled interval', () => {
    expect(isMeetingOngoing(meetings[2], new Date('2026-08-02T15:00:00'))).toBe(true);
    expect(isMeetingOngoing(meetings[2], new Date('2026-08-02T16:30:00'))).toBe(false);
  });

  it('places the ongoing meeting first, then sorts by start time', () => {
    expect(sortMeetingsForDisplay(meetings, new Date('2026-08-02T15:00:00')).map((meeting) => meeting.id))
      .toEqual([2, 1, 3]);
  });
});

describe('MeetingListPage', () => {
  it('requests open meetings by default and preserves upcoming ordering', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-01T12:00:00'));
    const list = vi.spyOn(meetingsApi, 'list').mockResolvedValue(meetings);

    render(<MeetingListPage />);

    const cards = await screen.findAllByRole('link', { name: /View meeting/ });
    expect(list).toHaveBeenCalledWith('open');
    expect(cards.map((card) => card.getAttribute('href')))
      .toEqual(['/app/meetings/1', '/app/meetings/2', '/app/meetings/3']);
    expect(screen.getByText('Next meeting')).toBeTruthy();
  });

  it('keeps the full newest-first API order without promoting an ongoing meeting', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-02T15:00:00'));
    const allMeetings = [
      { ...meetings[0], number: 3, title: 'Upcoming', status: 'draft' },
      { ...meetings[2], number: 2, title: 'Current', status: 'published' },
      { ...meetings[1], number: 1, title: 'Earlier today', status: 'published' },
      { id: 4, number: 4, title: 'Archived draft', status: 'draft', date: '2025-07-01' },
      { id: 5, number: 5, title: 'Archived published', status: 'published', date: '2024-07-01' }
    ];
    const list = vi.spyOn(meetingsApi, 'list').mockResolvedValue(allMeetings);

    render(<MeetingListPage scope="all" />);

    const cards = await screen.findAllByRole('link', { name: /View meeting/ });
    expect(list).toHaveBeenCalledWith('all');
    expect(cards.map((card) => card.getAttribute('href')))
      .toEqual(allMeetings.map((meeting) => `/app/meetings/${meeting.id}`));
    expect(screen.queryByText('Next meeting')).toBeNull();
    expect(screen.getByText('Ongoing')).toBeTruthy();
  });

  it.each([
    ['all', 'No meetings'],
    ['open', 'No upcoming meetings']
  ])('shows the %s empty state', async (scope, title) => {
    vi.spyOn(meetingsApi, 'list').mockResolvedValue([]);

    render(<MeetingListPage scope={scope} />);

    expect(await screen.findByRole('heading', { name: title })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'New meeting' }).getAttribute('href')).toBe('/app/meetings/new');
  });

  it('retries loading all meetings after an API failure', async () => {
    const list = vi.spyOn(meetingsApi, 'list')
      .mockRejectedValueOnce(new Error('Could not load meetings.'))
      .mockResolvedValueOnce(meetings);

    render(<MeetingListPage scope="all" />);

    expect((await screen.findByRole('alert')).textContent).toContain('Could not load meetings.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await screen.findAllByRole('link', { name: /View meeting/ });
    expect(list.mock.calls).toEqual([['all'], ['all']]);
  });

  it('reloads when switching between all and open meetings', async () => {
    const list = vi.spyOn(meetingsApi, 'list').mockResolvedValue([]);
    const { rerender } = render(<MeetingListPage scope="all" />);
    await screen.findByRole('heading', { name: 'No meetings' });

    rerender(<MeetingListPage />);

    await waitFor(() => expect(list.mock.calls).toEqual([['all'], ['open']]));
    expect(await screen.findByRole('heading', { name: 'No upcoming meetings' })).toBeTruthy();
  });

  it.each(['resolve', 'reject'])('ignores a stale %s while the new scope is loading', async (outcome) => {
    const allRequest = deferred();
    const openRequest = deferred();
    const list = vi.spyOn(meetingsApi, 'list')
      .mockReturnValueOnce(allRequest.promise)
      .mockReturnValueOnce(openRequest.promise);
    const { rerender } = render(<MeetingListPage scope="all" />);
    await waitFor(() => expect(list).toHaveBeenCalledWith('all'));

    rerender(<MeetingListPage />);
    await waitFor(() => expect(list).toHaveBeenCalledWith('open'));
    await act(async () => {
      if (outcome === 'resolve') allRequest.resolve(meetings);
      else allRequest.reject(new Error('Stale all-meetings failure.'));
    });

    expect(screen.getByRole('status').textContent).toContain('Loading meetings');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('link', { name: /View meeting/ })).toBeNull();

    await act(async () => { openRequest.resolve([]); });
    expect(await screen.findByRole('heading', { name: 'No upcoming meetings' })).toBeTruthy();
  });

  it.each(['resolve', 'reject'])('ignores a stale %s after the new scope has loaded', async (outcome) => {
    const allRequest = deferred();
    const list = vi.spyOn(meetingsApi, 'list')
      .mockReturnValueOnce(allRequest.promise)
      .mockResolvedValueOnce([meetings[0]]);
    const { rerender } = render(<MeetingListPage scope="all" />);
    await waitFor(() => expect(list).toHaveBeenCalledWith('all'));

    rerender(<MeetingListPage />);
    await screen.findByRole('link', { name: /View meeting/ });
    await act(async () => {
      if (outcome === 'resolve') allRequest.resolve([meetings[1], meetings[2]]);
      else allRequest.reject(new Error('Stale all-meetings failure.'));
    });

    expect(screen.queryByRole('alert')).toBeNull();
    const cards = screen.getAllByRole('link', { name: /View meeting/ });
    expect(cards.map((card) => card.getAttribute('href'))).toEqual(['/app/meetings/3']);
  });

  it('ignores a pending retry after switching scopes', async () => {
    const retryRequest = deferred();
    const list = vi.spyOn(meetingsApi, 'list')
      .mockRejectedValueOnce(new Error('Could not load meetings.'))
      .mockReturnValueOnce(retryRequest.promise)
      .mockResolvedValueOnce([]);
    const { rerender } = render(<MeetingListPage scope="all" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(list.mock.calls).toEqual([['all'], ['all']]));
    rerender(<MeetingListPage />);
    await screen.findByRole('heading', { name: 'No upcoming meetings' });

    await act(async () => { retryRequest.resolve(meetings); });

    expect(list.mock.calls).toEqual([['all'], ['all'], ['open']]);
    expect(screen.getByRole('heading', { name: 'No upcoming meetings' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /View meeting/ })).toBeNull();
  });
});
