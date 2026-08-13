import { toPng } from 'html-to-image';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Link } from 'wouter-preact';
import { meetingsApi } from '../lib/api.js';
import { buildAgenda, buildSpeeches } from '../lib/format.js';
import { PageError, PageLoading } from '../components/PageState.jsx';

const REGULAR_ROLES = [
  ['Timer', 'Monitors the time of meeting segments and speakers.'],
  ['Ah-Counter', 'Notes any overused words or filler sounds.'],
  ['Grammarian', 'Helps members improve their grammar and vocabulary.'],
  ['Toastmaster of the Evening (TOE)', "The meeting's director and host."],
  ['Prepared Speaker', 'Delivers a prepared speech following Pathways guidance.'],
  ['Table Topics Master (TTM)', 'Runs the Table Topics session.'],
  ['Individual Evaluator (IE)', 'Provides verbal and written feedback to speakers.'],
  ['Table Topics Evaluator (TTE)', 'Evaluates everyone who delivers a table topic.'],
  ['General Evaluator (GE)', 'Evaluates the meeting and its role takers.']
];

const PATHWAYS = [
  ['dynamic-leadership.png', 'Dynamic Leadership'],
  ['visionary-communication.png', 'Visionary Communication'],
  ['engaging-humor.png', 'Engaging Humor'],
  ['presentation-mastery.png', 'Presentation Mastery'],
  ['persuasive-influence.png', 'Persuasive Influence'],
  ['motivational-strategies.png', 'Motivational Strategies']
];

function printDate(date) {
  if (!date) return '';
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return `${parsed.getFullYear()}.${String(parsed.getMonth() + 1).padStart(2, '0')}.${String(parsed.getDate()).padStart(2, '0')}`;
}

function download(dataUrl, filename) {
  const anchor = document.createElement('a');
  anchor.download = filename;
  anchor.href = dataUrl;
  anchor.click();
}

function groupedAgendaRows(rows) {
  const grouped = [];
  let lastGroup = null;
  rows.forEach((row) => {
    const group = row.group_label || '';
    if (group && group !== lastGroup) grouped.push({ type: 'group', id: `group-${row.id}`, label: group });
    grouped.push({ type: 'session', ...row });
    lastGroup = group;
  });
  return grouped;
}

function previewScale() {
  return Math.min(1, (window.innerWidth - 24) / (210 * 96 / 25.4));
}

