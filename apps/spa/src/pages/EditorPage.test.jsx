import { act, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Local PointerEvent shim — keeps pointer-event support out of global setup.js
if (!globalThis.PointerEvent) {
  class TestPointerEvent extends MouseEvent {
    constructor(type, init = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.pointerType = init.pointerType ?? '';
    }
  }
  globalThis.PointerEvent = TestPointerEvent;
}

// jsdom omits onpointerdown/up/cancel properties on elements, so Preact would
// register 'PointerDown' (capital) instead of 'pointerdown'. Stub them so
// Preact detects the lowercase name and uses addEventListener('pointerdown', …).
const _pointerPropNames = ['onpointerdown', 'onpointerup', 'onpointercancel', 'onpointermove'];
const _savedPointerDescs = {};
const pointerShimInstalled = !('onpointerdown' in document.createElement('div'));
if (pointerShimInstalled) {
  for (const evtName of _pointerPropNames) {
    _savedPointerDescs[evtName] = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, evtName);
    Object.defineProperty(window.HTMLElement.prototype, evtName, {
      get() { return null; },
      set() {},
      configurable: true
    });
  }
}
afterAll(() => {
  if (!pointerShimInstalled) return;
  for (const evtName of _pointerPropNames) {
    if (_savedPointerDescs[evtName]) {
      Object.defineProperty(window.HTMLElement.prototype, evtName, _savedPointerDescs[evtName]);
    } else {
      delete window.HTMLElement.prototype[evtName];
    }
  }
});

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
  useLocation: () => [`${window.location.pathname}${window.location.search}`, navigate]
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

  it('shows swipe-hint text inside an editor-swipe-hint element on the Roles tab', async () => {
    const { container } = render(<EditorPage params={{ id: '42' }} />);

    await screen.findByText('Timer');
    const hint = container.querySelector('.editor-swipe-hint');
    expect(hint).toBeTruthy();
    expect(hint.textContent).toContain('· swipe a row for Delete');
  });

  it('toggles the swiped state on a role row with touch swipes', async () => {
    render(<EditorPage params={{ id: '42' }} />);

    const getRow = () => screen.getByText('Timer').closest('[data-drag-type="role"]');
    await screen.findByText('Timer');
    const rowMain = getRow().querySelector('.editor-row-main');

    fireEvent(rowMain, new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', pointerId: 1, clientX: 100, clientY: 20 }));
    fireEvent(rowMain, new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch', pointerId: 1, clientX: 60, clientY: 20 }));
    await waitFor(() => expect(getRow().classList.contains('swiped')).toBe(true));

    fireEvent(rowMain, new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', pointerId: 2, clientX: 60, clientY: 20 }));
    fireEvent(rowMain, new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch', pointerId: 2, clientX: 90, clientY: 20 }));
    await waitFor(() => expect(getRow().classList.contains('swiped')).toBe(false));
  });
});

const ROW_TOP = 200;
const ROW_HEIGHT = 40;
const GRAB_OFFSET = 10;
const EMPTY_RECT = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) };

// The row is held `GRAB_OFFSET` below its own top, so it trails the pointer by
// exactly that much wherever its layout slot currently is.
const shiftAfterMoving = (distance) => `translateY(${distance - GRAB_OFFSET}px)`;

// jsdom has no layout, so lay the rows out on a virtual grid that follows the
// live DOM order and the applied transform, the way a browser would measure it.
function stubRowLayout(container) {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function measure() {
    const rows = Array.from(container.querySelectorAll('[data-drag-type]'));
    const position = rows.indexOf(this);
    if (position < 0) return EMPTY_RECT;
    const shift = Number(/translateY\((-?[\d.]+)px\)/.exec(this.style.transform || '')?.[1] || 0);
    const top = ROW_TOP + position * ROW_HEIGHT + shift;
    return { ...EMPTY_RECT, top, bottom: top + ROW_HEIGHT, height: ROW_HEIGHT, y: top };
  });
}

function stubAnimationFrames() {
  const frames = new Map();
  let nextId = 1;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    const id = nextId++;
    frames.set(id, callback);
    return id;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => { frames.delete(id); });
  return async function flushFrames() {
    const pending = Array.from(frames.values());
    frames.clear();
    await act(async () => { pending.forEach((callback) => callback(0)); });
  };
}

