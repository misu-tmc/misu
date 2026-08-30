import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { upcoming, update } = vi.hoisted(() => ({
  upcoming: vi.fn(),
  update: vi.fn()
}));

vi.mock('../lib/api.js', () => ({
  authApi: { migrationCode: vi.fn(), logout: vi.fn() },
  meetingsApi: { upcoming },
  usersApi: { update }
}));

const { authUser } = vi.hoisted(() => ({ authUser: { value: null } }));

vi.mock('../state/auth.js', () => ({ authUser }));

import { MePage } from './MePage.jsx';

describe('MePage profile editing', () => {
  beforeEach(() => {
    authUser.value = { id: 7, display_name: 'Guest', club_name: 'Old Club' };
    upcoming.mockReset().mockResolvedValue([]);
    update.mockReset().mockResolvedValue({ id: 7, display_name: 'Guest', club_name: 'New Club' });
  });

  it('initializes the optional club field from the authenticated user', async () => {
    render(<MePage />);
    const club = await screen.findByLabelText('Club (optional)');
    expect(club.value).toBe('Old Club');
  });

  it('trims and sends the display name and club name on save', async () => {
    render(<MePage />);
    fireEvent.input(await screen.findByLabelText('Display name'), { target: { value: '  Guest  ' } });
    fireEvent.input(screen.getByLabelText('Club (optional)'), { target: { value: '  New Club  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));

    await waitFor(() => expect(update).toHaveBeenCalledWith(7, { display_name: 'Guest', club_name: 'New Club' }));
  });

  it('clears the club by sending a blank string', async () => {
    update.mockResolvedValueOnce({ id: 7, display_name: 'Guest', club_name: null });
    render(<MePage />);
    fireEvent.input(await screen.findByLabelText('Club (optional)'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));

    await waitFor(() => expect(update).toHaveBeenCalledWith(7, { display_name: 'Guest', club_name: '' }));
  });

  it('replaces the auth user and syncs local fields from the response', async () => {
    render(<MePage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Save profile' }));

    await waitFor(() => expect(authUser.value).toEqual({ id: 7, display_name: 'Guest', club_name: 'New Club' }));
    expect(screen.getByLabelText('Club (optional)').value).toBe('New Club');
    expect(screen.getByLabelText('Display name').value).toBe('Guest');
  });
});
