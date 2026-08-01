import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { upcoming, book } = vi.hoisted(() => ({
  upcoming: vi.fn(),
  book: vi.fn()
}));

vi.mock('../lib/api.js', () => ({
  meetingsApi: { upcoming },
  bookingApi: { book }
}));

vi.mock('../state/auth.js', () => ({
  authUser: { value: { id: 7, display_name: 'Test Member' } }
}));

import { BookingPage } from './BookingPage.jsx';

const meeting = {
  id: 42,
  number: 142,
  date: '2026-08-08',
  theme: 'Embrace Change',
  role_slots: [
    { id: 10, role_name: 'Timer', label: 'Timer', is_bookable: true, taker_id: null, taker_name: null },
    { id: 11, role_name: 'Grammarian', label: 'Grammarian', is_bookable: true, taker_id: 7, taker_name: 'Test Member' }
  ]
};

describe('BookingPage', () => {
  beforeEach(() => {
    upcoming.mockReset().mockResolvedValue([meeting]);
    book.mockReset().mockResolvedValue({ ok: true });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('renders upcoming roles and the current user summary', async () => {
    render(<BookingPage />);
    expect(await screen.findByText('#142 · Sat, Aug 8 · Grammarian')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Take!' })).toBeTruthy();
  });

  it('books an available role and refreshes meetings', async () => {
    render(<BookingPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Take!' }));
    await waitFor(() => expect(book).toHaveBeenCalledWith(42, 10, false));
    expect(upcoming).toHaveBeenCalledTimes(2);
  });
});
