import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mainSlidesMeeting as meeting } from '../test/fixtures/mainSlidesMeeting.js';

const { getMeeting, generate } = vi.hoisted(() => ({ getMeeting: vi.fn(), generate: vi.fn() }));
vi.mock('../lib/api.js', () => ({ meetingsApi: { get: getMeeting } }));
vi.mock('../lib/pptxTemplate.js', () => ({
  buildMainAgendaPptx: generate,
  mainAgendaPptxFilename: (meeting) => `MISU Main Agenda ${meeting.number}.pptx`
}));
import { PowerPointDownloadButton } from './PowerPointDownloadButton.jsx';

const onError = vi.fn();

beforeEach(() => {
  getMeeting.mockReset().mockResolvedValue(meeting);
  generate.mockReset().mockResolvedValue(new Uint8Array([1, 2, 3]));
  onError.mockReset();
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

describe('PowerPointDownloadButton', () => {
  it('shows generating status immediately, blocks repeat clicks and downloads the saved meeting', async () => {
    let finish;
    generate.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const { unmount } = render(<PowerPointDownloadButton meetingId={44} onError={onError} />);
    expect(getMeeting).not.toHaveBeenCalled();
    const latest = { ...meeting, title: 'Latest saved meeting', number: 145 };
    getMeeting.mockResolvedValue(latest);
    fireEvent.click(screen.getByRole('button', { name: 'Download PowerPoint' }));
    const busyButton = screen.getByRole('button', { name: 'Generating PowerPoint...' });
    expect(busyButton.disabled).toBe(true);
    expect(busyButton.getAttribute('aria-busy')).toBe('true');
    await waitFor(() => expect(generate).toHaveBeenCalledOnce());
    fireEvent.click(busyButton);
    expect(getMeeting).toHaveBeenCalledTimes(1);
    await act(async () => { finish(new Uint8Array([1, 2, 3])); });
    await waitFor(() => expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce());
    expect(generate).toHaveBeenCalledWith(expect.any(ArrayBuffer), latest);
    expect(getMeeting).toHaveBeenCalledWith(44);
    expect(fetch).toHaveBeenCalledWith('/static/main-slides/main-agenda-template.pptx', { signal: expect.any(AbortSignal) });
    const anchor = HTMLAnchorElement.prototype.click.mock.contexts[0];
    expect(anchor.download).toBe('MISU Main Agenda 145.pptx');
    expect(anchor.href).toBe('blob:main-slides');
    const [blob] = URL.createObjectURL.mock.calls[0];
    expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.presentationml.presentation');
    const buffer = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(blob);
    });
    expect(new Uint8Array(buffer)).toEqual(new Uint8Array([1, 2, 3]));
    expect(screen.getByRole('button', { name: 'Download PowerPoint' }).disabled).toBe(false);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:main-slides');
  });

  it('surfaces template failures and allows retry without downloading invalid files', async () => {
    render(<PowerPointDownloadButton meetingId={44} onError={onError} />);
    fetch.mockResolvedValueOnce({ ok: false, status: 404 });
    fireEvent.click(screen.getByRole('button', { name: 'Download PowerPoint' }));
    await waitFor(() => expect(onError).toHaveBeenLastCalledWith(expect.stringContaining('HTTP 404')));
    expect(generate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Download PowerPoint' }));
    await waitFor(() => expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce());
  });

  it('ignores a stale in-flight download after navigation to a different meeting', async () => {
    let finish;
    generate.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const { rerender } = render(<PowerPointDownloadButton meetingId={44} onError={onError} />);
    fireEvent.click(screen.getByRole('button', { name: 'Download PowerPoint' }));
    await waitFor(() => expect(generate).toHaveBeenCalledOnce());
    getMeeting.mockResolvedValue({ ...meeting, id: 45, number: 145 });
    rerender(<PowerPointDownloadButton meetingId={45} onError={onError} />);
    await act(async () => { finish(new Uint8Array([4, 5])); });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Download PowerPoint' }).disabled).toBe(false));
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
  });

  it('surfaces native generation errors without downloading a broken deck', async () => {
    generate.mockRejectedValueOnce(new Error('Slide text is too long to fit.'));
    render(<PowerPointDownloadButton meetingId={44} onError={onError} />);
    fireEvent.click(screen.getByRole('button', { name: 'Download PowerPoint' }));
    await waitFor(() => expect(onError).toHaveBeenLastCalledWith('Slide text is too long to fit.'));
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Download PowerPoint' }).disabled).toBe(false);
  });

  it('cancels unfinished generation when the containing page is closed', async () => {
    let finish;
    generate.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const { unmount } = render(<PowerPointDownloadButton meetingId={44} onError={onError} />);
    fireEvent.click(screen.getByRole('button', { name: 'Download PowerPoint' }));
    await waitFor(() => expect(generate).toHaveBeenCalledOnce());
    const { signal } = fetch.mock.calls[0][1];
    unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => { finish(new Uint8Array([4, 5])); });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
  });
});
