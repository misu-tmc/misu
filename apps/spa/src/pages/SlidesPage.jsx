import { useEffect, useRef, useState } from 'preact/hooks';
import { Link } from 'wouter-preact';
import { PageError, PageLoading } from '../components/PageState.jsx';
import { meetingsApi } from '../lib/api.js';
import { buildMainAgendaSlides, meetingSlideTitle } from '../lib/slides.js';
import '../../css/slides.css';

const TEMPLATE_URL = '/static/main-slides/main-agenda-template.pptx';
const POWERPOINT_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

function interactive(target) {
  return target instanceof Element && !!target.closest('a, button, input, select, textarea, [contenteditable="true"], [role="button"]');
}

function ReferenceSlide({ slide }) {
  return (
    <div class="reference-slide">
      <img class="reference-slide-background" src={slide.image} alt={slide.description || slide.title} />
      {slide.portraits?.map((portrait) => (
        <span key={portrait.pictureId} class="reference-slide-portrait" aria-hidden="true" style={{
          left: `${portrait.left / slide.width * 100}%`,
          top: `${portrait.top / slide.height * 100}%`,
          width: `${portrait.width / slide.width * 100}%`,
          height: `${portrait.height / slide.height * 100}%`,
          fontSize: `${64 / slide.width * 100}cqw`
        }}>{portrait.initials}</span>
      ))}
      {slide.text.map((paragraph, index) => (
        <p key={index} class="reference-slide-text" style={{
          left: `${paragraph.left / slide.width * 100}%`,
          top: `${paragraph.top / slide.height * 100}%`,
          width: `${paragraph.width / slide.width * 100}%`,
          minHeight: `${paragraph.height / slide.height * 100}%`,
          fontSize: `${paragraph.fontSize / slide.width * 100}cqw`,
          fontFamily: `${paragraph.fontFamily}, Arial, sans-serif`,
          fontWeight: paragraph.bold ? 700 : 400,
          fontStyle: paragraph.italic ? 'italic' : 'normal',
          lineHeight: paragraph.lineHeight || 1.2,
          textAlign: paragraph.align,
          color: paragraph.color
        }}>{paragraph.text}</p>
      ))}
    </div>
  );
}

export function SlidesPage({ params }) {
  const meetingId = Number(params.id);
  const [meeting, setMeeting] = useState(null);
  const [slides, setSlides] = useState([]);
  const [error, setError] = useState('');
  const [index, setIndex] = useState(0);
  const [retry, setRetry] = useState(0);
  const [generating, setGenerating] = useState(false);
  const surface = useRef(null);
  const currentSlides = useRef(slides);
  currentSlides.current = slides;
  const request = useRef(null);
  const downloads = useRef(new Map());

  useEffect(() => {
    let active = true;
    setMeeting(null);
    setSlides([]);
    setError('');
    setGenerating(false);
    meetingsApi.get(meetingId).then((detail) => {
      const nextSlides = buildMainAgendaSlides(detail);
      if (!active) return;
      setMeeting(detail);
      setSlides(nextSlides);
      setIndex(0);
    }).catch((err) => {
      if (active) setError(err.message || 'Could not load the meeting slides.');
    });
    return () => {
      active = false;
      request.current?.abort();
      request.current = null;
    };
  }, [meetingId, retry]);

  useEffect(() => {
    document.body.classList.add('main-slides-layout');
    return () => {
      document.body.classList.remove('main-slides-layout');
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

  useEffect(() => {
    const navigate = (event) => {
      const count = currentSlides.current.length;
      if (!count || event.altKey || event.ctrlKey || event.metaKey || interactive(event.target)) return;
      if (['ArrowRight', 'PageDown', ' '].includes(event.key)) {
        event.preventDefault();
        setIndex((current) => Math.min(current + 1, count - 1));
      } else if (['ArrowLeft', 'PageUp'].includes(event.key)) {
        event.preventDefault();
        setIndex((current) => Math.max(current - 1, 0));
      } else if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        setIndex(event.key === 'Home' ? 0 : count - 1);
      }
    };
    window.addEventListener('keydown', navigate);
    return () => window.removeEventListener('keydown', navigate);
  }, []);

  useEffect(() => {
    if (slides[index + 1]) {
      const image = new Image();
      image.src = slides[index + 1].image;
    }
  }, [slides, index]);

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
      const nextSlides = buildMainAgendaSlides(latest);
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
      setSlides(nextSlides);
      setIndex((value) => Math.min(value, nextSlides.length - 1));
    } catch (err) {
      if (current()) setError(err.message || 'Could not generate PowerPoint.');
    } finally {
      if (current()) {
        request.current = null;
        setGenerating(false);
      }
    }
  }

  async function fullscreen() {
    setError('');
    try {
      if (!surface.current?.requestFullscreen) throw new Error('Fullscreen presentation is not supported by this browser.');
      await surface.current.requestFullscreen();
      surface.current.focus();
    } catch (err) {
      setError(err.message || 'Could not enter fullscreen.');
    }
  }

  if (error && !meeting) return <PageError message={error} onRetry={() => setRetry((value) => value + 1)} />;
  if (!meeting) return <PageLoading label="Loading meeting slides..." />;
  const slide = slides[index];
  return (
    <section class="main-slides" aria-label="Main agenda presentation">
      <nav class="main-slides-toolbar" aria-label="Presentation actions">
        <Link class="btn btn-ghost btn-sm" href={`/app/meetings/${meetingId}/agenda`}>Printed agenda</Link>
        <button class="btn btn-primary btn-sm" type="button" disabled={generating} onClick={downloadPowerPoint}>
          {generating ? 'Generating PowerPoint...' : 'Download PowerPoint'}
        </button>
        <button class="btn btn-secondary btn-sm" type="button" onClick={fullscreen}>Present fullscreen</button>
      </nav>
      <h1 class="main-slides-meeting">{meetingSlideTitle(meeting)}</h1>
      <p class="main-slides-hint">Uses the latest saved agenda. PowerPoint preserves the original animations and editable text.</p>
      {error && <p class="error-msg" role="alert">{error}</p>}
      <div class="main-slides-surface" ref={surface} tabIndex={-1} aria-label="Presentation slide">
        <ReferenceSlide slide={slide} />
        <footer class="main-slides-controls">
          <button type="button" aria-label="Previous slide" disabled={index === 0} onClick={() => setIndex((value) => value - 1)}>Previous</button>
          <p role="status" aria-live="polite" aria-atomic="true">{slide.title} - Slide {index + 1} of {slides.length}</p>
          <button type="button" aria-label="Next slide" disabled={index === slides.length - 1} onClick={() => setIndex((value) => value + 1)}>Next</button>
        </footer>
      </div>
      <details class="main-slides-transcript">
        <summary>Slide text</summary>
        {slide.description && <p>{slide.description}</p>}
        {slide.text.filter((paragraph) => paragraph.text).map((paragraph, index) => <p key={index}>{paragraph.text}</p>)}
      </details>
    </section>
  );
}
