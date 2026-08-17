import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const componentsCss = readFileSync(resolve(process.cwd(), 'css/components.css'), 'utf8');

const { getMeeting, toPng } = vi.hoisted(() => ({
  getMeeting: vi.fn(),
  toPng: vi.fn()
}));

vi.mock('../lib/api.js', () => ({
  meetingsApi: { get: getMeeting }
}));

vi.mock('html-to-image', () => ({ toPng }));

import { AgendaPage } from './AgendaPage.jsx';

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
  role_slots: [
    { id: 10, role_name: 'Timer', taker_id: 7, taker_name: 'Test Member' }
  ],
  sessions: [
    { id: 20, position: 0, name: 'Timer report', duration_minutes: 2, role_slot_id: 10 }
  ]
};

describe('AgendaPage', () => {
  beforeEach(() => {
    getMeeting.mockReset().mockResolvedValue(meeting);
    toPng.mockReset().mockResolvedValue('data:image/png;base64,agenda');
    vi.spyOn(window, 'print').mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  it('allows the agenda body to grow with both sheets', () => {
    expect(componentsCss).toMatch(
      /body\.agenda-print-layout\s*\{[^}]*\bheight:\s*auto;/
    );
  });

  it('renders the printable meeting and export controls', async () => {
    render(<AgendaPage params={{ id: '42' }} />);

    expect(await screen.findByRole('heading', { name: 'Regular Meeting #142' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Editor' }).getAttribute('href')).toBe('/app/meetings/42/edit');

    fireEvent.click(screen.getByRole('button', { name: 'Save PDF' }));
    expect(window.print).toHaveBeenCalledOnce();
  });

  it('exports both agenda sheets as PNG files', async () => {
    render(<AgendaPage params={{ id: '42' }} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Save PNGs' }));

    await waitFor(() => expect(toPng).toHaveBeenCalledTimes(2));
    expect(toPng.mock.calls[0][0].classList.contains('print-agenda-sheet')).toBe(true);
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(2);
  });

  it('renders colorful core-value cycles on page 2', async () => {
    const { container } = render(<AgendaPage params={{ id: '42' }} />);
    await screen.findByRole('heading', { name: 'Regular Meeting #142' });

    const values = [...container.querySelectorAll('.print-agenda-value')].map((item) => ({
      initial: item.querySelector('.print-agenda-value-mark')?.textContent,
      label: item.querySelector('.print-agenda-value-label')?.textContent,
      accent: [...item.classList].find((name) => name.startsWith('accent-'))
    }));

    expect(values).toEqual([
      { initial: 'I', label: 'Integrity', accent: 'accent-navy' },
      { initial: 'R', label: 'Respect', accent: 'accent-orange' },
      { initial: 'S', label: 'Service', accent: 'accent-green' },
      { initial: 'E', label: 'Excellence', accent: 'accent-blue' }
    ]);
  });

  it('renders colorful Pathways boundaries on page 2', async () => {
    const { container } = render(<AgendaPage params={{ id: '42' }} />);
    await screen.findByRole('heading', { name: 'Regular Meeting #142' });

    const levels = [...container.querySelectorAll('.print-agenda-levels > span')].map((item) => ({
      text: item.textContent,
      accent: [...item.classList].find((name) => name.startsWith('accent-'))
    }));

    expect(levels).toEqual([
      { text: '1Public Speaking', accent: 'accent-navy' },
      { text: '2Interpersonal Communication', accent: 'accent-blue' },
      { text: '3Strategic Leadership', accent: 'accent-orange' },
      { text: '4Management', accent: 'accent-green' },
      { text: '5Confidence', accent: 'accent-muted' }
    ]);
  });
});
