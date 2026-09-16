import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { meetingsApi } from '../lib/api.js';

const TEMPLATE_URL = '/static/main-slides/main-agenda-template.pptx';
const POWERPOINT_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

export function PowerPointDownloadButton({ meetingId, onError, disabled = false }) {
  const [generating, setGenerating] = useState(false);
  const request = useRef(null);
  const downloads = useRef(new Map());

  useLayoutEffect(() => {
    setGenerating(false);
    return () => {
      request.current?.abort();
      request.current = null;
    };
  }, [meetingId]);

  useEffect(() => {
    return () => {
      for (const [url, timer] of downloads.current) {
        clearTimeout(timer);
        URL.revokeObjectURL(url);
      }
      downloads.current.clear();
    };
  }, []);

  async function downloadPowerPoint() {
    if (disabled || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    const current = () => request.current === controller && !controller.signal.aborted;
    setGenerating(true);
    onError('');
    try {
      const latest = await meetingsApi.get(meetingId);
      if (!current()) return;
      const response = await fetch(TEMPLATE_URL, { signal: controller.signal });
      if (!response.ok) throw new Error(`Could not load the PowerPoint template (HTTP ${response.status}).`);
      const template = await response.arrayBuffer();
      if (!current()) return;
      const { buildMainAgendaPptx, mainAgendaPptxFilename } = await import('../lib/pptxTemplate.js');
      const bytes = await buildMainAgendaPptx(template, latest);
      if (!current()) return;
      const url = URL.createObjectURL(new Blob([bytes], { type: POWERPOINT_MIME }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = mainAgendaPptxFilename(latest);
      document.body.appendChild(anchor);
      try {
        anchor.click();
      } finally {
        anchor.remove();
        downloads.current.set(url, setTimeout(() => {
          URL.revokeObjectURL(url);
          downloads.current.delete(url);
        }, 60000));
      }
    } catch (err) {
      if (current()) onError(err.message || 'Could not generate PowerPoint.');
    } finally {
      if (current()) {
        request.current = null;
        setGenerating(false);
      }
    }
  }

  return (
    <button
      class="btn btn-ghost btn-sm"
      type="button"
      title="Downloads the latest saved meeting. Save your changes first to include them."
      disabled={disabled || generating}
      aria-busy={generating}
      onClick={downloadPowerPoint}
    >
      {generating ? 'Generating PowerPoint...' : 'Download PowerPoint'}
    </button>
  );
}
