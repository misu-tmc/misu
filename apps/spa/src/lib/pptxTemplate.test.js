import { readFileSync } from 'node:fs';
import { resolve, posix } from 'node:path';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { mainSlidesMeeting as meeting } from '../test/fixtures/mainSlidesMeeting.js';
import template from './mainSlidesTemplate.json';
import { buildMainSlidePlan } from './agendaSlides.js';
import { buildMainAgendaSlides } from './slides.js';
import { buildMainAgendaPptx, mainAgendaPptxFilename } from './pptxTemplate.js';

const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const seed = new Uint8Array(readFileSync(resolve(process.cwd(), '../backend/static/main-slides/main-agenda-template.pptx')));
const source = await JSZip.loadAsync(seed);

async function xml(zip, name) {
  const entry = zip.file(name);
  expect(entry, name).toBeTruthy();
  const doc = new DOMParser().parseFromString(await entry.async('string'), 'application/xml');
  expect(doc.getElementsByTagName('parsererror'), name).toHaveLength(0);
  return doc;
}

async function slideParts(zip) {
  const rels = await xml(zip, 'ppt/_rels/presentation.xml.rels');
  const byId = new Map(Array.from(rels.documentElement.children).map((rel) => [
    rel.getAttribute('Id'), decodeURIComponent(new URL(rel.getAttribute('Target'), 'https://pptx.invalid/ppt/presentation.xml').pathname.slice(1))
  ]));
  const doc = await xml(zip, 'ppt/presentation.xml');
  return Array.from(doc.getElementsByTagNameNS(P, 'sldId')).map((node) => byId.get(node.getAttributeNS(R, 'id')));
}

function text(doc) {
  return Array.from(doc.getElementsByTagNameNS(A, 't')).map((node) => node.textContent).join('\n');
}

function fields(doc) {
  return Object.fromEntries(Array.from(doc.getElementsByTagNameNS(P, 'sp')).flatMap((shape) => {
    const name = shape.getElementsByTagNameNS(P, 'cNvPr')[0]?.getAttribute('name');
    return name?.startsWith('MISU_FIELD:') ? [[name.slice('MISU_FIELD:'.length),
      Array.from(shape.getElementsByTagNameNS(A, 'p')).map((p) => Array.from(p.getElementsByTagNameNS(A, 't')).map((t) => t.textContent).join(''))
    ]] : [];
  }));
}

async function generate(data = meeting, bytes = seed) {
  const result = await buildMainAgendaPptx(bytes, data);
  expect(result).toBeInstanceOf(Uint8Array);
  return JSZip.loadAsync(result);
}

