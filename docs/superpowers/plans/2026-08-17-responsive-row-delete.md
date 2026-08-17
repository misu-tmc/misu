# Responsive Role and Session Row Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show an accessible cross-mark delete button on every role and session row, persistently on wide layouts and through the existing swipe reveal on compact layouts.

**Architecture:** Keep deletion and gesture state inside the existing `EditorPage` component. Add row-specific accessible names and responsive hint markup in JSX, then adapt the existing `.editor-row-delete` CSS at the established 701px management-layout breakpoint; no API, model, or dependency changes are needed.

**Tech Stack:** Preact, Testing Library for Preact, Vitest, plain responsive CSS, Vite

---

## File Structure

- Create `apps/spa/src/pages/EditorPage.test.jsx`: focused rendering and interaction coverage for role/session delete controls and touch swipe state.
- Modify `apps/spa/src/pages/EditorPage.jsx`: accessible cross-mark button content, row-specific labels, and compact-only swipe hint spans.
- Modify `apps/spa/css/components.css`: compact hidden/revealed action styling, keyboard focus visibility, and persistent wide-layout positioning.

### Task 1: Accessible Row Delete Controls

**Files:**
- Create: `apps/spa/src/pages/EditorPage.test.jsx`
- Modify: `apps/spa/src/pages/EditorPage.jsx:606-672`

- [ ] **Step 1: Write failing role, session, and swipe interaction tests**

Create `apps/spa/src/pages/EditorPage.test.jsx` with:

```jsx
import { fireEvent, render, screen } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getRoles,
  getVenues,
  getUsers,
  getTemplates,
  getMeeting,
  getAttendees,
  navigate
} = vi.hoisted(() => ({
  getRoles: vi.fn(),
  getVenues: vi.fn(),
  getUsers: vi.fn(),
  getTemplates: vi.fn(),
  getMeeting: vi.fn(),
  getAttendees: vi.fn(),
  navigate: vi.fn()
}));

vi.mock('wouter-preact', () => ({
  useLocation: () => ['/app/meetings/42/edit', navigate]
}));

vi.mock('../lib/api.js', () => ({
  catalogApi: {
    roles: getRoles,
    venues: getVenues
  },
  checkinApi: {
    attendees: getAttendees
  },
  meetingsApi: {
    get: getMeeting,
    templates: getTemplates
  },
  usersApi: {
    list: getUsers
  }
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
  venue: 'B26 Room 1.1B',
  status: 'draft',
  role_slots: [
    {
      id: 10,
      role_id: 3,
      role_name: 'Timer',
      label: 'Timer',
      custom_label: '',
      voting_group: '',
      is_optional: false,
      is_bookable: true,
      taker_id: 7,
      taker_name: 'Test Member'
    }
  ],
  sessions: [
    {
      id: 20,
      position: 0,
      group_label: '',
      name: 'Timer report',
      duration_minutes: 2,
      role_slot_id: 10
    }
  ]
};

async function renderTab(tabName) {
  const result = render(<EditorPage params={{ id: '42' }} />);
  await screen.findByRole('heading', { name: '#142 Regular Meeting' });
  fireEvent.click(screen.getByRole('button', { name: tabName }));
  return result;
}

describe('EditorPage row deletion', () => {
  beforeEach(() => {
    getRoles.mockReset().mockResolvedValue([
      { id: 3, name: 'Timer', voting_group: '', is_bookable: true }
    ]);
    getVenues.mockReset().mockResolvedValue([]);
    getUsers.mockReset().mockResolvedValue([
      { id: 7, display_name: 'Test Member' }
    ]);
    getTemplates.mockReset().mockResolvedValue([]);
    getMeeting.mockReset().mockResolvedValue(meeting);
    getAttendees.mockReset().mockResolvedValue([]);
    navigate.mockReset();
  });

  it('removes the selected role through its accessible delete control', async () => {
    const { container } = await renderTab('Roles');
    expect(container.querySelectorAll('[data-drag-type="role"]')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Delete Timer role' }));

    expect(container.querySelectorAll('[data-drag-type="role"]')).toHaveLength(0);
  });

  it('removes the selected session through its accessible delete control', async () => {
    const { container } = await renderTab('Sessions');
    expect(container.querySelectorAll('[data-drag-type="session"]')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Delete Timer report session' }));

    expect(container.querySelectorAll('[data-drag-type="session"]')).toHaveLength(0);
  });

  it('reveals and closes the delete control with horizontal touch swipes', async () => {
    const { container } = await renderTab('Roles');
    const row = container.querySelector('[data-drag-type="role"]');
    const rowMain = row.querySelector('.editor-row-main');

    fireEvent.pointerDown(rowMain, {
      pointerType: 'touch',
      pointerId: 1,
      clientX: 100,
      clientY: 20
    });
    fireEvent.pointerUp(rowMain, {
      pointerType: 'touch',
      pointerId: 1,
      clientX: 60,
      clientY: 20
    });
    expect(row.classList.contains('swiped')).toBe(true);

    fireEvent.pointerDown(rowMain, {
      pointerType: 'touch',
      pointerId: 2,
      clientX: 60,
      clientY: 20
    });
    fireEvent.pointerUp(rowMain, {
      pointerType: 'touch',
      pointerId: 2,
      clientX: 90,
      clientY: 20
    });
    expect(row.classList.contains('swiped')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run from `apps/spa`:

```powershell
npm test -- src/pages/EditorPage.test.jsx
```

Expected: the role and session tests fail because the current buttons have no accessible names, while the swipe test passes against the existing gesture behavior.

- [ ] **Step 3: Add row-specific labels and cross-mark content**

In the role row in `apps/spa/src/pages/EditorPage.jsx`, replace the current delete button with:

```jsx
<button
  class="editor-row-delete"
  type="button"
  aria-label={`Delete ${slot.role_name || slot.custom_label || slot.label || 'unnamed'} role`}
  title="Delete"
  onClick={() => {
    setMeeting((current) => ({
      ...current,
      role_slots: current.role_slots.filter((_, slotIndex) => slotIndex !== index)
    }));
    setExpandedRole(null);
    setSwipedRow(null);
  }}
