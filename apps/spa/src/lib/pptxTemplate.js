import template from './mainSlidesTemplate.json' with { type: 'json' };
import { buildMainSlidePlan } from './agendaSlides.js';
import { fitSlideParagraph, meetingSlideTitle } from './slides.js';
import { parseXml, replacePresentationSlides } from './pptxPackage.js';

const PRESENTATION_NS = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const DRAWING_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';

export function mainAgendaPptxFilename(meeting) {
  const identifier = String(meeting?.number ?? meeting?.date ?? meeting?.id ?? 'meeting')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/g, '');
  return `MISU Main Agenda${identifier ? ` ${identifier}` : ''}.pptx`;
}

function markerShapes(doc) {
  return Array.from(doc.getElementsByTagNameNS(PRESENTATION_NS, 'sp')).flatMap((shape) => {
    const marker = shape.getElementsByTagNameNS(PRESENTATION_NS, 'cNvPr')[0]?.getAttribute('name');
    return marker?.startsWith('MISU_FIELD:') ? [{ marker, shape }] : [];
  });
}

function replaceParagraphs(shape, values, field) {
  const paragraphs = Array.from(shape.getElementsByTagNameNS(DRAWING_NS, 'p'));
  if (paragraphs.length !== field.paragraphs.length || values.length > paragraphs.length) {
    throw new Error(`Main slides template error: Incorrect paragraph count for '${field.marker}'.`);
  }
  paragraphs.forEach((paragraph, index) => {
    const value = String(values[index] ?? '');
    const nodes = Array.from(paragraph.getElementsByTagNameNS(DRAWING_NS, 't'));
    if (value && !nodes.length) throw new Error(`Main slides template error: Missing text run for '${field.marker}'.`);
    if (nodes.length) nodes[0].textContent = value;
    for (const node of nodes.slice(1)) node.textContent = '';
    const style = field.paragraphs[index];
    const size = value ? fitSlideParagraph(value, style) : style.fontSize;
    if (size < style.fontSize) {
      for (const tag of ['rPr', 'endParaRPr', 'defRPr']) {
        for (const node of Array.from(paragraph.getElementsByTagNameNS(DRAWING_NS, tag))) {
          node.setAttribute('sz', String(Math.round(size * 100)));
        }
      }
    }
  });
}

function replaceRolePortraits(doc, portraits = []) {
  const create = (namespace, name, attributes = {}) => {
    const node = doc.createElementNS(namespace, name);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    return node;
  };
  for (const portrait of portraits) {
    const picture = Array.from(doc.getElementsByTagNameNS(PRESENTATION_NS, 'pic')).find(
      (node) => node.getElementsByTagNameNS(PRESENTATION_NS, 'cNvPr')[0]?.getAttribute('id') === portrait.pictureId
    );
    if (!picture) throw new Error(`Main slides template error: Missing portrait for '${portrait.role}'.`);
    const shape = create(PRESENTATION_NS, 'p:sp');
    const properties = create(PRESENTATION_NS, 'p:nvSpPr');
    properties.append(
      create(PRESENTATION_NS, 'p:cNvPr', { id: portrait.pictureId, name: `MISU_ROLE_PORTRAIT:${portrait.role}` }),
      create(PRESENTATION_NS, 'p:cNvSpPr'),
      create(PRESENTATION_NS, 'p:nvPr')
    );
    const geometry = picture.getElementsByTagNameNS(PRESENTATION_NS, 'spPr')[0].cloneNode(true);
    geometry.getElementsByTagNameNS(DRAWING_NS, 'prstGeom')[0].setAttribute('prst', 'ellipse');
    const fill = create(DRAWING_NS, 'a:solidFill');
    fill.appendChild(create(DRAWING_NS, 'a:srgbClr', { val: 'D9E8EE' }));
    const line = create(DRAWING_NS, 'a:ln');
    line.appendChild(create(DRAWING_NS, 'a:noFill'));
    geometry.append(fill, line);
    const body = create(PRESENTATION_NS, 'p:txBody');
    body.append(
      create(DRAWING_NS, 'a:bodyPr', { anchor: 'ctr', lIns: '0', rIns: '0', tIns: '0', bIns: '0' }),
      create(DRAWING_NS, 'a:lstStyle')
    );
    const paragraph = create(DRAWING_NS, 'a:p');
    paragraph.appendChild(create(DRAWING_NS, 'a:pPr', { algn: 'ctr' }));
    const run = create(DRAWING_NS, 'a:r');
    const style = create(DRAWING_NS, 'a:rPr', { sz: '6400', b: '1' });
    const textFill = create(DRAWING_NS, 'a:solidFill');
    textFill.appendChild(create(DRAWING_NS, 'a:srgbClr', { val: '073946' }));
    style.append(textFill, create(DRAWING_NS, 'a:latin', { typeface: 'Arial' }));
    const text = create(DRAWING_NS, 'a:t');
    text.textContent = portrait.initials;
    run.append(style, text);
    paragraph.appendChild(run);
    body.appendChild(paragraph);
    shape.append(properties, geometry, body);
    picture.replaceWith(shape);
  }
}

export async function buildMainAgendaPptx(templateBytes, meeting = {}) {
  const { default: JSZip } = await import('jszip');
  let zip;
  try {
    zip = await JSZip.loadAsync(templateBytes);
  } catch (error) {
    throw new Error(`Main slides template error: Invalid PPTX ZIP (${error.message}).`, { cause: error });
  }
  const docs = new Map();
  for (const slide of template.slides) {
    const part = `ppt/slides/slide${slide.number}.xml`;
    const file = zip.file(part);
    if (!file) throw new Error(`Main slides template error: Missing '${part}'.`);
    const doc = parseXml(await file.async('string'), part, 'sld');
    const actual = markerShapes(doc).map(({ marker }) => marker).sort();
    const expected = slide.fields.map(({ marker }) => marker).sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`Main slides template error: Incorrect field markers on slide ${slide.number}. Regenerate the template from the reference deck.`);
    }
    docs.set(slide.number, doc);
  }

  const serializer = new XMLSerializer();
  const pages = buildMainSlidePlan(meeting).map((slide) => {
    const source = `ppt/slides/slide${slide.template}.xml`;
    if (!slide.fields) return { source };
    const doc = docs.get(slide.template).cloneNode(true);
    const fields = template.slides.find((item) => item.number === slide.template).fields;
    for (const { marker, shape } of markerShapes(doc)) {
      const field = fields.find((item) => item.marker === marker);
      const values = slide.fields[marker.replace('MISU_FIELD:', '')];
      if (!values) throw new Error(`Main slides template error: Missing values for '${marker}'.`);
      replaceParagraphs(shape, values, field);
    }
    replaceRolePortraits(doc, slide.portraits);
    doc.documentElement.removeAttribute('show');
    return { source, xml: serializer.serializeToString(doc) };
  });
  await replacePresentationSlides(zip, pages);
  if (zip.file('docProps/core.xml')) {
    const doc = parseXml(await zip.file('docProps/core.xml').async('string'), 'docProps/core.xml', 'coreProperties');
    const dc = 'http://purl.org/dc/elements/1.1/';
    for (const [field, text] of [['title', meetingSlideTitle(meeting)], ['subject', String(meeting.theme || '')]]) {
      let node = doc.getElementsByTagNameNS(dc, field)[0];
      if (!node) {
        node = doc.createElementNS(dc, `dc:${field}`);
        doc.documentElement.appendChild(node);
      }
      node.textContent = text;
    }
    zip.file('docProps/core.xml', serializer.serializeToString(doc));
  }
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}