describe('reference PowerPoint generation', () => {
  it('ships all reference layouts and matching preview images without stale meeting placeholders', async () => {
    expect(await slideParts(source)).toHaveLength(39);
    expect(template.slides).toHaveLength(39);
    for (const slide of template.slides) {
      const doc = await xml(source, `ppt/slides/slide${slide.number}.xml`);
      expect(Object.keys(fields(doc)).sort()).toEqual(slide.fields.map((field) => field.marker.slice('MISU_FIELD:'.length)).sort());
      expect(readFileSync(resolve(process.cwd(), `../backend${slide.image}`)).length).toBeGreaterThan(1000);
    }
  });

  it('generates the reference sequence with every meeting field replaced and static artwork unchanged', async () => {
    const result = await generate();
    const parts = await slideParts(result);
    expect(parts).toHaveLength(39);
    const plan = buildMainSlidePlan(meeting);
    const preview = buildMainAgendaSlides(meeting);
    for (const [index, page] of plan.entries()) {
      const doc = await xml(result, parts[index]);
      if (page.fields) {
        expect(doc.documentElement.getAttribute('show')).not.toBe('0');
        const actual = fields(doc);
        for (const [field, values] of Object.entries(page.fields)) {
          expect(actual[field].slice(0, values.length)).toEqual(values);
          expect(actual[field].slice(values.length).every((value) => value === '')).toBe(true);
        }
        expect(Object.values(actual).flat().filter(Boolean)).toEqual(preview[index].text.map((p) => p.text).filter(Boolean));
        expect(text(doc)).not.toContain('TBD');
      } else {
        expect(await result.file(parts[index]).async('string')).toBe(await source.file(`ppt/slides/slide${page.template}.xml`).async('string'));
      }
    }
    for (const name of Object.keys(source.files).filter((part) => /^ppt\/(?:media|slideMasters|slideLayouts|theme)\//.test(part))) {
      if (source.files[name].dir) continue;
      expect(Buffer.from(await result.file(name).async('uint8array')).equals(Buffer.from(await source.file(name).async('uint8array'))), name).toBe(true);
    }
    expect(fields(await xml(result, parts[37]))['appreciation.manager']).toEqual(['Meeting Manager', 'Meeting Organizer']);
    expect((await xml(result, parts[37])).getElementsByTagNameNS(P, 'pic')).toHaveLength(0);
    expect(text(await xml(result, parts[37]))).toContain('MO');
  }, 30000);

  it('updates slide indexes, counts and notes backlinks without dangling relationships or unlisted slides', async () => {
    const result = await generate();
    const parts = await slideParts(result);
    expect(new Set(parts).size).toBe(parts.length);
    expect(Object.keys(result.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).sort()).toEqual([...parts].sort());
    const ids = Array.from((await xml(result, 'ppt/presentation.xml')).getElementsByTagNameNS(P, 'sldId'));
    expect(new Set(ids.map((node) => node.getAttribute('id'))).size).toBe(parts.length);
    expect(new Set(ids.map((node) => node.getAttributeNS(R, 'id'))).size).toBe(parts.length);
    for (const name of Object.keys(result.files).filter((part) => part.endsWith('.rels'))) {
      const owner = name === '_rels/.rels' ? '' : name.replace('_rels/', '').replace(/\.rels$/, '');
      for (const rel of (await xml(result, name)).documentElement.children) {
        if (rel.getAttribute('TargetMode') === 'External') continue;
        const target = decodeURIComponent(rel.getAttribute('Target').split('#')[0]);
        const resolved = target.startsWith('/') ? target.slice(1) : posix.normalize(posix.join(posix.dirname(owner), target));
        expect(result.file(resolved), `${name} -> ${resolved}`).toBeTruthy();
        if (rel.getAttribute('Type').endsWith('/notesSlide')) {
          const notesRels = await xml(result, resolved.replace('notesSlides/', 'notesSlides/_rels/') + '.rels');
          const backlink = Array.from(notesRels.documentElement.children).find((node) => node.getAttribute('Type').endsWith('/slide'));
          expect(new URL(backlink.getAttribute('Target'), `https://pptx.invalid/${resolved}`).pathname.slice(1)).toBe(owner);
        }
      }
    }
    const props = await xml(result, 'docProps/app.xml');
    expect(props.getElementsByTagName('Slides')[0].textContent).toBe('39');
    expect(props.getElementsByTagName('HiddenSlides')[0].textContent).toBe('3');
  }, 30000);

  it('escapes XML characters and fits long multilingual replacements without altering the seed', async () => {
    const changed = {
      ...meeting, theme: 'A & B < C > D "Quotes"',
      role_slots: meeting.role_slots.map((slot) => ({
        ...slot,
        taker_name: `New & <${slot.id}>`,
        speech: slot.speech && { ...slot.speech, title: '\u6c9f\u901a\u4e0e\u9886\u5bfc\u529b '.repeat(9).trim() }
      }))
    };
    const result = await generate(changed);
    const parts = await slideParts(result);
    expect(fields(await xml(result, parts[24])).session).toEqual([changed.role_slots[5].speech.title, 'New & <6>']);
    expect(fields(await xml(result, parts[28])).session[0]).toBe(changed.theme);
    expect(buildMainAgendaSlides(changed)[24].text[0].fontSize).toBeLessThan(template.slides[24].fields[0].paragraphs[0].fontSize);
    expect(text(await xml(source, 'ppt/slides/slide25.xml'))).not.toContain('New &');
    await expect(generate({ ...changed, role_slots: changed.role_slots.map((slot) => slot.id === 6 ? { ...slot, speech: { title: 'x'.repeat(100000) } } : slot) })).rejects.toThrow(/too long to fit/);
  }, 30000);

  it('handles more than 30 sessions, odd evaluation counts and missing roles without previous-meeting data', async () => {
    const changed = {
      ...meeting, role_slots: [],
      sessions: Array.from({ length: 35 }, (_, index) => ({ id: index, position: index, name: `New item ${index + 1}`, role_slot_id: null }))
    };
    const result = await generate(changed);
    const parts = await slideParts(result);
    expect(parts).toHaveLength(56);
    const allText = (await Promise.all(parts.map(async (part) => text(await xml(result, part))))).join('\n');
    expect(allText).toContain('New item 35');
    expect(allText).not.toContain('First Speaker');
    expect(allText).not.toContain('Warmup Host');
    expect(fields(await xml(result, parts[parts.length - 2]))['appreciation.photographer']).toEqual(['Photographer', 'TBD']);
    expect(await slideParts(await generate({ ...changed, sessions: [] }))).toHaveLength(21);
  }, 30000);

  it('rejects invalid templates and makes safe meeting-specific filenames', async () => {
    await expect(buildMainAgendaPptx(new Uint8Array([1, 2]), meeting)).rejects.toThrow(/Invalid PPTX ZIP/);
    const corrupt = await JSZip.loadAsync(seed);
    corrupt.file('ppt/slides/slide5.xml', (await corrupt.file('ppt/slides/slide5.xml').async('string')).replace('MISU_FIELD:session', 'MISU_FIELD:unknown'));
    await expect(buildMainAgendaPptx(await corrupt.generateAsync({ type: 'uint8array' }), meeting)).rejects.toThrow(/field markers on slide 5/);
    expect(mainAgendaPptxFilename(meeting)).toBe('MISU Main Agenda 144.pptx');
    expect(mainAgendaPptxFilename({ number: '../144:*?' })).toBe('MISU Main Agenda .. 144.pptx');
  }, 30000);
});
