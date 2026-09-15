import { describe, expect, it } from 'vitest';
import { mainSlidesMeeting as meeting } from '../test/fixtures/mainSlidesMeeting.js';
import { buildAgendaSlideSequence, buildMainSlidePlan } from './agendaSlides.js';

describe('main slide agenda plan', () => {
  it('uses current meeting data and includes each fixed block once', () => {
    const plan = buildMainSlidePlan(meeting);
    expect(plan.filter((slide) => slide.kind === 'static').map((slide) => slide.block)).toEqual(['opening', 'introduction', 'closing']);
    expect(plan.find((slide) => slide.layout === 'warmup').fields.session).toEqual(['Warm Up', 'Warmup Host']);
    expect(plan.find((slide) => slide.layout === 'introduction').fields['intro.detail']).toEqual(['Club Presenter', 'Microsoft Suzhou Toastmasters Club', 'Updated: Aug 31, 2026']);
    expect(plan.find((slide) => slide.title === 'Growth Mindset').fields.session).toEqual(['Growth Mindset', 'Topics Host']);
    expect(plan.find((slide) => slide.layout === 'appreciation').fields['appreciation.manager']).toEqual(['Meeting Manager', 'Meeting Organizer']);
  });

  it('uses speech titles, groups paired evaluations/reports, and does not duplicate closing', () => {
    const plan = buildMainSlidePlan(meeting);
    const speeches = plan.filter((slide) => slide.layout === 'session');
    expect(speeches[0].fields.session).toEqual(['A New Beginning', 'First Speaker']);
    expect(speeches[1].fields.session).toEqual(['Learning Together', 'Second Speaker']);
    expect(plan.find((slide) => slide.layout === 'evaluations').fields.reports).toEqual([
      "First Speaker's Individual Evaluator \u2013 First Evaluator",
      "Second Speaker's Individual Evaluator \u2013 Second Evaluator"
    ]);
    expect(plan.find((slide) => slide.layout === 'reports').fields.reports).toEqual(["Grammarian's Report \u2013 Word Keeper", "Timer's Report \u2013 Time Keeper"]);
    expect(plan.filter((slide) => slide.title === 'Closing Remark')).toHaveLength(1);
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
    for (const slide of plan.filter((slide) => slide.rows)) {
      expect(slide.rows.length).toBeLessThanOrEqual(2);
      expect(new Set(slide.rows.map((row) => row.group_label)).size).toBe(1);
    }
  });

  it('does not invent old presenters for empty meetings and refreshes introduction and support roles', () => {
    const plan = buildMainSlidePlan({ ...meeting, role_slots: [], sessions: [] });
    expect(plan.flatMap((slide) => slide.rows || (slide.row ? [slide.row] : []))).toEqual([]);
    expect(plan.find((slide) => slide.layout === 'introduction').fields['intro.detail'][0]).toBe('');
    expect(plan.find((slide) => slide.layout === 'appreciation').fields['appreciation.photographer']).toEqual(['Photographer', 'TBD']);
    expect(buildMainSlidePlan({ ...meeting, date: '2026-09-14' }).find((slide) => slide.layout === 'introduction').fields['intro.detail'][2]).toBe('Updated: Sep 14, 2026');
  });

  it('does not associate a previous role taker headshot with a different assignee', () => {
    const appreciation = buildMainSlidePlan(meeting).find((slide) => slide.layout === 'appreciation');
    expect(appreciation.portraits.map((portrait) => portrait.initials)).toEqual(['MO', 'MP']);
    const sameOwners = { ...meeting, role_slots: [
      { role_name: 'Meeting Manager', taker_name: 'Chao Chen' },
      { role_name: 'Photographer', taker_name: 'Tao Lu' }
    ] };
    expect(buildMainSlidePlan(sameOwners).find((slide) => slide.layout === 'appreciation').portraits).toEqual([]);
  });
});
