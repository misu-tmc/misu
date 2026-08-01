import { useEffect, useState } from 'preact/hooks';
import { Redirect, Route, Switch, useLocation } from 'wouter-preact';
import { AppShell } from './components/AppShell.jsx';
import { PageLoading } from './components/PageState.jsx';
import { authApi } from './lib/api.js';
import { trySilentLogin } from './lib/authDevice.js';
import { authReady, authUser } from './state/auth.js';
import { BookingPage } from './pages/BookingPage.jsx';
import { AgendaPage } from './pages/AgendaPage.jsx';
import { CheckinPage } from './pages/CheckinPage.jsx';
import { EditorPage } from './pages/EditorPage.jsx';
import { LoginPage } from './pages/LoginPage.jsx';
import { MeetingPage } from './pages/MeetingPage.jsx';
import { MeetingsPage } from './pages/MeetingsPage.jsx';
import { MePage } from './pages/MePage.jsx';
import { MisuPage } from './pages/MisuPage.jsx';
import { VotePage } from './pages/VotePage.jsx';
import { VoteResultPage } from './pages/VoteResultPage.jsx';
import { UsersPage } from './pages/UsersPage.jsx';

function LoginRedirect({ location }) {
  useEffect(() => {
    const loginPath = import.meta.env.DEV ? '/app/login' : '/login';
    window.location.assign(`${loginPath}?next=${encodeURIComponent(location)}`);
  }, [location]);
  return <PageLoading label="Opening sign in…" />;
}

function NotFoundPage() {
  return (
    <div class="page-empty">
      <h2>Page not found</h2>
      <p>The requested MISU page does not exist.</p>
      <a class="btn btn-ghost btn-sm" href="/app/booking">Go to booking</a>
    </div>
  );
}

function ProtectedApp() {
  const [checking, setChecking] = useState(!authReady.value);
  const [location] = useLocation();

  useEffect(() => {
    let active = true;
    async function authenticate() {
      let user = null;
      try {
        const response = await authApi.me();
        user = response.user ?? response;
      } catch (_) {
        user = await trySilentLogin().catch(() => null);
      }
      if (!active) return;
      authUser.value = user;
      authReady.value = true;
      setChecking(false);
    }
    if (!authReady.value) authenticate();
    else setChecking(false);
    return () => { active = false; };
  }, []);

  if (checking) return <PageLoading label="Checking your account…" />;
  if (!authUser.value) return <LoginRedirect location={location} />;

  return (
    <AppShell>
      <Switch>
        <Route path="/app/booking" component={BookingPage} />
        <Route path="/app/meeting" component={MeetingPage} />
        <Route path="/app/checkin" component={CheckinPage} />
        <Route path="/app/vote/:meetingId" component={VotePage} />
        <Route path="/app/vote-result/:meetingId" component={VoteResultPage} />
        <Route path="/app/me" component={MePage} />
        <Route path="/app/misu" component={MisuPage} />
        <Route path="/app/meetings/new" component={EditorPage} />
        <Route path="/app/meetings/:id/edit" component={EditorPage} />
        <Route path="/app/meetings/:id/agenda" component={AgendaPage} />
        <Route path="/app/meetings" component={MeetingsPage} />
        <Route path="/app/users" component={UsersPage} />
        <Route component={NotFoundPage} />
      </Switch>
    </AppShell>
  );
}

export function App() {
  return (
    <Switch>
      <Route path="/login" component={LoginPage} />
      <Route path="/app/login" component={LoginPage} />
      <Route path="/app/*" component={ProtectedApp} />
      <Route><Redirect to="/app/booking" /></Route>
    </Switch>
  );
}