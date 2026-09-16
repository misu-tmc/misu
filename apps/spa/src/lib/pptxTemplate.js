import template from './mainSlidesTemplate.json' with { type: 'json' };
import { buildMainSlidePlan } from './agendaSlides.js';
import { fitSlideParagraph, meetingSlideTitle } from './slides.js';
import { parseXml, readFixedSlideBlocks, replacePresentationSlides } from './pptxPackage.js';

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

export async function buildMainAgendaPptx(templateBytes, meeting = {}) {
  const { default: JSZip } = await import('jszip');
  let zip;
  try {
    zip = await JSZip.loadAsync(templateBytes);
  } catch (error) {
    throw new Error(`Main slides template error: Invalid PPTX ZIP (${error.message}).`, { cause: error });
  }
  const fixedBlocks = await readFixedSlideBlocks(zip);
  for (const part of Object.values(fixedBlocks).flat()) {
    const file = zip.file(part);
    if (!file) throw new Error(`Main slides template error: Missing '${part}'.`);
    const doc = parseXml(await file.async('string'), part, 'sld');
    if (markerShapes(doc).length) throw new Error(`Main slides template error: Fixed slide '${part}' contains meeting fields.`);
  }
  const docs = new Map();
  for (const [name, definition] of Object.entries(template.layouts)) {
    const doc = parseXml(definition.xml, `layout '${name}'`, 'sld');
    const actual = markerShapes(doc).map(({ marker }) => marker).sort();
    const expected = definition.fields.map(({ marker }) => marker).sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`Main slides template error: Incorrect field markers in layout '${name}'.`);
    }
    docs.set(name, doc);
  }

  const serializer = new XMLSerializer();
  const pages = buildMainSlidePlan(meeting).flatMap((slide) => {
    if (slide.kind === 'static') {
      return fixedBlocks[slide.block].map((source) => ({ source }));
    }
    const definition = template.layouts[slide.layout];
    if (!definition) throw new Error(`Main slides template error: Missing layout '${slide.layout}'.`);
    const doc = docs.get(slide.layout).cloneNode(true);
    const variant = slide.variant ? definition.variants?.[slide.variant] : null;
    if (slide.variant && !variant) throw new Error(`Main slides template error: Missing variant '${slide.variant}'.`);
    for (const override of variant?.shapeProperties || []) {
      const location = markerShapes(doc).find((item) => item.marker === override.marker);
      if (!location) throw new Error(`Main slides template error: Missing variant field '${override.marker}'.`);
      const properties = parseXml(override.xml, `variant '${slide.variant}'`, 'spPr');
      location.shape.getElementsByTagNameNS(PRESENTATION_NS, 'spPr')[0].replaceWith(doc.importNode(properties.documentElement, true));
    }
    const fields = variant?.fields || definition.fields;
    for (const { marker, shape } of markerShapes(doc)) {
      const field = fields.find((item) => item.marker === marker);
      if (!field) throw new Error(`Main slides template error: Missing text metrics for '${marker}'.`);
      const values = slide.fields[marker.replace('MISU_FIELD:', '')];
      if (!values) throw new Error(`Main slides template error: Missing values for '${marker}'.`);
      replaceParagraphs(shape, values, field);
    }
    doc.documentElement.removeAttribute('show');
    return { xml: serializer.serializeToString(doc), relationships: definition.relationships, notes: definition.notes };
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
