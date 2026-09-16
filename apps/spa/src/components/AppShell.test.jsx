import { render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { AppShell } from './AppShell.jsx';

describe('AppShell navigation', () => {
  afterEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it.each([
    ['/app/meetings', 'Meeting'],
    ['/app/meetings/', 'Meeting'],
    ['/app/meetings?scope=open#upcoming', 'Meeting'],
    ['/app/meetings/new', 'Meeting'],
    ['/app/meetings/42', 'Meeting'],
    ['/app/meetings/42/edit?tab=roles', 'Meeting'],
    ['/app/meetings/42/agenda/', 'Meeting'],
    ['/app/meetings/42/slides', 'Meeting'],
    ['/app/meetings/42/other', 'Meeting'],
    ['/app/booking', 'Booking'],
    ['/app/booking/other', 'Booking'],
    ['/app/misu', 'MISU'],
    ['/app/misu/meetings', 'MISU'],
    ['/app/misu/users', 'MISU'],
    ['/app/me', 'Me'],
    ['/app/me/other', 'Me'],
    ['/app/meetings-old', null],
    ['/app/meeting', null],
    ['/app/misunderstood', null],
    ['/app/checkin', null],
    ['/app/vote/42', null],
    ['/app/vote-result/42', null]
  ])('uses exact-or-child matching at %s', async (path, activeTab) => {
    window.history.replaceState({}, '', path);
    render(<AppShell />);

    const main = within(screen.getByRole('navigation', { name: 'Main navigation' }));
    expect(main.getAllByRole('link').filter((link) => link.classList.contains('active'))
      .map((link) => link.textContent)).toEqual(activeTab && activeTab !== 'Me' ? [activeTab] : []);
    expect(main.getByRole('link', { name: 'Meeting' }).getAttribute('href')).toBe('/app/meetings');

    await waitFor(() => expect(document.body.classList.contains('attendee-layout')).toBe(!!activeTab));
    const tabs = screen.queryByRole('navigation', { name: 'Tab navigation' });
    if (!activeTab) {
      expect(tabs).toBeNull();
      return;
    }
    const navigation = within(tabs);
    expect(navigation.getAllByRole('link').map((link) => link.textContent))
      .toEqual(['Booking', 'Meeting', 'MISU', 'Me']);
    expect(navigation.getAllByRole('link').filter((link) => link.classList.contains('active'))
      .map((link) => link.textContent)).toEqual([activeTab]);
    expect(navigation.getByRole('link', { name: 'Meeting' }).getAttribute('href')).toBe('/app/meetings');
  });
});
