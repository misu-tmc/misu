import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  roles,
  venues,
  attendees,
  meetingsGet,
  meetingsTemplates,
  usersList,
  navigate
} = vi.hoisted(() => {
  return {
    roles: vi.fn(),
    venues: vi.fn(),
    attendees: vi.fn(),
    meetingsGet: vi.fn(),
    meetingsTemplates: vi.fn(),
    usersList: vi.fn(),
    navigate: vi.fn()
  };
});

vi.mock('../lib/api.js', () => ({
  catalogApi: { roles, venues },
  checkinApi: { attendees },
  meetingsApi: { get: meetingsGet, templates: meetingsTemplates },
  usersApi: { list: usersList }
}));

vi.mock('wouter-preact', () => ({
  useLocation: () => [['/app/meetings/42/edit?tab=roles', navigate], navigate]
}));

import { EditorPage } from './EditorPage.jsx';

const meeting = {
  id: 42,
  number: 142,
  title: 'Regular Meeting',
  theme: 'Embrace Change',
  keyword: 'Adapt',
  date: '2026-08-08',
  start_time: '19:00',
  end_time: '21:00',
  status: 'draft',
  venue: 'B26 Room 1.1B',
  role_slots: [
    {
      id: 10,
      _key: 'slot-10',
      role_name: 'Timer',
      label: 'Timer',
      custom_label: '',
      taker_id: null,
      taker_name: ''
    }
  ],
  sessions: [
    {
      id: 20,
      _key: 'session-20',
      position: 0,
      name: 'Timer report',
      duration_minutes: 2,
      role_slot_id: 10,
      _role_slot_key: 'slot-10'
    }
  ]
};

describe('EditorPage accessible row delete controls', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/app/meetings/42/edit?tab=roles');
    roles.mockReset().mockResolvedValue([{ id: 1, name: 'Timer', voting_group: '', is_bookable: true }]);
    venues.mockReset().mockResolvedValue([{ id: 1, name: 'B26 Room 1.1B' }]);
    attendees.mockReset().mockResolvedValue([]);
    meetingsGet.mockReset().mockResolvedValue(meeting);
    meetingsTemplates.mockReset().mockResolvedValue([]);
    usersList.mockReset().mockResolvedValue([]);
    navigate.mockReset();
  });

  it('exposes an accessible delete button for the Timer role', async () => {
    render(<EditorPage params={{ id: '42' }} />);

    const deleteButton = await screen.findByRole('button', { name: 'Delete Timer role' });
    expect(deleteButton).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Delete Timer role' })).toHaveLength(1);

    fireEvent.click(deleteButton);

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Delete Timer role' })).toBeNull());
  });

  it('exposes an accessible delete button for the Timer report session', async () => {
    window.history.replaceState({}, '', '/app/meetings/42/edit?tab=sessions');
    render(<EditorPage params={{ id: '42' }} />);

    const deleteButton = await screen.findByRole('button', { name: 'Delete Timer report session' });
    expect(deleteButton).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Delete Timer report session' })).toHaveLength(1);

    fireEvent.click(deleteButton);

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Delete Timer report session' })).toBeNull());
  });

  it('toggles the swiped state on a role row with touch swipes', async () => {
    render(<EditorPage params={{ id: '42' }} />);

    const getRow = () => screen.getByText('Timer').closest('[data-drag-type="role"]');
    await screen.findByText('Timer');
    const main = getRow().querySelector('.editor-row-main');
    const dispatchMouse = (target, type, init) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: init.clientX, clientY: init.clientY, button: 0, buttons: 1 });
      Object.defineProperty(event, 'pointerId', { value: init.pointerId });
      Object.defineProperty(event, 'pointerType', { value: init.pointerType });
      target.dispatchEvent(event);
    };

    dispatchMouse(main, 'mousedown', { pointerType: 'touch', pointerId: 1, clientX: 100, clientY: 20 });
    dispatchMouse(main, 'mouseup', { pointerType: 'touch', pointerId: 1, clientX: 60, clientY: 20 });
    await waitFor(() => expect(getRow().classList.contains('swiped')).toBe(true));

    dispatchMouse(main, 'mousedown', { pointerType: 'touch', pointerId: 2, clientX: 60, clientY: 20 });
    dispatchMouse(main, 'mouseup', { pointerType: 'touch', pointerId: 2, clientX: 90, clientY: 20 });
    await waitFor(() => expect(getRow().classList.contains('swiped')).toBe(false));
  });
});
