import { Link } from 'wouter-preact';
import { authUser } from '../state/auth.js';
import { canEdit } from '../lib/permissions.js';

const tools = [
  {
    href: '/app/misu/users',
    label: 'Users',
    description: 'Review people records and create users for role assignments.',
    readOnlyDescription: 'View people records and role assignments.',
    tone: 'users'
  },
  {
    href: '/app/misu/meetings',
    label: 'Meetings',
    description: 'View and edit all meetings, including archived meetings, newest first.',
    readOnlyDescription: 'View all meetings, including archived meetings, newest first.',
    tone: 'meetings'
  },
  {
    href: '/app/meetings/new',
    label: 'New meeting',
    description: 'Create a meeting from the latest meeting, a template, or blank.',
    tone: 'create'
  }
];

export function MisuPage() {
  return (
    <div class="misu-tools-page">
      <section class="card tool-panel">
        <p class="eyebrow">Data management</p>
        <div class="tool-list">
          {tools.filter((tool) => tool.tone !== 'create' || canEdit(authUser.value)).map((tool) => (
            <Link class="tool-row" href={tool.href} key={tool.href}>
              <span class={`tool-mark ${tool.tone}`} aria-hidden="true">{tool.label.slice(0, 1)}</span>
              <span class="tool-copy"><strong>{tool.label}</strong><small>{canEdit(authUser.value) ? tool.description : tool.readOnlyDescription}</small></span>
              <span class="tool-arrow" aria-hidden="true">→</span>
            </Link>
          ))}
        </div>
      </section>

      <section class="card tool-panel about-tool-panel">
        <Link class="tool-row" href="/app/misu/about">
          <span class="tool-mark about" aria-hidden="true">i</span>
          <span class="tool-copy"><strong>About</strong><small>MISU introduction, meeting information, joining, and contact.</small></span>
          <span class="tool-arrow" aria-hidden="true">→</span>
        </Link>
      </section>
    </div>
  );
}