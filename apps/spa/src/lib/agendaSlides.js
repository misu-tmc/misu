import { buildAgenda, isPreparedSpeechSlot } from './format.js';

const normalized = (value) => String(value || '').trim().toLowerCase().replace(/[\u2019']/g, '').replace(/\s+/g, ' ');

export function agendaTaker(row) {
  return String(row.taker || '').trim() || (row.role_slot_id == null ? 'All' : 'TBD');
}

function sessionType(row, slot) {
  const name = normalized(row.sessionName);
  const role = normalized(slot?.role_name);
  const identity = `${name} ${role}`;
  if (/introduc.*(?:toastmasters?|\btm\b|club)|(?:toastmasters?|\btm\b|club).*introduc/.test(identity) || name === 'opening remarks') return 'introduction';
  if (/warm[ -]?up/.test(identity)) return 'warmup';
  if (/table topics?.*evaluat/.test(identity)) return 'table-evaluation';
  if (/individual.*evaluat/.test(identity)) return 'individual';
  if (/general.*evaluat/.test(identity)) return 'general-evaluation';
  if (/report/.test(name) && /timer|grammarian|ah[ -]?counter/.test(identity)) return 'report';
  if (isPreparedSpeechSlot(slot)) return 'speech';
  if (/table topics?/.test(identity)) return 'table-topics';
  if (/\btoe\b|toastmaster of (?:the )?(?:evening|day)/.test(identity)) return 'toe';
  if (/timer/.test(identity)) return 'timer';
  if (/grammarian/.test(identity)) return 'grammarian';
  if (/\b(?:social|break|networking|intermission)\b/.test(name)) return 'social';
  if (/^vot(?:e|ing)\b/.test(name)) return 'voting';
  if (/^award(?:ing|s)?\b/.test(name)) return 'awarding';
  if (/^(?:closing(?: remarks?)?|wrap[ -]?up)$/.test(name)) return 'closing';
  return 'session';
}

function sectionLayout(group) {
  if (/facilitat/.test(group)) return 'facilitator-section';
  if (/prepared.*speech/.test(group)) return 'section';
  if (/table topics?/.test(group)) return 'topics-section';
  if (/evaluat/.test(group)) return 'heading';
  return null;
}

function sectionSlide(group, slot) {
  const layout = sectionLayout(normalized(group)) || 'section';
  const paragraphs = layout === 'facilitator-section' && / introduction$/i.test(group)
    ? [group.replace(/\s+introduction$/i, ''), 'Introduction']
    : [group];
  return { kind: 'section', slot, title: group, layout, variant: layout === 'heading' ? 'evaluation' : undefined, fields: { [layout === 'heading' ? 'heading' : 'section']: paragraphs } };
}

function sessionSlide(row, type, slot, meeting) {
  let title = String(row.name || '').trim() || 'TBD';
  if (type === 'table-topics' && /^(?:table topics?(?: session)?|impromptu speeches|introduction)$/i.test(title)) {
    title = String(meeting.theme || '').trim() || title;
  }
  const subtitle = agendaTaker(row);
  if (type === 'introduction') {
    return {
      kind: 'intro-title', slot, title, row, layout: 'introduction',
      fields: { 'intro.title': [title], 'intro.detail': [subtitle, 'Microsoft Suzhou Toastmasters Club', introductionDate(meeting)] }
    };
  }
  const headingLayout = { social: 'heading', voting: 'heading', awarding: 'closing', closing: 'closing' }[type];
  if (headingLayout && row.role_slot_id == null) {
    return { kind: 'session', slot, title, row, layout: headingLayout, variant: { voting: 'voting', closing: 'remark' }[type], fields: { heading: [title] } };
  }
  const layout = { warmup: 'warmup', toe: 'facilitator', timer: 'facilitator', grammarian: 'facilitator', 'table-evaluation': 'topics-evaluation', 'general-evaluation': 'general-evaluation' }[type] || 'session';
  return { kind: 'session', slot, title, subtitle, row, layout, fields: { session: [title, subtitle] } };
}

function introductionDate(meeting) {
  if (!meeting.date) return '';
  const date = new Date(`${meeting.date}T00:00:00`);
  if (Number.isNaN(date.getTime())) throw new Error('Cannot generate slides: the meeting date is invalid.');
  return `Updated: ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

export function buildAgendaSlideSequence(meeting) {
  const rows = buildAgenda(meeting);
  const slots = new Map((meeting.role_slots || []).map((slot) => [String(slot.id), slot]));
  const types = rows.map((row) => sessionType(row, slots.get(String(row.role_slot_id))));
  const slides = [];
  for (let start = 0; start < rows.length;) {
    const group = String(rows[start].group_label || '').trim();
    let end = start + 1;
    while (end < rows.length && String(rows[end].group_label || '').trim() === group) end += 1;
    const groupKey = normalized(group);
    const firstTitle = sessionSlide(rows[start], types[start], start + 1, meeting).title;
    const needsSection = group && normalized(firstTitle) !== groupKey
      && !/^(?:opening|warm[ -]?up|closing)$/.test(groupKey)
      && (sectionLayout(groupKey) || end - start > 1);
    const sectionPosition = /facilitat/.test(groupKey) && types[start] === 'toe' ? start + 1 : start;
    for (let index = start; index < end; index += 1) {
      if (needsSection && index === sectionPosition) slides.push(sectionSlide(group, index + 1));
      const type = types[index];
      if (type === 'individual' || type === 'report') {
        const pair = [rows[index]];
        if (index + 1 < end && types[index + 1] === type) pair.push(rows[index + 1]);
        const lines = pair.map((row) => `${row.name} \u2013 ${agendaTaker(row)}`);
        slides.push({
          kind: 'reports', slot: index + 1, title: lines.join(' / '), rows: pair,
          layout: type === 'individual' ? 'evaluations' : 'reports', fields: { reports: lines }
        });
        index += pair.length - 1;
      } else {
        const slide = sessionSlide(rows[index], type, index + 1, meeting);
        slides.push(slide);
      }
    }
    start = end;
  }
  return slides;
}

export function buildMainSlidePlan(meeting = {}) {
  const agenda = buildAgendaSlideSequence(meeting);
  const staticBlock = (block) => ({ kind: 'static', block });
  const slides = [staticBlock('opening')];
  const hasIntroduction = agenda.some((slide) => slide.layout === 'introduction');
  const defaultPosition = agenda.findIndex((slide) => slide.layout === 'warmup') + 1;
  let introduced = false;
  for (const [index, slide] of agenda.entries()) {
    if (!hasIntroduction && !introduced && index === defaultPosition) {
      slides.push(defaultIntroduction(meeting), staticBlock('introduction'));
      introduced = true;
    }
    slides.push(slide);
    if (slide.layout === 'introduction' && !introduced) {
      slides.push(staticBlock('introduction'));
      introduced = true;
    }
  }
  if (!introduced) slides.push(defaultIntroduction(meeting), staticBlock('introduction'));
  if (!agenda.some((slide) => (slide.rows || [slide.row]).some((row) => /closing|wrap[ -]?up/i.test(row?.sessionName || '')))) {
    slides.push({ kind: 'closing', layout: 'closing', variant: 'remark', title: 'Closing Remark', fields: { heading: ['Closing Remark'] } });
  }
  slides.push(staticBlock('closing'));
  return slides;
}

function defaultIntroduction(meeting) {
  const title = 'Brief Introduction of Toastmasters';
  const presenter = (meeting.role_slots || []).find((slot) => sessionType({}, slot) === 'introduction');
  return {
    kind: 'intro-title', layout: 'introduction', title,
    fields: {
      'intro.title': [title],
      'intro.detail': [presenter ? String(presenter.taker_name || '').trim() || 'TBD' : '', 'Microsoft Suzhou Toastmasters Club', introductionDate(meeting)]
    }
  };
}
