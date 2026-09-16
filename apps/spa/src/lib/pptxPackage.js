const PRESENTATION_NS = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const RELATIONSHIP_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PROPERTIES_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/extended-properties';

export function parseXml(xml, name, root) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length || doc.documentElement.localName !== root) {
    throw new Error(`Main slides template error: Invalid '${name}'.`);
  }
  return doc;
}

async function readXml(zip, name, root) {
  const file = zip.file(name);
  if (!file) throw new Error(`Main slides template error: Missing '${name}'.`);
  return parseXml(await file.async('string'), name, root);
}

function relationshipPart(owner) {
  const slash = owner.lastIndexOf('/');
  return `${owner.slice(0, slash + 1)}_rels/${owner.slice(slash + 1)}.rels`;
}

function targetPart(owner, relationship) {
  return decodeURIComponent(new URL(relationship.getAttribute('Target'), `https://pptx.invalid/${owner}`).pathname.slice(1));
}

async function readPresentation(zip) {
  const name = 'ppt/presentation.xml';
  const presentation = await readXml(zip, name, 'presentation');
  const rels = await readXml(zip, relationshipPart(name), 'Relationships');
  const byId = new Map();
  for (const rel of rels.documentElement.children) {
    const id = rel.getAttribute('Id');
    if (!id || byId.has(id)) throw new Error('Main slides template error: Duplicate or missing relationship ID.');
    byId.set(id, rel);
  }
  const list = presentation.getElementsByTagNameNS(PRESENTATION_NS, 'sldIdLst')[0];
  if (!list) throw new Error('Main slides template error: Missing slide list.');
  const ids = Array.from(list.children);
  const byPart = new Map();
  const slideIds = new Set();
  for (const node of ids) {
    const id = Number(node.getAttribute('id'));
    if (!Number.isInteger(id) || id < 256 || slideIds.has(id)) {
      throw new Error('Main slides template error: Duplicate or invalid slide ID.');
    }
    slideIds.add(id);
    const rel = byId.get(node.getAttributeNS(RELATIONSHIP_NS, 'id'));
    if (!rel || rel.getAttribute('Type') !== `${RELATIONSHIP_NS}/slide` || rel.getAttribute('TargetMode') === 'External') {
      throw new Error('Main slides template error: Missing or invalid slide relationship.');
    }
    const part = targetPart(name, rel);
    if (!zip.file(part) || byPart.has(part)) throw new Error(`Main slides template error: Missing or duplicate slide '${part}'.`);
    byPart.set(part, node);
  }
  return { name, presentation, rels, byId, list, ids, byPart };
}

export async function readFixedSlideBlocks(zip) {
  const { byPart } = await readPresentation(zip);
  const blocks = { opening: [], introduction: [], closing: [] };
  const names = Object.keys(blocks);
  const parts = Array.from(byPart.keys());
  const actualParts = Object.keys(zip.files).filter((name) => /^ppt\/slides\/[^/]+\.xml$/.test(name));
  if (actualParts.length !== parts.length || actualParts.some((part) => !byPart.has(part))) {
    throw new Error('Main slides template error: Fixed template contains unlisted slide parts.');
  }
  let blockIndex = -1;
  for (const part of parts) {
    const doc = await readXml(zip, part, 'sld');
    const name = doc.getElementsByTagNameNS(PRESENTATION_NS, 'cSld')[0]?.getAttribute('name') || '';
    if (name.startsWith('MISU_BLOCK:')) {
      const block = name.slice('MISU_BLOCK:'.length);
      if (block !== names[blockIndex + 1]) {
        throw new Error(`Main slides template error: Unexpected fixed block '${block}'; expected '${names[blockIndex + 1] || 'no further block'}'.`);
      }
      blockIndex += 1;
    }
    if (blockIndex < 0) throw new Error('Main slides template error: First fixed slide must start the opening block.');
    blocks[names[blockIndex]].push(part);
  }
  if (blockIndex !== names.length - 1) throw new Error('Main slides template error: Missing introduction or closing block anchor.');
  return blocks;
}

function nextPartName(zip, directory, stem) {
  const pattern = new RegExp(`^${directory}/${stem}(\\d+)\\.xml$`);
  const indexes = Object.keys(zip.files).flatMap((name) => {
    const match = name.match(pattern);
    return match ? [Number(match[1])] : [];
  });
  const index = Math.max(0, ...indexes) + 1;
  return `${directory}/${stem}${index}.xml`;
}

function addContentType(types, target, kind) {
  const entry = types.createElementNS(types.documentElement.namespaceURI, 'Override');
  entry.setAttribute('PartName', `/${target}`);
  entry.setAttribute('ContentType', `application/vnd.openxmlformats-officedocument.presentationml.${kind}+xml`);
  types.documentElement.appendChild(entry);
}

