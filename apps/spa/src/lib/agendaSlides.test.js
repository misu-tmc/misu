import { describe, expect, it } from 'vitest';
import { mainSlidesMeeting as meeting } from '../test/fixtures/mainSlidesMeeting.js';
import { buildAgendaSlideSequence, buildMainSlidePlan } from './agendaSlides.js';

describe('main slide agenda plan', () => {
  it('reproduces all 39 reference layouts with warmup before the introduction', () => {
    const plan = buildMainSlidePlan(meeting);
    expect(plan.map((slide) => slide.template)).toEqual(Array.from({ length: 39 }, (_, i) => i + 1));
    expect(plan[4].fields.session).toEqual(['Warm Up', 'Warmup Host']);
    expect(plan[5].fields['intro.detail']).toEqual(['Club Presenter', 'Microsoft Suzhou Toastmasters Club', 'Updated: Aug 31, 2026']);
    expect(plan[28].fields.session).toEqual(['Growth Mindset', 'Topics Host']);
    expect(plan[37].fields['appreciation.manager']).toEqual(['Meeting Manager', 'Meeting Organizer']);
  });

  it('uses speech titles, groups paired evaluations/reports, and does not duplicate closing', () => {
    const plan = buildMainSlidePlan(meeting);
    expect(plan[24].fields.session).toEqual(['A New Beginning', 'First Speaker']);
    expect(plan[25].fields.session).toEqual(['Learning Together', 'Second Speaker']);
    expect(plan[30].fields.reports).toEqual([
      "First Speaker's Individual Evaluator \u2013 First Evaluator",
      "Second Speaker's Individual Evaluator \u2013 Second Evaluator"
    ]);
    expect(plan[32].fields.reports).toEqual(["Grammarian's Report \u2013 Word Keeper", "Timer's Report \u2013 Time Keeper"]);
    expect(plan.filter((slide) => slide.template === 37)).toHaveLength(1);
  });

  it('preserves saved order, agenda overrides, optional filtering and empty assignments', () => {
    const changed = {
      ...meeting,
      role_slots: [
        { id: 2, role_name: 'Speaker', is_optional: true, taker_id: null },
        { id: 3, role_name: 'Speaker', taker_id: null, speech: { title: 'Speech fallback' } }
      ],
      sessions: [
        { id: 3, position: 3, name: 'Everyone', role_slot_id: null },
        { id: 1, position: 1, name: 'Unassigned', agenda_name: 'Agenda override', role_slot_id: '3' },
        { id: 2, position: 2, name: 'Omitted', role_slot_id: 2 }
      ]
    };
    const slides = buildAgendaSlideSequence(changed);
    expect(slides.map((slide) => slide.fields.session)).toEqual([['Agenda override', 'TBD'], ['Everyone', 'All']]);
  });

  it('supports arbitrary counts and only combines consecutive evaluations within their group', () => {
    const sessions = Array.from({ length: 35 }, (_, index) => ({
      id: index + 1, position: index, name: `Evaluation ${index + 1}`,
      group_label: index === 2 ? 'Other' : 'Evaluation Session', role_slot_id: 9
    }));
    const plan = buildAgendaSlideSequence({ ...meeting, sessions });
    const rows = plan.flatMap((slide) => slide.rows || (slide.row ? [slide.row] : []));
    expect(rows.map((row) => row.id)).toEqual(sessions.map((row) => row.id));
    expect(plan.filter((slide) => slide.kind === 'reports').map((slide) => slide.rows.length)).toEqual([2, 1, ...Array(16).fill(2)]);
  });

  it('does not invent old presenters for empty meetings and refreshes introduction and support roles', () => {
    const plan = buildMainSlidePlan({ ...meeting, role_slots: [], sessions: [] });
    expect(plan).toHaveLength(21);
    expect(plan.find((slide) => slide.template === 6).fields['intro.detail'][0]).toBe('');
    expect(plan.find((slide) => slide.template === 38).fields['appreciation.photographer']).toEqual(['Photographer', 'TBD']);
    expect(buildMainSlidePlan({ ...meeting, date: '2026-09-14' })[5].fields['intro.detail'][2]).toBe('Updated: Sep 14, 2026');
  });

  it('uses Opening Remarks as the club introduction anchor in saved agendas', () => {
    const sessions = meeting.sessions.map((row) => row.id === 2 ? { ...row, name: 'Opening Remarks' } : row);
    const plan = buildMainSlidePlan({ ...meeting, sessions });
    expect(plan.slice(4, 7).map((slide) => slide.template)).toEqual([5, 6, 7]);
    expect(plan[5].title).toBe('Opening Remarks');
  });

  it('places the fallback introduction after warmup, not before earlier logistics', () => {
    const sessions = [
      { position: 0, name: 'Registration' },
      { position: 1, name: 'Warm Up', role_slot_id: 1 },
      { position: 2, name: 'TOE', role_slot_id: 3 }
    ];
    expect(buildMainSlidePlan({ ...meeting, sessions }).slice(4, 8).map((slide) => slide.template)).toEqual([25, 5, 6, 7]);
  });

  it('does not append closing when it is already included in a paired report', () => {
    const sessions = [
      { position: 0, name: "Grammarian's Report", role_slot_id: 5, group_label: 'Reports' },
      { position: 1, name: "Timer's Report & Closing", role_slot_id: 4, group_label: 'Reports' }
    ];
    expect(buildMainSlidePlan({ ...meeting, sessions }).some((slide) => slide.template === 37)).toBe(false);
  });

  it('does not associate a previous role taker headshot with a different assignee', () => {
    const appreciation = buildMainSlidePlan(meeting).find((slide) => slide.template === 38);
    expect(appreciation.portraits.map((portrait) => portrait.initials)).toEqual(['MO', 'MP']);
    const sameOwners = { ...meeting, role_slots: [
      { role_name: 'Meeting Manager', taker_name: 'Chao Chen' },
      { role_name: 'Photographer', taker_name: 'Tao Lu' }
    ] };
    expect(buildMainSlidePlan(sameOwners).find((slide) => slide.template === 38).portraits).toEqual([]);
  });
});
