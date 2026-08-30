import { render, screen, waitFor } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { umbrella } = vi.hoisted(() => ({ umbrella: vi.fn() }));

vi.mock('../lib/api.js', () => ({
  checkinApi: { umbrella }
}));

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock('wouter-preact', () => ({
  useLocation: () => [`${window.location.pathname}${window.location.search}`, navigate]
}));

import { CheckinPage } from './CheckinPage.jsx';

describe('CheckinPage', () => {
  beforeEach(() => {
    umbrella.mockReset();
    navigate.mockReset();
    sessionStorage.clear();
  });

  it('calls the umbrella endpoint with null and redirects to the backend-returned meeting when the link has no meetingId', async () => {
    window.history.pushState({}, '', '/app/checkin');
    umbrella.mockResolvedValue({ checked_in: true, meeting_id: 17 });

    render(<CheckinPage />);

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/app/meetings/17', { replace: true }));
    expect(umbrella).toHaveBeenCalledWith(null);
    expect(sessionStorage.getItem('misu:meetingId')).toBe('17');
  });

  it('calls the umbrella endpoint with the explicit ID and redirects using the backend-returned meeting ID, not the input', async () => {
    window.history.pushState({}, '', '/app/checkin?meetingId=42');
    umbrella.mockResolvedValue({ checked_in: true, meeting_id: 99 });

    render(<CheckinPage />);

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/app/meetings/99', { replace: true }));
    expect(umbrella).toHaveBeenCalledWith(42);
    expect(sessionStorage.getItem('misu:meetingId')).toBe('99');
  });

  it('never calls the API and shows the invalid-link message when meetingId is invalid', async () => {
    window.history.pushState({}, '', '/app/checkin?meetingId=0');

    render(<CheckinPage />);

    expect(await screen.findByText('This check-in link is invalid.')).toBeTruthy();
    expect(umbrella).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('shows the backend failure message and does not navigate when the API call fails', async () => {
    window.history.pushState({}, '', '/app/checkin');
    umbrella.mockRejectedValue(new Error('No meeting is currently open for check-in.'));

    render(<CheckinPage />);

    expect(await screen.findByText('No meeting is currently open for check-in.')).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('shows an error and does not navigate when the backend response has no positive meeting_id', async () => {
    window.history.pushState({}, '', '/app/checkin');
    umbrella.mockResolvedValue({ checked_in: true, meeting_id: 0 });

    render(<CheckinPage />);

    await waitFor(() => expect(screen.queryByText(/Checking in/)).toBeNull());
    expect(navigate).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('misu:meetingId')).toBeNull();
  });
});
