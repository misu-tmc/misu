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
  it('shows the faithful reference preview, keyboard navigation and a readable transcript', async () => {
    const { container } = render(<SlidesPage params={{ id: '44' }} />);
    await screen.findByRole('heading', { name: 'Regular Meeting #144' });
    expect(screen.getByRole('status').textContent).toContain('Slide 1 of 39');
    expect(screen.getByRole('link', { name: 'Printed agenda' }).getAttribute('href')).toBe('/app/meetings/44/agenda');
    expect(container.querySelector('.reference-slide-background').getAttribute('src')).toBe('/static/main-slides/reference-slide-01.png');
    for (let index = 0; index < 4; index += 1) fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByRole('status').textContent).toContain('Warm Up - Slide 5 of 39');
    expect([...container.querySelectorAll('.reference-slide-text')].map((p) => p.textContent)).toEqual(['Warm Up', 'Warmup Host']);
    fireEvent.keyDown(window, { key: 'End' });
    expect(screen.getByRole('button', { name: 'Next slide' }).disabled).toBe(true);
    fireEvent.keyDown(window, { key: 'Home' });
    expect(screen.getByRole('button', { name: 'Previous slide' }).disabled).toBe(true);
  });

  it('does not steal presentation keys from interactive controls', async () => {
    render(<SlidesPage params={{ id: '44' }} />);
    await screen.findByRole('heading', { name: 'Regular Meeting #144' });
    const button = screen.getByRole('button', { name: 'Download PowerPoint' });
    fireEvent.keyDown(button, { key: ' ' });
    fireEvent.keyDown(button, { key: 'ArrowRight' });
    expect(screen.getByRole('status').textContent).toContain('Slide 1 of 39');
  });

  it('downloads the latest saved meeting, updates the preview and cleans up the blob', async () => {
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

  it('shows load failures and unsupported fullscreen errors', async () => {
    getMeeting.mockRejectedValueOnce(new Error('Meeting not found'));
    const { unmount } = render(<SlidesPage params={{ id: '44' }} />);
    expect(await screen.findByText('Meeting not found')).toBeTruthy();
    unmount();
    render(<SlidesPage params={{ id: '44' }} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Present fullscreen' }));
    expect((await screen.findByRole('alert')).textContent).toContain('not supported');
  });
});