export function AgendaPage({ params }) {
  const meetingId = Number(params.id);
  const [meeting, setMeeting] = useState(null);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [scale, setScale] = useState(previewScale);
  const frontRef = useRef(null);
  const backRef = useRef(null);

    useEffect(() => {
      document.body.classList.add('agenda-print-layout');
      meetingsApi.get(meetingId).then(setMeeting).catch((err) => setError(err.message || 'Could not load agenda.'));
      const resize = () => setScale(previewScale());
      window.addEventListener('resize', resize);
      return () => {
        document.body.classList.remove('agenda-print-layout');
        window.removeEventListener('resize', resize);
      };
    }, [meetingId]);

    useEffect(() => {
      if (!meeting || !frontRef.current) return undefined;
      const previousTitle = document.title;
      document.title = `MISU · Agenda #${meeting.number}`;
      const frame = window.requestAnimationFrame(() => {
        const sheet = frontRef.current;
        const panel = sheet.querySelector('.print-agenda-panel');
        const table = panel?.querySelector('table');
        let fontSize = 12;
        let rowGap = 1;
        let attempts = 0;
        while (panel && table && panel.scrollHeight > panel.clientHeight + 1 && attempts < 30) {
          if (fontSize > 8) fontSize -= 0.5;
          else if (rowGap > 0.3) rowGap = Math.max(0.3, rowGap - 0.1);
          else break;
          sheet.style.setProperty('--agenda-font-size', `${fontSize}px`);
          table.style.setProperty('--agenda-row-gap', `${rowGap}mm`);
          attempts += 1;
        }
      });
      return () => {
        window.cancelAnimationFrame(frame);
        document.title = previousTitle;
      };
    }, [meeting]);

    async function savePngs() {
      setExporting(true);
      setError('');
      try {
        const sheets = [frontRef.current, backRef.current];
        const stem = `misu-agenda-${meeting.number}`;
        for (let index = 0; index < sheets.length; index += 1) {
          const dataUrl = await toPng(sheets[index], { backgroundColor: '#ffffff', cacheBust: true, pixelRatio: 2 });
          download(dataUrl, `${stem}-page-${index + 1}.png`);
        }
      } catch (err) {
        setError(err.message || 'Could not save agenda images.');
      } finally {
        setExporting(false);
      }
    }

    if (error && !meeting) return <PageError message={error} />;
    if (!meeting) return <PageLoading label="Loading agenda…" />;

    const agendaRows = groupedAgendaRows(buildAgenda(meeting));
    const speeches = buildSpeeches(meeting);
    const manager = meeting.role_slots?.find((slot) => String(slot.role_name || '').toLowerCase() === 'meeting manager')?.taker_name || '';
    const photographer = meeting.role_slots?.find((slot) => String(slot.role_name || '').toLowerCase() === 'photographer')?.taker_name || '';

    return (
      <div class="print-agenda-page">
        <div class="print-agenda-toolbar no-print">
          <Link class="btn btn-ghost btn-sm" href={`/app/meetings/${meetingId}/edit`}>Editor</Link>
          <button class="btn btn-secondary btn-sm" type="button" onClick={() => window.print()}>Save PDF</button>
          <button class="btn btn-primary btn-sm" type="button" disabled={exporting} onClick={savePngs}>{exporting ? 'Saving…' : 'Save PNGs'}</button>
        </div>
        {error && <p class="error-msg print-agenda-error" role="alert">{error}</p>}
        <div class="print-agenda-stage" style={{ width: `${210 * 96 / 25.4 * scale}px`, height: `${297 * 96 / 25.4 * scale}px` }}>
        <div class="print-agenda-scale" style={{ transform: `scale(${scale})` }}>
        <article class="print-agenda-sheet" ref={frontRef}>
          <header class="print-agenda-top">
            <div class="print-agenda-tm-logo"><img src="/static/Toastmasters_2011.png" alt="Toastmasters International" /></div>
            <div class="print-agenda-club-wrap">
              <div class="print-agenda-club-brand">
                <div class="name"><span class="brand-m">M</span><span class="brand-i">i</span>crosoft <span class="brand-s">S</span><span class="brand-u">u</span>zhou Toastmasters Club</div>
                <div class="ids">Club #07964606 · Division R Area 3 · District 128</div>
              </div>
              <div class="print-agenda-ms-logo"><img src="/static/Microsoft_logo.svg" alt="Microsoft" /></div>
            </div>
          </header>
          <main class="print-agenda-front-body">
            <aside class="print-agenda-sidebar">
              <section><h4>MISU Mission</h4><p>To empower every individual to grow into an inspiring communicator and authentic leader.</p></section>
              <section><h4>Regular Meeting</h4><p><b>Time: </b>Every alternate Monday, 18:45–21:00<br /><b>Venue: </b>B26 Room 1.1B, Microsoft Suzhou<br />微软苏州研发中心 B26 幢一楼会议室1.1B</p></section>
              <section><h4>Meeting Team</h4><p>Meeting Manager: {manager}<br />Photographer: {photographer}</p></section>
              <section><h4>Officer Team</h4><p>President: Cecily Wang<br />VPE: Chao Chen<br />VPM: Serena Zhan<br />VPPR: Sophia Chen<br />Secretary: Jiajia Bao<br />Treasurer: Johnny Yao<br />SAA: Tao Lu</p></section>
              <section><h4>How to join us?</h4><ul><li>Attend at least three meetings and participate in Table Topics at least once.</li><li>Submit the new member application form to VPM.</li><li>Interview with President, VPE, or VPM.</li></ul></section>
              <section class="print-agenda-qr-list">
                <div><img src="/static/VPM QR code.jpg" alt="VPM QR code" /><span>VPM: Serena Zhan</span></div>
                <div><img src="/static/Guest Fee QRCode.png" alt="Guest fee QR code" /><span>Guest Fee ¥20</span></div>
              </section>
            </aside>
            <div class="print-agenda-tables">
              <section class="print-agenda-session-area">
                <div class="print-agenda-meeting-info">
                  <h1>{meeting.title} #{meeting.number}</h1>
                  <p><strong>Theme:</strong> {meeting.theme || ''}</p>
                  <p><strong>Time:</strong> {printDate(meeting.date)} · {meeting.start_time || ''}{meeting.end_time ? `–${meeting.end_time}` : ''}</p>
                  <p><strong>Keyword:</strong> {meeting.keyword || ''}</p>
                  <p><strong>Venue:</strong> {meeting.venue || ''}</p>
                </div>
                <div class="print-agenda-panel">
                  <table>
                    <thead><tr><th>Time</th><th>Sessions</th><th>Duration</th><th>Takers</th></tr></thead>
                    <tbody>{agendaRows.map((row) => row.type === 'group'
                      ? <tr class="group-row" key={row.id}><td colspan="4">{row.label}</td></tr>
                      : <tr key={row.id}><td>{row.start}</td><td><span>{row.name}</span>{row.prepMeta && <small>{row.prepMeta}</small>}</td><td>0:{String(Number(row.duration_minutes) || 0).padStart(2, '0')}</td><td>{row.taker}</td></tr>)}</tbody>
                  </table>
                </div>
              </section>
              <section class="print-agenda-timer">
                <h2>Timer Guide</h2>
                <table>
                  <thead><tr><th>Speech Type</th><th class="green">Green</th><th class="yellow">Yellow</th><th class="red">Red</th><th>Ring Bell</th></tr></thead>
                  <tbody>
                    <tr><td>Prepared Speech</td><td class="green">2 min left</td><td class="yellow">1 min left</td><td class="red" rowspan="4">Time is up!<br />30” to finish</td><td rowspan="4">Stop immediately</td></tr>
                    <tr><td>Table Topic</td><td class="green">1 min left</td><td class="yellow">30” left</td></tr>
                    <tr><td>Individual Evaluator</td><td class="green">1 min left</td><td class="yellow">30” left</td></tr>
                    <tr><td>Role Taker</td><td class="green">1 min left</td><td class="yellow">30” left</td></tr>
                  </tbody>
                </table>
              </section>
            </div>
          </main>
        </article>
        </div>
        </div>
        <div class="print-agenda-stage" style={{ width: `${210 * 96 / 25.4 * scale}px`, height: `${297 * 96 / 25.4 * scale}px` }}>
        <div class="print-agenda-scale" style={{ transform: `scale(${scale})` }}>
        <article class="print-agenda-sheet print-agenda-back" ref={backRef}>
          <header class="print-agenda-top print-agenda-back-top">
            <div class="print-agenda-tm-logo"><img src="/static/Toastmasters_2011.png" alt="Toastmasters International" /></div>
            <div><h2>Introduction of Toastmasters</h2><p>Toastmasters International is a non-profit educational organization that teaches public speaking and leadership skills through a worldwide network of clubs. Founded in 1924, it helps people from diverse backgrounds become more confident speakers, communicators, and leaders.</p></div>
          </header>
          <main class="print-agenda-back-body">
            <section class="print-agenda-values-row">
              <div><h3>Four Core Values</h3><div class="print-agenda-values"><span>Integrity</span><span>Respect</span><span>Service</span><span>Excellence</span></div></div>
              <div><h3>Four Taboos</h3><p>Politics · Religion · Race · Sex</p></div>
            </section>
            <section class="print-agenda-speeches">
              <h3>Today's Prepared Speeches</h3>
              {speeches.length === 0 && <p>No prepared speeches yet.</p>}
              {speeches.map((speech) => <article key={speech.id}><h4>{speech.title}</h4>{speech.speaker && <p><b>Speaker:</b> {speech.speaker}</p>}{speech.meta && <p><b>Pathway:</b> {speech.meta}</p>}{speech.purpose && <p><b>Purpose:</b> {speech.purpose}</p>}{speech.description && <p><b>Description:</b> {speech.description}</p>}</article>)}
            </section>
            <section class="print-agenda-education">
              <div class="print-agenda-roles"><h3>Regular Meeting Roles</h3>{REGULAR_ROLES.map(([name, description]) => <div key={name}><h4>{name}</h4><p>{description}</p></div>)}</div>
              <div class="print-agenda-pathways">
                <h3>Education System: Pathways — 6 Paths</h3>
                <div class="print-agenda-path-grid">{PATHWAYS.map(([image, name]) => <div key={name}><img src={`/static/tm-badges/${image}`} alt="" /><span>{name}</span></div>)}</div>
                <div class="print-agenda-levels"><span><b>1</b>Public Speaking</span><span><b>2</b>Interpersonal Communication</span><span><b>3</b>Strategic Leadership</span><span><b>4</b>Management</span><span><b>5</b>Confidence</span></div>
              </div>
            </section>
            <section class="print-agenda-process">
              <div><h3>Regular Meeting Process</h3><ol><li><b>Prepared Speech Session:</b> members deliver prepared speeches.</li><li><b>Table Topic Session:</b> members and guests give 1–2 minute impromptu speeches.</li><li><b>Evaluation Session:</b> evaluators give feedback to speakers and role takers.</li></ol></div>
              <div><img src="/static/Guest Fee QRCode.png" alt="Guest fee QR code" /><span>Guest Fee ¥20</span></div>
            </section>
          </main>
        </article>
        </div>
        </div>
      </div>
    );
}