const dragMeeting = {
  ...meeting,
  role_slots: [
    { id: 10, _key: 'slot-10', role_name: 'Timer', label: 'Timer', custom_label: '', taker_id: null, taker_name: '' },
    { id: 11, _key: 'slot-11', role_name: 'Chair', label: 'Chair', custom_label: '', taker_id: null, taker_name: '' },
    { id: 12, _key: 'slot-12', role_name: 'Grammarian', label: 'Grammarian', custom_label: '', taker_id: null, taker_name: '' }
  ],
  sessions: []
};

describe('EditorPage row reordering', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/app/meetings/42/edit?tab=roles');
    roles.mockReset().mockResolvedValue([]);
    venues.mockReset().mockResolvedValue([]);
    attendees.mockReset().mockResolvedValue([]);
    meetingsGet.mockReset().mockResolvedValue(dragMeeting);
    meetingsTemplates.mockReset().mockResolvedValue([]);
    usersList.mockReset().mockResolvedValue([]);
    navigate.mockReset();
  });

  afterEach(() => vi.restoreAllMocks());

  async function startRoleDrag(container) {
    await screen.findByText('Timer');
    const flushFrames = stubAnimationFrames();
    stubRowLayout(container);
    const order = () => Array.from(container.querySelectorAll('[data-drag-type="role"] .row-summary-copy strong'))
      .map((node) => node.textContent);
    const row = container.querySelector('[data-drag-type="role"]');
    fireEvent(row.querySelector('.drag-handle'), new PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, pointerType: 'touch', pointerId: 7, clientY: ROW_TOP + GRAB_OFFSET
    }));
    await waitFor(() => expect(row.classList.contains('dragging')).toBe(true));
    return { flushFrames, order, row };
  }

  function movePointer(clientY) {
    fireEvent(document, new PointerEvent('pointermove', {
      bubbles: true, cancelable: true, pointerType: 'touch', pointerId: 7, clientY
    }));
  }

  it('keeps reordering while the pointer leaves the drag handle and the row moves in the DOM', async () => {
    const { container } = render(<EditorPage params={{ id: '42' }} />);
    const { flushFrames, order, row } = await startRoleDrag(container);
    expect(order()).toEqual(['Timer', 'Chair', 'Grammarian']);

    movePointer(ROW_TOP + 65);
    await flushFrames();
    expect(order()).toEqual(['Chair', 'Timer', 'Grammarian']);
    expect(row.style.transform).toBe(shiftAfterMoving(65));

    movePointer(ROW_TOP + 105);
    await flushFrames();
    expect(order()).toEqual(['Chair', 'Grammarian', 'Timer']);
    // The row already sits one slot lower, so its visible offset drops by a row.
    expect(row.style.transform).toBe(shiftAfterMoving(105 - ROW_HEIGHT));

    fireEvent(document, new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch', pointerId: 7, clientY: ROW_TOP + 105 }));
    await waitFor(() => expect(row.classList.contains('dragging')).toBe(false));
    expect(order()).toEqual(['Chair', 'Grammarian', 'Timer']);
    expect(row.style.transform).toBe('');
  });

  it('leaves the order untouched until the pointer crosses the neighbour midpoint', async () => {
    const { container } = render(<EditorPage params={{ id: '42' }} />);
    const { flushFrames, order, row } = await startRoleDrag(container);

    movePointer(ROW_TOP + 50);
    await flushFrames();
    expect(order()).toEqual(['Timer', 'Chair', 'Grammarian']);
    expect(row.style.transform).toBe(shiftAfterMoving(50));

    movePointer(ROW_TOP + 61);
    await flushFrames();
    expect(order()).toEqual(['Chair', 'Timer', 'Grammarian']);

    fireEvent(document, new PointerEvent('pointercancel', { bubbles: true, pointerType: 'touch', pointerId: 7, clientY: ROW_TOP + 61 }));
    await waitFor(() => expect(row.classList.contains('dragging')).toBe(false));
  });

  it('moves the row back when the pointer returns above the neighbour midpoint', async () => {
    const { container } = render(<EditorPage params={{ id: '42' }} />);
    const { flushFrames, order } = await startRoleDrag(container);

    movePointer(ROW_TOP + 65);
    await flushFrames();
    expect(order()).toEqual(['Chair', 'Timer', 'Grammarian']);

    movePointer(ROW_TOP + 15);
    await flushFrames();
    expect(order()).toEqual(['Timer', 'Chair', 'Grammarian']);
  });
});
