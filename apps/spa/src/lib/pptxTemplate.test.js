import { readFileSync } from 'node:fs';
import { resolve, posix } from 'node:path';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { mainSlidesMeeting as meeting } from '../test/fixtures/mainSlidesMeeting.js';
import template from './mainSlidesTemplate.json';
import { buildMainSlidePlan } from './agendaSlides.js';
import { fitSlideParagraph } from './slides.js';
import { buildMainAgendaPptx, mainAgendaPptxFilename } from './pptxTemplate.js';
import { readFixedSlideBlocks } from './pptxPackage.js';

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

function writeXml(zip, name, doc) {
  zip.file(name, new XMLSerializer().serializeToString(doc));
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

function fieldFontSize(doc, field) {
  const shape = Array.from(doc.getElementsByTagNameNS(P, 'sp')).find(
    (node) => node.getElementsByTagNameNS(P, 'cNvPr')[0]?.getAttribute('name') === `MISU_FIELD:${field}`
  );
  expect(shape).toBeTruthy();
  return Number(shape.getElementsByTagNameNS(A, 'rPr')[0].getAttribute('sz'));
}

async function slidesWithField(zip, field) {
  const slides = [];
  for (const part of await slideParts(zip)) {
    const doc = await xml(zip, part);
    const values = fields(doc)[field];
    if (values) slides.push({ doc, values });
  }
  return slides;
}

async function generate(data = meeting, bytes = seed) {
  const result = await buildMainAgendaPptx(bytes, data);
  expect(result).toBeInstanceOf(Uint8Array);
  return JSZip.loadAsync(result);
}

describe('reference PowerPoint generation', () => {
  it('ships only fixed slides, with no TBD pages or preallocated agenda slots', async () => {
    const listed = await slideParts(source);
    const blocks = await readFixedSlideBlocks(source);
    expect(listed.length).toBeGreaterThan(0);
    expect(Object.values(blocks).flat()).toEqual(listed);
    expect(Object.keys(source.files).filter((name) => /^ppt\/slides\/[^/]+\.xml$/.test(name)).sort()).toEqual([...listed].sort());
    for (const part of listed) {
      const doc = await xml(source, part);
      expect(fields(doc)).toEqual({});
      expect(text(doc)).not.toContain('TBD');
    }
    for (const definition of Object.values(template.layouts)) {
      const doc = new DOMParser().parseFromString(definition.xml, 'application/xml');
      expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
      expect(Object.keys(fields(doc)).sort()).toEqual(definition.fields.map((field) => field.marker.slice('MISU_FIELD:'.length)).sort());
      expect(text(doc)).not.toContain('TBD');
    }
  });

  it('generates the reference sequence with every meeting field replaced and static artwork unchanged', async () => {
    const result = await generate();
    const parts = await slideParts(result);
    const blocks = await readFixedSlideBlocks(source);
    const plan = buildMainSlidePlan(meeting).flatMap((page) => page.kind === 'static'
      ? blocks[page.block].map((part) => ({ part }))
      : page);
    expect(parts).toHaveLength(plan.length);
    for (const [index, page] of plan.entries()) {
      const doc = await xml(result, parts[index]);
      if (page.fields) {
        expect(doc.documentElement.getAttribute('show')).not.toBe('0');
        const actual = fields(doc);
        for (const [field, values] of Object.entries(page.fields)) {
          expect(actual[field].slice(0, values.length)).toEqual(values);
          expect(actual[field].slice(values.length).every((value) => value === '')).toBe(true);
        }
        expect(text(doc)).not.toContain('TBD');
      } else {
        expect(await result.file(parts[index]).async('string')).toBe(await source.file(page.part).async('string'));
      }
    }
    for (const name of Object.keys(source.files).filter((part) => /^ppt\/(?:media|slideMasters|slideLayouts|theme)\//.test(part))) {
      if (source.files[name].dir) continue;
      expect(Buffer.from(await result.file(name).async('uint8array')).equals(Buffer.from(await source.file(name).async('uint8array'))), name).toBe(true);
    }
  }, 30000);

  it('updates slide indexes, counts and notes backlinks without dangling relationships or unlisted slides', async () => {
    const result = await generate();
    const parts = await slideParts(result);
    expect(new Set(parts).size).toBe(parts.length);
    expect(Object.keys(result.files).filter((name) => /^ppt\/slides\/[^/]+\.xml$/.test(name)).sort()).toEqual([...parts].sort());
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
    const types = await xml(result, '[Content_Types].xml');
    const overrides = Array.from(types.documentElement.children).filter((node) => node.localName === 'Override');
    const notes = Object.keys(result.files).filter((name) => /^ppt\/notesSlides\/[^/]+\.xml$/.test(name));
    for (const part of [...parts, ...notes]) {
      const matching = overrides.filter((node) => node.getAttribute('PartName') === `/${part}`);
      expect(matching, part).toHaveLength(1);
      const kind = notes.includes(part) ? 'notesSlide' : 'slide';
      expect(matching[0].getAttribute('ContentType')).toBe(`application/vnd.openxmlformats-officedocument.presentationml.${kind}+xml`);
    }
    let hidden = 0;
    for (const part of parts) {
      if ((await xml(result, part)).documentElement.getAttribute('show') === '0') hidden += 1;
    }
    const props = await xml(result, 'docProps/app.xml');
    expect(Number(props.getElementsByTagName('Slides')[0].textContent)).toBe(parts.length);
    expect(Number(props.getElementsByTagName('HiddenSlides')[0].textContent)).toBe(hidden);
    expect(Number(props.getElementsByTagName('Notes')[0].textContent)).toBe(notes.length);
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
    const originalDefinitions = JSON.stringify(template);
    const result = await generate(changed);
    const sessions = await slidesWithField(result, 'session');
    const speech = sessions.find((slide) => slide.values[0] === changed.role_slots[5].speech.title).doc;
    expect(fields(speech).session).toEqual([changed.role_slots[5].speech.title, 'New & <6>']);
    expect(sessions.some((slide) => slide.values[0] === changed.theme)).toBe(true);
    expect(fieldFontSize(speech, 'session')).toBeLessThan(template.layouts.session.fields[0].paragraphs[0].fontSize * 100);
    expect(JSON.stringify(template)).toBe(originalDefinitions);
    await expect(generate({ ...changed, role_slots: changed.role_slots.map((slot) => slot.id === 6 ? { ...slot, speech: { title: 'x'.repeat(100000) } } : slot) })).rejects.toThrow(/too long to fit/);
  }, 30000);

  it('handles large and empty agendas without stale meeting data', async () => {
    const changed = {
      ...meeting, role_slots: [],
      sessions: Array.from({ length: 35 }, (_, index) => ({ id: index, position: index, name: `New item ${index + 1}`, role_slot_id: null }))
    };
    const result = await generate(changed);
    expect((await slidesWithField(result, 'session')).map((slide) => slide.values))
      .toEqual(changed.sessions.map((session) => [session.name, 'All']));
    const empty = await generate({ ...changed, sessions: [] });
    expect(await slidesWithField(empty, 'session')).toEqual([]);
    expect(await slidesWithField(empty, 'reports')).toEqual([]);
  }, 30000);

  it('fits wide bold titles on their own line above the presenter', async () => {
    const title = 'Women empowering women in our community';
    const style = template.layouts.session.fields[0].paragraphs[0];
    const fontSize = fitSlideParagraph(title, style);
    expect(fontSize).toBeLessThan(style.fontSize);
    expect(fontSize).toBeGreaterThan(0);
    // Chromium measures this bold Arial title at 974.5957px at 44px.
    expect(974.5957 * fontSize / 44).toBeLessThan(style.width);
    const changed = {
      ...meeting,
      role_slots: meeting.role_slots.map((slot) => slot.id === 6 ? { ...slot, speech: { title } } : slot)
    };
    const result = await generate(changed);
    const { doc } = (await slidesWithField(result, 'session')).find((slide) => slide.values[0] === title);
    expect(fieldFontSize(doc, 'session')).toBe(fontSize * 100);
  }, 30000);

  it('rejects invalid templates and makes safe meeting-specific filenames', async () => {
    await expect(buildMainAgendaPptx(new Uint8Array([1, 2]), meeting)).rejects.toThrow(/Invalid PPTX ZIP/);
    const corrupt = await JSZip.loadAsync(seed);
    const doc = await xml(corrupt, 'ppt/slides/slide3.xml');
    doc.getElementsByTagNameNS(P, 'sp')[0].getElementsByTagNameNS(P, 'cNvPr')[0].setAttribute('name', 'MISU_FIELD:unknown');
    corrupt.file('ppt/slides/slide3.xml', new XMLSerializer().serializeToString(doc));
    await expect(buildMainAgendaPptx(await corrupt.generateAsync({ type: 'uint8array' }), meeting)).rejects.toThrow(/Fixed slide .* contains meeting fields/);
    const missingLayout = await JSZip.loadAsync(seed);
    missingLayout.remove('ppt/slideLayouts/slideLayout2.xml');
    await expect(buildMainAgendaPptx(await missingLayout.generateAsync({ type: 'uint8array' }), meeting)).rejects.toThrow(/missing part/);
    expect(mainAgendaPptxFilename(meeting)).toBe('MISU Main Agenda 144.pptx');
    const filename = mainAgendaPptxFilename({ number: '../144:*?' });
    expect(filename).toMatch(/\.pptx$/);
    expect(filename).not.toMatch(/[<>:"/\\|?*\u0000-\u001f]/);
  }, 30000);

  it('instantiates any number of sessions and combines odd evaluation counts without template pages', async () => {
    const sessions = [
      ...Array.from({ length: 4 }, (_, position) => ({
        position, name: 'Prepared Speech', agenda_name: `Speech ${position + 1}`, role_slot_id: 6, group_label: 'Prepared Speech Session'
      })),
      ...Array.from({ length: 5 }, (_, index) => ({
        position: index + 4, name: `Individual Evaluation ${index + 1}`, role_slot_id: 9, group_label: 'Evaluation Session'
      }))
    ];
    const result = await generate({ ...meeting, sessions });
    const parts = await slideParts(result);
    const generatedFields = [];
    for (const part of parts) generatedFields.push(fields(await xml(result, part)));
    expect(generatedFields.filter((field) => field.session).map((field) => field.session[0])).toEqual(['Speech 1', 'Speech 2', 'Speech 3', 'Speech 4']);
    expect(generatedFields.filter((field) => field.reports).map((field) => field.reports.filter(Boolean).length)).toEqual([2, 2, 1]);
  }, 30000);

  it('uses the PPTX order after fixed slides are renamed and reordered', async () => {
    const edited = await JSZip.loadAsync(seed);
    const originals = await slideParts(edited);
    const renames = new Map(originals.map((part, index) => [part, `ppt/slides/fixed-${originals.length - index}.xml`]));
    for (const [part, renamed] of renames) {
      edited.file(renamed, await edited.file(part).async('uint8array'));
      edited.remove(part);
      const oldRels = part.replace('slides/', 'slides/_rels/') + '.rels';
      edited.file(renamed.replace('slides/', 'slides/_rels/') + '.rels', await edited.file(oldRels).async('uint8array'));
      edited.remove(oldRels);
    }
    for (const name of Object.keys(edited.files).filter((name) => name.endsWith('.rels'))) {
      const doc = await xml(edited, name);
      const owner = name === '_rels/.rels' ? '' : name.replace('_rels/', '').replace(/\.rels$/, '');
      for (const rel of doc.documentElement.children) {
        if (rel.getAttribute('TargetMode') === 'External') continue;
        const target = decodeURIComponent(new URL(rel.getAttribute('Target'), `https://pptx.invalid/${owner}`).pathname.slice(1));
        if (renames.has(target)) rel.setAttribute('Target', `/${renames.get(target)}`);
      }
      writeXml(edited, name, doc);
    }
    const types = await xml(edited, '[Content_Types].xml');
    for (const node of types.documentElement.children) {
      const part = (node.getAttribute('PartName') || '').slice(1);
      if (renames.has(part)) node.setAttribute('PartName', `/${renames.get(part)}`);
    }
    writeXml(edited, '[Content_Types].xml', types);
    const presentation = await xml(edited, 'ppt/presentation.xml');
    const list = presentation.getElementsByTagNameNS(P, 'sldIdLst')[0];
    list.insertBefore(list.children[3], list.children[1]);
    list.insertBefore(list.children[8], list.children[5]);
    writeXml(edited, 'ppt/presentation.xml', presentation);
    const order = await slideParts(edited);
    const blocks = await readFixedSlideBlocks(edited);
    const result = await generate(meeting, await edited.generateAsync({ type: 'uint8array' }));
    const outputOrder = await slideParts(result);
    expect(outputOrder.filter((part) => order.includes(part))).toEqual(order);
    expect(outputOrder.slice(0, blocks.opening.length)).toEqual(blocks.opening);
    const introductionStart = outputOrder.indexOf(blocks.introduction[0]);
    expect(outputOrder.slice(introductionStart, introductionStart + blocks.introduction.length)).toEqual(blocks.introduction);
    expect(fields(await xml(result, outputOrder[introductionStart - 1]))['intro.title']).toBeTruthy();
    expect(outputOrder.slice(-blocks.closing.length)).toEqual(blocks.closing);
    for (const part of order) {
      expect(await result.file(part).async('string')).toBe(await edited.file(part).async('string'));
    }
  }, 30000);

  it('includes additional fixed content in its block without updating a registry', async () => {
    const edited = await JSZip.loadAsync(seed);
    const order = await slideParts(edited);
    const extraPart = 'ppt/slides/additional-club-info.xml';
    const slide = await xml(edited, order[5]);
    slide.getElementsByTagNameNS(P, 'cSld')[0].removeAttribute('name');
    writeXml(edited, extraPart, slide);
    const relationships = await xml(edited, order[5].replace('slides/', 'slides/_rels/') + '.rels');
    for (const rel of Array.from(relationships.documentElement.children)) {
      if (rel.getAttribute('Type').endsWith('/notesSlide')) rel.remove();
    }
    writeXml(edited, extraPart.replace('slides/', 'slides/_rels/') + '.rels', relationships);
    const types = await xml(edited, '[Content_Types].xml');
    const contentType = Array.from(types.documentElement.children).find((node) => node.getAttribute('PartName') === `/${order[5]}`).cloneNode(true);
    contentType.setAttribute('PartName', `/${extraPart}`);
    types.documentElement.appendChild(contentType);
    writeXml(edited, '[Content_Types].xml', types);
    const rels = await xml(edited, 'ppt/_rels/presentation.xml.rels');
    const rel = rels.createElementNS(rels.documentElement.namespaceURI, 'Relationship');
    rel.setAttribute('Id', 'rIdExtraFixed');
    rel.setAttribute('Type', `${R}/slide`);
    rel.setAttribute('Target', '/'+extraPart);
    rels.documentElement.appendChild(rel);
    writeXml(edited, 'ppt/_rels/presentation.xml.rels', rels);
    const presentation = await xml(edited, 'ppt/presentation.xml');
    const list = presentation.getElementsByTagNameNS(P, 'sldIdLst')[0];
    const id = list.children[0].cloneNode(true);
    id.setAttribute('id', '9999');
    id.setAttributeNS(R, 'r:id', 'rIdExtraFixed');
    list.insertBefore(id, list.children[6]);
    writeXml(edited, 'ppt/presentation.xml', presentation);
    const bytes = await edited.generateAsync({ type: 'uint8array' });
    const blocks = await readFixedSlideBlocks(edited);
    const result = await generate(meeting, bytes);
    const output = await slideParts(result);
    expect(output.filter((part) => part === extraPart)).toHaveLength(1);
    const introductionStart = output.indexOf(blocks.introduction[0]);
    expect(output.slice(introductionStart, introductionStart + blocks.introduction.length)).toEqual(blocks.introduction);
    expect(await result.file(extraPart).async('string')).toBe(await edited.file(extraPart).async('string'));
    expect(Number((await xml(result, 'docProps/app.xml')).getElementsByTagName('Slides')[0].textContent)).toBe(output.length);
  }, 30000);

  it('rejects missing, duplicate and out-of-order fixed block anchors', async () => {
    for (const replacement of ['', 'MISU_BLOCK:opening', 'MISU_BLOCK:closing', 'MISU_BLOCK:unknown']) {
      const edited = await JSZip.loadAsync(seed);
      const [part] = (await readFixedSlideBlocks(edited)).introduction;
      const doc = await xml(edited, part);
      doc.getElementsByTagNameNS(P, 'cSld')[0].setAttribute('name', replacement);
      writeXml(edited, part, doc);
      await expect(readFixedSlideBlocks(edited)).rejects.toThrow(/fixed block/);
    }
    const edited = await JSZip.loadAsync(seed);
    const [first] = await slideParts(edited);
    const doc = await xml(edited, first);
    doc.getElementsByTagNameNS(P, 'cSld')[0].removeAttribute('name');
    writeXml(edited, first, doc);
    await expect(readFixedSlideBlocks(edited)).rejects.toThrow(/opening block/);
  });

  it('rejects missing, duplicate or unlisted fixed slide parts', async () => {
    const edited = await JSZip.loadAsync(seed);
    const [part] = await slideParts(edited);
    edited.remove(part);
    await expect(readFixedSlideBlocks(edited)).rejects.toThrow(/Missing or duplicate slide/);
    const duplicate = await JSZip.loadAsync(seed);
    const presentation = await xml(duplicate, 'ppt/presentation.xml');
    const list = presentation.getElementsByTagNameNS(P, 'sldIdLst')[0];
    list.children[1].setAttributeNS(R, 'r:id', list.children[0].getAttributeNS(R, 'id'));
    writeXml(duplicate, 'ppt/presentation.xml', presentation);
    await expect(readFixedSlideBlocks(duplicate)).rejects.toThrow(/Missing or duplicate slide/);
    const unlisted = await JSZip.loadAsync(seed);
    unlisted.file('ppt/slides/unlisted.xml', await unlisted.file(part).async('string'));
    await expect(readFixedSlideBlocks(unlisted)).rejects.toThrow(/unlisted slide parts/);
  });
});
