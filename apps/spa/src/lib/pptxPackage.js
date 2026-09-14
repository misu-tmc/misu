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

function nextPartName(zip, directory, stem) {
  let index = 1;
  while (zip.file(`${directory}/${stem}${index}.xml`)) index += 1;
  return `${directory}/${stem}${index}.xml`;
}

function addContentType(types, source, target) {
  const original = Array.from(types.documentElement.children).find(
    (node) => decodeURIComponent(node.getAttribute('PartName') || '') === `/${source}`
  );
  if (!original) throw new Error(`Main slides template error: Missing content type for '${source}'.`);
  const copy = original.cloneNode(true);
  copy.setAttribute('PartName', `/${target}`);
  types.documentElement.appendChild(copy);
}

async function cloneSlideRelationships(zip, types, source, target) {
  const rels = await readXml(zip, relationshipPart(source), 'Relationships');
  const serializer = new XMLSerializer();
  for (const rel of rels.documentElement.children) {
    if (rel.getAttribute('Type') !== `${RELATIONSHIP_NS}/notesSlide`) continue;
    const oldNotes = targetPart(source, rel);
    const newNotes = nextPartName(zip, 'ppt/notesSlides', 'notesSlide');
    const notesFile = zip.file(oldNotes);
    if (!notesFile) throw new Error(`Main slides template error: Missing notes '${oldNotes}'.`);
    zip.file(newNotes, await notesFile.async('uint8array'));
    addContentType(types, oldNotes, newNotes);
    const notesRels = await readXml(zip, relationshipPart(oldNotes), 'Relationships');
    for (const backLink of notesRels.documentElement.children) {
      if (backLink.getAttribute('Type') === `${RELATIONSHIP_NS}/slide`) backLink.setAttribute('Target', `/${target}`);
    }
    zip.file(relationshipPart(newNotes), serializer.serializeToString(notesRels));
    rel.setAttribute('Target', `/${newNotes}`);
  }
  zip.file(relationshipPart(target), serializer.serializeToString(rels));
}

export async function replacePresentationSlides(zip, pages) {
  const name = 'ppt/presentation.xml';
  const presentation = await readXml(zip, name, 'presentation');
  const rels = await readXml(zip, relationshipPart(name), 'Relationships');
  const types = await readXml(zip, '[Content_Types].xml', 'Types');
  const byId = new Map(Array.from(rels.documentElement.children).map((node) => [node.getAttribute('Id'), node]));
  const list = presentation.getElementsByTagNameNS(PRESENTATION_NS, 'sldIdLst')[0];
  if (!list) throw new Error('Main slides template error: Missing slide list.');
  const ids = Array.from(list.children);
  const byPart = new Map(ids.map((node) => {
    const rel = byId.get(node.getAttributeNS(RELATIONSHIP_NS, 'id'));
    if (!rel) throw new Error('Main slides template error: Missing slide relationship.');
    return [targetPart(name, rel), node];
  }));
  const retained = new Set();
  let nextId = Math.max(255, ...ids.map((node) => Number(node.getAttribute('id')))) + 1;
  let nextRelationshipId = 1;
  list.replaceChildren();
  for (const page of pages) {
    const original = byPart.get(page.source);
    if (!original) throw new Error(`Main slides template error: Unlisted slide '${page.source}'.`);
    if (page.xml == null) {
      if (retained.has(page.source)) throw new Error(`Main slides template error: Duplicate static slide '${page.source}'.`);
      retained.add(page.source);
      list.appendChild(original);
      continue;
    }
    const part = nextPartName(zip, 'ppt/slides', 'slide');
    zip.file(part, page.xml);
    await cloneSlideRelationships(zip, types, page.source, part);
    addContentType(types, page.source, part);
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