>
  <span aria-hidden="true">×</span>
</button>
```

In the session row, replace the current delete button with:

```jsx
<button
  class="editor-row-delete"
  type="button"
  aria-label={`Delete ${session.name || 'unnamed'} session`}
  title="Delete"
  onClick={() => {
    setMeeting((current) => ({
      ...current,
      sessions: current.sessions.filter((_, sessionIndex) => sessionIndex !== index)
    }));
    setExpandedSession(null);
    setSwipedRow(null);
  }}
>
  <span aria-hidden="true">×</span>
</button>
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run from `apps/spa`:

```powershell
npm test -- src/pages/EditorPage.test.jsx
```

Expected: all three tests pass.

- [ ] **Step 5: Commit the accessible controls**

```powershell
git add -- apps/spa/src/pages/EditorPage.jsx apps/spa/src/pages/EditorPage.test.jsx
git commit -m "feat(spa): add accessible row delete controls" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 2: Responsive Delete Presentation

**Files:**
- Modify: `apps/spa/src/pages/EditorPage.test.jsx`
- Modify: `apps/spa/src/pages/EditorPage.jsx:606-643`
- Modify: `apps/spa/css/components.css:705-749`
- Modify: `apps/spa/css/components.css:917-922`

- [ ] **Step 1: Write a failing test for compact-only swipe guidance**

Append this test inside the existing `describe` block in `apps/spa/src/pages/EditorPage.test.jsx`:

```jsx
it('marks swipe guidance for compact-layout presentation', async () => {
  await renderTab('Roles');

  expect(screen.getByText('· swipe a row for Delete').classList.contains('editor-swipe-hint')).toBe(true);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run from `apps/spa`:

```powershell
npm test -- src/pages/EditorPage.test.jsx
```

Expected: the new test fails because the swipe text is currently part of the unclassified hint paragraph.

- [ ] **Step 3: Isolate compact-only hint text in the JSX**

Replace the Roles panel hint with:

```jsx
<p class="editor-list-hint">
  {meeting.role_slots.length} role slots · drag ⋮⋮ to reorder
  <span class="editor-swipe-hint"> · swipe a row for Delete</span>
</p>
```

Replace the Sessions panel hint with:

```jsx
<p class="editor-list-hint">
  Start times auto-computed · drag ⋮⋮ to reorder
  <span class="editor-swipe-hint"> · swipe a row for Delete</span>
</p>
```

- [ ] **Step 4: Implement compact and wide delete-button CSS**

Replace the existing `.editor-row-delete` and swipe rules in `apps/spa/css/components.css` with:

```css
.editor-row-delete {
  position: absolute; top: 50%; right: 10px; transform: translateY(-50%);
  display: grid; place-items: center; width: 36px; height: 36px; padding: 0;
  border: 0; border-radius: 50%;
  opacity: 0; pointer-events: none; transition: opacity .18s;
  background: #fdecec; color: #c62828; font: 400 20px/1 var(--font); cursor: pointer;
}
.editor-row-delete:focus-visible {
  opacity: 1; pointer-events: auto; outline: 2px solid #5b2a86; outline-offset: 2px;
}
.editor-row.swiped .editor-row-main { opacity: .3; }
.editor-row.swiped .editor-row-delete { opacity: 1; pointer-events: auto; }
```

Add these rules inside the existing `@media (min-width: 701px)` block:

```css
.editor-row-delete {
  position: static; flex: 0 0 36px; transform: none;
  opacity: 1; pointer-events: auto; background: transparent;
}
.editor-row.swiped .editor-row-main { opacity: 1; }
.editor-swipe-hint { display: none; }
```

- [ ] **Step 5: Run the focused test and verify it passes**

Run from `apps/spa`:

```powershell
npm test -- src/pages/EditorPage.test.jsx
```

Expected: all four editor tests pass.

- [ ] **Step 6: Verify both responsive states in the browser**

Start the SPA from `apps/spa`:

```powershell
npm run dev -- --host 127.0.0.1
```

Open an existing meeting editor and verify:

1. At 701px or wider, every role and session row shows a cross at its right edge.
2. At 700px or narrower, the cross is visually hidden until a left touch swipe.
3. The compact swipe hint is hidden at 701px and visible at 700px.
4. Keyboard focus makes the compact hidden delete control visible.
5. Clicking either role or session cross removes only that row; Save persists the deletion.

- [ ] **Step 7: Run the complete SPA validation**

Run from `apps/spa`:

```powershell
npm run validate
```

Expected: all Vitest tests pass, the Vite production build succeeds, and distribution validation succeeds.

- [ ] **Step 8: Commit the responsive presentation**

```powershell
git add -- apps/spa/src/pages/EditorPage.jsx apps/spa/src/pages/EditorPage.test.jsx apps/spa/css/components.css
git commit -m "feat(spa): adapt row delete actions by width" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
