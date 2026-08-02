import { useEffect } from 'preact/hooks';
import { Link, useLocation } from 'wouter-preact';
import { authUser } from '../state/auth.js';

function isMeetingDetail(location) {
  return /^\/app\/meetings\/\d+\/?$/.test(location);
}

const attendeeRoutes = ['/app/booking', '/app/meeting', '/app/misu', '/app/me'];

function isActive(location, href) {
  return location === href || location.startsWith(href + '/');
}

function NavLink({ href, children, class: className = '', activeWhen }) {
  const [location] = useLocation();
  const active = activeWhen ? activeWhen(location) : isActive(location, href);
  return <Link class={`${className} ${active ? 'active' : ''}`.trim()} href={href}>{children}</Link>;
}

function TabIcon({ name }) {
  const paths = {
    booking: <><rect x="5" y="4" width="14" height="16" rx="2" /><path d="M9 4V3h6v1M8 9h8M8 13h8M8 17h5" /></>,
    meeting: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4M17 3v4M3 10h18M8 14h2M14 14h2M8 18h2" /></>,
    misu: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6" /></>,
    me: <><circle cx="12" cy="8" r="4" /><path d="M4.5 21a7.5 7.5 0 0 1 15 0" /></>
  };
  return <span class="tab-icon" aria-hidden="true"><svg viewBox="0 0 24 24">{paths[name]}</svg></span>;
}

export function AppShell({ children }) {
  const [location] = useLocation();
  const attendee = attendeeRoutes.some((path) => isActive(location, path)) || isMeetingDetail(location);
  const displayName = authUser.value?.display_name?.trim() || 'Personal info';
  const initial = displayName.slice(0, 1).toUpperCase();

  useEffect(() => {
    document.body.classList.toggle('attendee-layout', attendee);
    return () => document.body.classList.remove('attendee-layout');
  }, [attendee]);

  return (
    <>
      <header id="topbar" aria-label="Site header">
        <Link class="brand" href="/app/booking"><span class="mark">M</span><span>MISU</span></Link>
        <nav aria-label="Main navigation">
          <NavLink href="/app/booking">Booking</NavLink>
          <NavLink href="/app/meeting" activeWhen={(path) => isActive(path, '/app/meeting') || isMeetingDetail(path)}>Meeting</NavLink>
          <NavLink href="/app/misu">MISU</NavLink>
        </nav>
        <div class="topbar-user">
          <Link class="topbar-account" href="/app/me" aria-label={`Personal info for ${displayName}`}>
            <span class="topbar-avatar" aria-hidden="true">{initial}</span>
            <span>{displayName}</span>
          </Link>
        </div>
      </header>

      <main id="page">{children}</main>

      {attendee && (
        <nav id="bottombar" aria-label="Tab navigation">
          <ul>
            <li><NavLink href="/app/booking"><TabIcon name="booking" /><span class="tab-label">Booking</span></NavLink></li>
            <li><NavLink href="/app/meeting" activeWhen={(path) => isActive(path, '/app/meeting') || isMeetingDetail(path)}><TabIcon name="meeting" /><span class="tab-label">Meeting</span></NavLink></li>
            <li><NavLink href="/app/misu"><TabIcon name="misu" /><span class="tab-label">MISU</span></NavLink></li>
            <li><NavLink href="/app/me"><TabIcon name="me" /><span class="tab-label">Me</span></NavLink></li>
          </ul>
        </nav>
      )}
    </>
  );
}