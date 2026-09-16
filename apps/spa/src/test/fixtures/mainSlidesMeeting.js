export const mainSlidesMeeting = {
  id: 44, number: 144, title: 'Regular Meeting', theme: 'Growth Mindset',
  date: '2026-08-31', start_time: '19:00', end_time: '21:00', venue: 'Meeting Room',
  role_slots: [
    { id: 1, role_name: 'Warm Up', taker_id: 1, taker_name: 'Warmup Host' },
    { id: 2, role_name: 'Club Introduction', taker_id: 2, taker_name: 'Club Presenter' },
    { id: 3, role_name: 'Toastmaster of the Evening', taker_id: 3, taker_name: 'Evening Host' },
    { id: 4, role_name: 'Timer', taker_id: 4, taker_name: 'Time Keeper' },
    { id: 5, role_name: 'Grammarian', taker_id: 5, taker_name: 'Word Keeper' },
    { id: 6, role_name: 'Prepared Speaker', taker_id: 6, taker_name: 'First Speaker', speech: { title: 'A New Beginning', pathway: 'Persuasive Influence', level: 1 } },
    { id: 7, role_name: 'Prepared Speaker', taker_id: 7, taker_name: 'Second Speaker', speech: { title: 'Learning Together', pathway: 'Presentation Mastery', level: 3 } },
    { id: 8, role_name: 'Table Topics Master', taker_id: 8, taker_name: 'Topics Host' },
    { id: 9, role_name: 'Individual Evaluator', taker_id: 9, taker_name: 'First Evaluator' },
    { id: 10, role_name: 'Individual Evaluator', taker_id: 10, taker_name: 'Second Evaluator' },
    { id: 11, role_name: 'Table Topics Evaluator', taker_id: 11, taker_name: 'Topics Evaluator' },
    { id: 12, role_name: 'General Evaluator', taker_id: 12, taker_name: 'General Evaluator' },
    { id: 13, role_name: 'Meeting Manager', taker_id: 13, taker_name: 'Meeting Organizer' },
    { id: 14, role_name: 'Photographer', taker_id: 14, taker_name: 'Meeting Photographer' }
  ],
  sessions: [
    ['Warm Up', 'Warm Up', 1],
    ['Opening', 'Brief Introduction of Toastmasters', 2],
    ['Facilitator Team Introduction', 'TOE', 3],
    ['Facilitator Team Introduction', 'Timer', 4],
    ['Facilitator Team Introduction', 'Grammarian', 5],
    ['Prepared Speech Session', 'Prepared Speech 1', 6],
    ['Prepared Speech Session', 'Prepared Speech 2', 7],
    ['', 'Social Session', null],
    ['Table Topic Session', 'Table Topics', 8],
    ['Evaluation Session', "First Speaker's Individual Evaluator", 9],
    ['Evaluation Session', "Second Speaker's Individual Evaluator", 10],
    ['Evaluation Session', 'Table Topic Evaluation', 11],
    ['Evaluation Session', "Grammarian's Report", 5],
    ['Evaluation Session', "Timer's Report", 4],
    ['Evaluation Session', 'General Evaluation', 12],
    ['', 'Voting Session', null],
    ['', 'Awarding', null],
    ['', 'Closing Remark', null]
  ].map(([group_label, name, role_slot_id], position) => ({
    id: position + 1, position, group_label, name, role_slot_id, duration_minutes: 3
  }))
};
