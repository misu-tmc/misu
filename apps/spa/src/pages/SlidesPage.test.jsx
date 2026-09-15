import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mainSlidesMeeting as meeting } from '../test/fixtures/mainSlidesMeeting.js';

const { getMeeting, generate } = vi.hoisted(() => ({ getMeeting: vi.fn(), generate: vi.fn() }));
vi.mock('../lib/api.js', () => ({ meetingsApi: { get: getMeeting } }));
vi.mock('../lib/pptxTemplate.js', () => ({
  buildMainAgendaPptx: generate,
  mainAgendaPptxFilename: (meeting) => `MISU Main Agenda ${meeting.number}.pptx`
}));
import { SlidesPage } from './SlidesPage.jsx';

beforeEach(() => {
  getMeeting.mockReset().mockResolvedValue(meeting);
  generate.mockReset().mockResolvedValue(new Uint8Array([1, 2, 3]));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(2) }));
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:main-slides');
    static revokeObjectURL = vi.fn();
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('SlidesPage', () => {
  it('offers a PowerPoint download without a preview, images or presentation controls', async () => {
    const { container } = render(<SlidesPage params={{ id: '44' }} />);
    await screen.findByRole('heading', { name: 'Regular Meeting #144' });
    expect(screen.getByRole('link', { name: 'Printed agenda' }).getAttribute('href')).toBe('/app/meetings/44/agenda');
    expect(screen.getByRole('region', { name: 'Main slide download' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download PowerPoint' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /fullscreen|Next slide|Previous slide/i })).toBeNull();
    expect(screen.queryByText('Slide text')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it('leaves browser navigation and scrolling keys alone', async () => {
    render(<SlidesPage params={{ id: '44' }} />);
    await screen.findByRole('heading', { name: 'Regular Meeting #144' });
    for (const key of [' ', 'ArrowRight', 'ArrowLeft', 'Home', 'End', 'PageUp', 'PageDown']) {
      const event = new KeyboardEvent('keydown', { key, cancelable: true });
      window.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
  });

  it('downloads the latest saved meeting, updates its title and cleans up the blob', async () => {
    const { unmount } = render(<SlidesPage params={{ id: '44' }} />);
    await screen.findByRole('heading', { name: 'Regular Meeting #144' });
    const latest = { ...meeting, title: 'Latest saved meeting', number: 145 };
    getMeeting.mockResolvedValue(latest);
    fireEvent.click(screen.getByRole('button', { name: 'Download PowerPoint' }));
    await waitFor(() => expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce());
    expect(generate).toHaveBeenCalledWith(expect.any(ArrayBuffer), latest);
    expect(getMeeting).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledWith('/static/main-slides/main-agenda-template.pptx', { signal: expect.any(AbortSignal) });
    expect(screen.getByRole('heading', { name: 'Latest saved meeting #145' })).toBeTruthy();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:main-slides');
  });

  it('surfaces template failures and allows retry without downloading invalid files', async () => {
    render(<SlidesPage params={{ id: '44' }} />);
    await screen.findByRole('heading', { name: 'Regular Meeting #144' });
    fetch.mockResolvedValueOnce({ ok: false, status: 404 });
    fireEvent.click(screen.getByRole('button', { name: 'Download PowerPoint' }));
    expect((await screen.findByRole('alert')).textContent).toContain('HTTP 404');
    expect(generate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Download PowerPoint' }));
    await waitFor(() => expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce());
  });

  it('ignores a stale in-flight download after navigation to a different meeting', async () => {
    let finish;
    generate.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const { rerender } = render(<SlidesPage params={{ id: '44' }} />);
    await screen.findByRole('heading', { name: 'Regular Meeting #144' });
    fireEvent.click(screen.getByRole('button', { name: 'Download PowerPoint' }));
    await waitFor(() => expect(generate).toHaveBeenCalledOnce());
    getMeeting.mockResolvedValue({ ...meeting, id: 45, number: 145 });
    rerender(<SlidesPage params={{ id: '45' }} />);
    await screen.findByRole('heading', { name: 'Regular Meeting #145' });
    finish(new Uint8Array([4, 5]));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Download PowerPoint' }).disabled).toBe(false));
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
  });

  it('shows load failures and allows retry', async () => {
    getMeeting.mockRejectedValueOnce(new Error('Meeting not found'));
    render(<SlidesPage params={{ id: '44' }} />);
    expect(await screen.findByText('Meeting not found')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Regular Meeting #144' })).toBeTruthy();
  });

  it('surfaces native generation errors without downloading a broken deck', async () => {
    generate.mockRejectedValueOnce(new Error('Slide text is too long to fit.'));
    render(<SlidesPage params={{ id: '44' }} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Download PowerPoint' }));
    expect((await screen.findByRole('alert')).textContent).toContain('too long to fit');
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Download PowerPoint' }).disabled).toBe(false);
  });
});