function instantiateSlideRelationships(zip, types, definition, target) {
  const rels = parseXml(definition.relationships, `${target} layout relationships`, 'Relationships');
  const serializer = new XMLSerializer();
  const noteLinks = Array.from(rels.documentElement.children).filter((rel) => rel.getAttribute('Type') === `${RELATIONSHIP_NS}/notesSlide`);
  if (noteLinks.length > 1 || Boolean(definition.notes) !== (noteLinks.length === 1)) {
    throw new Error('Main slides template error: Slide definition and notes relationship do not match.');
  }
  for (const rel of noteLinks) {
    if (rel.getAttribute('TargetMode') === 'External') throw new Error('Main slides template error: Notes must be internal.');
    const newNotes = nextPartName(zip, 'ppt/notesSlides', 'notesSlide');
    parseXml(definition.notes.xml, newNotes, 'notes');
    zip.file(newNotes, definition.notes.xml);
    addContentType(types, newNotes, 'notesSlide');
    const notesRels = parseXml(definition.notes.relationships, relationshipPart(newNotes), 'Relationships');
    const backLinks = Array.from(notesRels.documentElement.children).filter((node) => node.getAttribute('Type') === `${RELATIONSHIP_NS}/slide`);
    if (backLinks.length !== 1) throw new Error('Main slides template error: Notes require one slide backlink.');
    backLinks[0].setAttribute('Target', `/${target}`);
    zip.file(relationshipPart(newNotes), serializer.serializeToString(notesRels));
    rel.setAttribute('Target', `/${newNotes}`);
  }
  zip.file(relationshipPart(target), serializer.serializeToString(rels));
}

export async function replacePresentationSlides(zip, pages) {
  const { name, presentation, rels, byId, list, ids, byPart } = await readPresentation(zip);
  const types = await readXml(zip, '[Content_Types].xml', 'Types');
  const retained = new Set();
  let nextId = Math.max(255, ...ids.map((node) => Number(node.getAttribute('id')))) + 1;
  let nextRelationshipId = 1;
  list.replaceChildren();
  for (const page of pages) {
    if (page.xml == null) {
      const original = byPart.get(page.source);
      if (!original) throw new Error(`Main slides template error: Unlisted slide '${page.source}'.`);
      if (retained.has(page.source)) throw new Error(`Main slides template error: Duplicate static slide '${page.source}'.`);
      retained.add(page.source);
      list.appendChild(original);
      continue;
    }
    const part = nextPartName(zip, 'ppt/slides', 'slide');
    zip.file(part, page.xml);
    instantiateSlideRelationships(zip, types, page, part);
    addContentType(types, part, 'slide');
    while (byId.has(`rIdMisu${nextRelationshipId}`)) nextRelationshipId += 1;
    const relId = `rIdMisu${nextRelationshipId++}`;
    const relation = rels.createElementNS(rels.documentElement.namespaceURI, 'Relationship');
    relation.setAttribute('Id', relId);
    relation.setAttribute('Type', `${RELATIONSHIP_NS}/slide`);
    relation.setAttribute('Target', `/${part}`);
    rels.documentElement.appendChild(relation);
    const slideId = presentation.createElementNS(PRESENTATION_NS, 'p:sldId');
    slideId.setAttribute('id', String(nextId++));
    slideId.setAttributeNS(RELATIONSHIP_NS, 'r:id', relId);
    list.appendChild(slideId);
  }

  const removedParts = new Set();
  for (const [part, id] of byPart) {
    if (retained.has(part)) continue;
    byId.get(id.getAttributeNS(RELATIONSHIP_NS, 'id')).remove();
    removedParts.add(part);
    const relsName = relationshipPart(part);
    const slideRels = await readXml(zip, relsName, 'Relationships');
    for (const rel of slideRels.documentElement.children) {
      if (rel.getAttribute('Type') === `${RELATIONSHIP_NS}/notesSlide`) {
        const notesPart = targetPart(part, rel);
        removedParts.add(notesPart);
        removedParts.add(relationshipPart(notesPart));
      }
    }
    removedParts.add(relsName);
  }
  for (const part of removedParts) zip.remove(part);
  for (const node of Array.from(types.documentElement.children)) {
    if (removedParts.has(decodeURIComponent(node.getAttribute('PartName') || '').replace(/^\//, ''))) node.remove();
  }
  // These optional navigation caches describe the original slide order.
  for (const node of Array.from(presentation.getElementsByTagName('*'))) {
    if (['sectionLst', 'custShowLst'].includes(node.localName)) node.remove();
  }
  const serializer = new XMLSerializer();
  zip.file(name, serializer.serializeToString(presentation));
  zip.file(relationshipPart(name), serializer.serializeToString(rels));
  zip.file('[Content_Types].xml', serializer.serializeToString(types));

  for (const part of Object.keys(zip.files).filter((part) => part.endsWith('.rels'))) {
    const relationships = await readXml(zip, part, 'Relationships');
    const owner = part === '_rels/.rels' ? '' : part.replace('_rels/', '').replace(/\.rels$/, '');
    for (const rel of relationships.documentElement.children) {
      if (rel.getAttribute('TargetMode') !== 'External' && !zip.file(targetPart(owner, rel))) {
        throw new Error(`Main slides template error: '${owner}' links to a missing part.`);
      }
    }
  }
  if (zip.file('docProps/app.xml')) {
    const properties = await readXml(zip, 'docProps/app.xml', 'Properties');
    const notesCount = Object.keys(zip.files).filter((part) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(part)).length;
    let hidden = 0;
    for (const page of pages) {
      if (page.xml == null && (await readXml(zip, page.source, 'sld')).documentElement.getAttribute('show') === '0') hidden += 1;
    }
    for (const [field, value] of [['Slides', pages.length], ['HiddenSlides', hidden], ['Notes', notesCount]]) {
      const node = properties.getElementsByTagNameNS(PROPERTIES_NS, field)[0];
      if (node) node.textContent = String(value);
    }
    for (const field of ['HeadingPairs', 'TitlesOfParts']) properties.getElementsByTagNameNS(PROPERTIES_NS, field)[0]?.remove();
    zip.file('docProps/app.xml', serializer.serializeToString(properties));
  }
}
