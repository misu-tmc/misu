import { useEffect } from 'preact/hooks';
import { Link, useLocation } from 'wouter-preact';
import { authApi } from '../lib/api.js';
import { authUser } from '../state/auth.js';

const attendeeRoutes = ['/app/booking', '/app/meeting', '/app/misu', '/app/me'];

function isActive(location, href) {
  return location === href || location.startsWith(href + '/');
}

function NavLink({ href, children, class: className = '' }) {
  const [location] = useLocation();
  return <Link class={`${className} ${isActive(location, href) ? 'active' : ''}`.trim()} href={href}>{children}</Link>;
}

export function AppShell({ children }) {
  const [location] = useLocation();
  const attendee = attendeeRoutes.some((path) => isActive(location, path));

  useEffect(() => {
    document.body.classList.toggle('attendee-layout', attendee);
    return () => document.body.classList.remove('attendee-layout');
  }, [attendee]);

  async function logout() {
    await authApi.logout().catch(() => {});
    authUser.value = null;
    window.location.assign('/login');
  }

  return (
    <>
      <header id="topbar" aria-label="Site header">
        <Link class="brand" href="/app/booking"><span class="mark">M</span><span>MISU</span></Link>
        <nav aria-label="Main navigation">
          <NavLink href="/app/booking">Booking</NavLink>
          <NavLink href="/app/meeting">Meeting</NavLink>
          <NavLink href="/app/meetings">Manage</NavLink>
          <NavLink href="/app/users">Users</NavLink>
          <NavLink href="/app/misu">MISU</NavLink>
        </nav>
        <div class="topbar-user">
          <span class="topbar-name">{authUser.value?.display_name || ''}</span>
          <NavLink href="/app/me">Account</NavLink>
          <button class="topbar-logout" type="button" onClick={logout}>Sign out</button>
        </div>
      </header>

      <main id="page">{children}</main>

      {attendee && (
        <nav id="bottombar" aria-label="Tab navigation">
          <ul>
            <li><NavLink href="/app/booking"><span class="tab-icon" aria-hidden="true">B</span>Booking</NavLink></li>
            <li><NavLink href="/app/meeting"><span class="tab-icon" aria-hidden="true">M</span>Meeting</NavLink></li>
            <li><NavLink href="/app/misu"><span class="tab-icon" aria-hidden="true">i</span>MISU</NavLink></li>
            <li><NavLink href="/app/me"><span class="tab-icon" aria-hidden="true">Me</span>Me</NavLink></li>
          </ul>
        </nav>
      )}
    </>
  );
}