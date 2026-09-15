import { useEffect, useRef, useState } from 'preact/hooks';
import { Link } from 'wouter-preact';
import { PageError, PageLoading } from '../components/PageState.jsx';
import { meetingsApi } from '../lib/api.js';
import { meetingSlideTitle } from '../lib/slides.js';
import '../../css/slides.css';

const TEMPLATE_URL = '/static/main-slides/main-agenda-template.pptx';
const POWERPOINT_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

export function SlidesPage({ params }) {
  const meetingId = Number(params.id);
  const [meeting, setMeeting] = useState(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [generating, setGenerating] = useState(false);
  const request = useRef(null);
  const downloads = useRef(new Map());

  useEffect(() => {
    let active = true;
    setMeeting(null);
    setError('');
    setGenerating(false);
    meetingsApi.get(meetingId).then((detail) => {
      if (!active) return;
      setMeeting(detail);
    }).catch((err) => {
      if (active) setError(err.message || 'Could not load the meeting.');
    });
    return () => {
      active = false;
      request.current?.abort();
      request.current = null;
    };
  }, [meetingId, retry]);

  useEffect(() => {
    return () => {
      for (const [url, timer] of downloads.current) {
        clearTimeout(timer);
        URL.revokeObjectURL(url);
      }
      downloads.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!meeting) return;
    const previous = document.title;
    document.title = `MISU Slides - ${meetingSlideTitle(meeting)}`;
    return () => { document.title = previous; };
  }, [meeting]);

  async function downloadPowerPoint() {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    const current = () => request.current === controller && !controller.signal.aborted;
    setGenerating(true);
    setError('');
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
      setMeeting(latest);
    } catch (err) {
      if (current()) setError(err.message || 'Could not generate PowerPoint.');
    } finally {
      if (current()) {
        request.current = null;
        setGenerating(false);
      }
    }
  }

  if (error && !meeting) return <PageError message={error} onRetry={() => setRetry((value) => value + 1)} />;
  if (!meeting) return <PageLoading label="Loading meeting..." />;
  return (
    <section class="main-slides" aria-label="Main slide download">
      <nav class="main-slides-toolbar" aria-label="Download actions">
        <Link class="btn btn-ghost btn-sm" href={`/app/meetings/${meetingId}/agenda`}>Printed agenda</Link>
        <button class="btn btn-primary btn-sm" type="button" disabled={generating} onClick={downloadPowerPoint}>
          {generating ? 'Generating PowerPoint...' : 'Download PowerPoint'}
        </button>
      </nav>
      <h1 class="main-slides-meeting">{meetingSlideTitle(meeting)}</h1>
      <p class="main-slides-hint">Download an editable PowerPoint from the latest saved agenda, preserving the original slide layouts and animations.</p>
      {error && <p class="error-msg" role="alert">{error}</p>}
    </section>
  );
}
