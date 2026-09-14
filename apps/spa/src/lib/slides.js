import template from './mainSlidesTemplate.json' with { type: 'json' };
import { buildMainSlidePlan } from './agendaSlides.js';

export { template as mainSlidesTemplate };

export function meetingSlideTitle(meeting) {
  const title = String(meeting.title || 'Regular Meeting').trim();
  const number = String(meeting.number ?? '').trim();
  return number && !title.includes(`#${number}`) ? `${title} #${number}` : title;
}

function textWidth(text) {
  return Array.from(text).reduce((width, letter) => width + (
    /\s/.test(letter) ? 0.3 : /[ilI.,'!:;|]/.test(letter) ? 0.3 : /[MW@%]/.test(letter) ? 0.95
      : letter.codePointAt(0) > 0x2ff ? 1 : /[A-Z]/.test(letter) ? 0.72 : 0.58
  ), 0);
}

function lineCount(text, width) {
  return text.split(/\r\n|\r|\n/).reduce((total, paragraph) => {
    let lines = 1;
    let used = 0;
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const length = textWidth(word);
      if (used && used + 0.3 + length > width) {
        lines += 1;
        used = 0;
      }
      if (length > width) {
        lines += Math.ceil(length / width) - 1;
        used = length % width || width;
      } else {
        used += (used ? 0.3 : 0) + length;
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
  while (size >= 8 && lineCount(text, width / size) * size * lineHeight > height) size -= 0.5;
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
