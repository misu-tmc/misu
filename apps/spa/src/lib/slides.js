import template from './mainSlidesTemplate.json' with { type: 'json' };
import { buildMainSlidePlan } from './agendaSlides.js';

export { template as mainSlidesTemplate };

// Rounded-up Arial glyph advances at 1000px, for ASCII 32-126. Shared metrics
// keep browser previews and non-browser PPTX generation independent of the DOM.
const ARIAL_WIDTHS = [
  278,278,355,557,557,890,667,191,334,334,390,584,278,334,278,278,
  557,557,557,557,557,557,557,557,557,557,278,278,584,584,584,557,
  1016,667,667,723,723,667,611,778,723,278,500,667,557,834,723,778,
  667,778,723,667,611,723,667,944,667,667,611,278,278,278,470,557,
  334,557,557,500,557,557,278,557,557,223,223,500,223,834,557,557,
  557,557,334,500,278,557,500,723,500,500,500,334,260,334,584
];
const ARIAL_BOLD_WIDTHS = [
  278,334,475,557,557,890,723,238,334,334,390,584,278,334,278,278,
  557,557,557,557,557,557,557,557,557,557,334,334,584,584,584,611,
  976,723,723,723,723,667,611,778,723,278,557,723,611,834,723,778,
  667,778,723,667,611,723,667,944,667,667,611,334,278,334,584,557,
  334,557,611,557,611,557,334,611,611,278,278,557,278,890,611,611,
  611,611,390,557,334,611,557,778,557,557,500,390,280,390,584
];

export function meetingSlideTitle(meeting) {
  const title = String(meeting.title || 'Regular Meeting').trim();
  const number = String(meeting.number ?? '').trim();
  return number && !title.includes(`#${number}`) ? `${title} #${number}` : title;
}

function textWidth(text, style) {
  const advances = style.bold ? ARIAL_BOLD_WIDTHS : ARIAL_WIDTHS;
  const margin = style.fontFamily?.toLowerCase() === 'arial' ? 1.01 : 1.15;
  return Array.from(text).reduce((width, letter) => {
    const code = letter.codePointAt(0);
    const advance = code >= 32 && code <= 126 ? advances[code - 32] / 1000 : code > 0xffff ? 2 : 1;
    return width + advance * margin;
  }, 0);
}

function lineCount(text, width, style) {
  const space = textWidth(' ', style);
  return text.split(/\r\n|\r|\n/).reduce((total, paragraph) => {
    let lines = 1;
    let used = 0;
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const length = textWidth(word, style);
      if (used && used + space + length > width) {
        lines += 1;
        used = 0;
      }
      if (length > width) {
        lines += Math.ceil(length / width) - 1;
        used = length % width || width;
      } else {
        used += (used ? space : 0) + length;
      }
    }
    return total + lines;
  }, 0);
}

export function fitSlideParagraph(text, paragraph) {
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) throw new Error('Slide text contains unsupported control characters.');
  const { width, fontSize } = paragraph;
  const lineHeight = paragraph.lineHeight || 1.2;
  const height = Math.max(paragraph.height, paragraph.sourceBounds?.height || 0, fontSize * lineHeight * (paragraph.sourceLineCount || 1));
  if (!(width > 0 && height > 0 && fontSize > 0)) throw new Error('Main slides template error: Invalid text dimensions.');
  let size = fontSize;
  while (size >= 8 && lineCount(text, width / size, paragraph) * size * lineHeight > height) size -= 0.5;
  if (size < 8) throw new Error('Slide text is too long to fit. Shorten the session title or role-taker name.');
  return size;
}

export function buildMainAgendaSlides(meeting) {
  return buildMainSlidePlan(meeting).map((slide) => {
    const source = template.slides.find((item) => item.number === slide.template);
    if (!source) throw new Error(`Main slides template error: Missing slide ${slide.template}.`);
    return {
      ...slide,
      title: slide.title || source.title,
      description: source.description || '',
      image: source.image,
      width: template.width,
      height: template.height,
      text: source.fields.flatMap((field) => {
        const name = field.marker.replace('MISU_FIELD:', '');
        const values = slide.fields?.[name];
        if (!values) throw new Error(`Main slides template error: Missing values for '${name}'.`);
        return field.paragraphs.map((paragraph, index) => {
          const text = String(values[index] ?? '');
          return { ...paragraph, text, fontSize: text ? fitSlideParagraph(text, paragraph) : paragraph.fontSize };
        });
      })
    };
  });
}
