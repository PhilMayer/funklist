import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import AuthPage from './components/AuthPage';
import CreateBand from './components/CreateBand';
import EventList from './components/EventList';
import EventDetail from './components/EventDetail';
import EventForm from './components/EventForm';
import JoinBand from './components/JoinBand';
import Landing from './components/Landing';
import MembersPanel from './components/MembersPanel';
import ResetPassword from './components/ResetPassword';
import AccountSettings from './components/AccountSettings';
import { notifiedMessage } from './messages';

const load = (key) => {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
};
const save = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
};

const readJoinCode = () => new URLSearchParams(window.location.search).get('join');
// Password reset links look like /?reset=TOKEN. The token is removed from the address bar right away.
function takeResetToken() {
  const url = new URL(window.location.href);
  const token = url.searchParams.get('reset');
  if (token) {
    url.searchParams.delete('reset');
    window.history.replaceState(null, '', url);
  }
  return token;
}
// Links to an event (e.g. from notification emails) look like /?event=123.
const readEventId = () => Number(new URLSearchParams(window.location.search).get('event')) || null;

const clearJoinCode = () => {
  const url = new URL(window.location.href);
  url.searchParams.delete('join');
  window.history.replaceState(null, '', url);
};

// Signed-out visitors see the landing page, unless the address is /?signin or /?signup (its buttons),
// or an invite or event link, which go straight to sign-in. null = landing page.
function readAuthMode() {
  const params = new URLSearchParams(window.location.search);
  if (params.has('signup')) return 'register';
  if (params.has('signin') || params.has('join') || params.has('event')) return 'signin';
  return null;
}
// The current address with ?signin / ?signup set for `mode` ('signin' | 'register' | null for neither).
function authModeUrl(mode) {
  const url = new URL(window.location.href);
  url.hash = ''; // drop the landing page's #section links
  url.searchParams.delete('signin');
  url.searchParams.delete('signup');
  const flag = { signin: 'signin', register: 'signup' }[mode];
  if (flag) url.search = url.search ? `${url.search}&${flag}` : `?${flag}`;
  return url;
}

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = still checking the session
  const [googleClientId, setGoogleClientId] = useState(null);
  const [joinCode, setJoinCode] = useState(readJoinCode);
  const [resetToken, setResetToken] = useState(takeResetToken);
  const [authMode, setAuthMode] = useState(readAuthMode);

  // Signed out (or the session expired): back to the sign-in page.
  const showSignIn = useCallback(() => {
    window.history.replaceState(null, '', authModeUrl('signin'));
    setAuthMode('signin');
    setUser(null);
  }, []);

  useEffect(() => {
    Promise.all([api.me(), api.authConfig()])
      .then(([{ user }, config]) => {
        setUser(user);
        setGoogleClientId(config.googleClientId);
      })
      .catch(() => setUser(null));
    window.addEventListener('funklist:signed-out', showSignIn);
    // Back and Forward move between the landing page and the sign-in page.
    const onPopState = () => setAuthMode(readAuthMode());
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('funklist:signed-out', showSignIn);
      window.removeEventListener('popstate', onPopState);
    };
  }, [showSignIn]);

  // Each move between the landing and sign-in pages is a history entry, so Back works.
  const openAuthMode = useCallback((mode) => {
    window.history.pushState(null, '', authModeUrl(mode));
    setAuthMode(mode);
    window.scrollTo(0, 0);
  }, []);

  const signedIn = useCallback((u) => {
    window.history.replaceState(null, '', authModeUrl(null));
    setUser(u);
  }, []);

  const doneJoining = useCallback(() => {
    clearJoinCode();
    setJoinCode(null);
  }, []);

  async function signOut() {
    await api.logout().catch(() => {});
    showSignIn();
  }

  if (user === undefined) return <div className="splash muted">Loading…</div>;
  if (resetToken) {
    return (
      <ResetPassword
        token={resetToken}
        onDone={(u) => { setResetToken(null); signedIn(u); }}
        onCancel={() => { setResetToken(null); setAuthMode('signin'); }}
      />
    );
  }
  if (!user && !authMode) return <Landing onStart={openAuthMode} />;
  if (!user) {
    return (
      <AuthPage
        key={authMode}
        initialMode={authMode}
        googleClientId={googleClientId}
        joining={Boolean(joinCode)}
        onSignedIn={signedIn}
        onHome={() => openAuthMode(null)}
      />
    );
  }
  return (
    <SignedInApp
      key={user.id}
      user={user}
      joinCode={joinCode}
      onDoneJoining={doneJoining}
      onSignOut={signOut}
      onUserUpdated={setUser}
    />
  );
}

function SignedInApp({ user, joinCode, onDoneJoining, onSignOut, onUserUpdated }) {
  const [bands, setBands] = useState(null);
  const [bandId, setBandId] = useState(() => load('funklist.bandId'));
  const [members, setMembers] = useState([]);
  const [instruments, setInstruments] = useState([]);
  // view: list | event {id} | new {template?} | edit {event} | members | create-band | account
  const [view, setView] = useState(() => {
    const eventId = readEventId();
    return eventId ? { name: 'event', id: eventId } : { name: 'list' };
  });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(null); // { eventId, text } shown on that event's page

  const refreshBands = useCallback(
    () => api.bands().then((b) => {
      setBands(b);
      return b;
    }),
    []
  );

  useEffect(() => {
    refreshBands()
      .then((b) => {
        setBandId((current) => (b.some((x) => x.id === current) ? current : b[0]?.id ?? null));
        // Opened from an event link: switch to that event's band.
        const eventId = readEventId();
        if (eventId) {
          api.event(eventId)
            .then((ev) => setBandId(ev.band_id))
            .catch(() => {
              setError('That event isn’t available. It may have been deleted, or you’re not in its band.');
              setView({ name: 'list' });
            });
        }
      })
      .catch((e) => setError(e.message));
  }, [refreshBands]);

  // Keep ?event=ID in the address bar while viewing an event, so the page can be shared or reloaded.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (view.name === 'event') url.searchParams.set('event', view.id);
    else url.searchParams.delete('event');
    if (url.href !== window.location.href) window.history.replaceState(null, '', url);
  }, [view]);

  // Only load members for a band the user is actually in. The remembered band can be stale
  // (left the band, or someone else used this browser) until the band list has loaded.
  const bandReady = Boolean(bands?.some((b) => b.id === bandId));
  const refreshMembers = useCallback(() => {
    if (!bandReady) return setMembers([]);
    api.members(bandId).then(setMembers).catch((e) => setError(e.message));
  }, [bandId, bandReady]);

  useEffect(() => {
    if (bandReady) save('funklist.bandId', bandId);
    setMembers([]);
    refreshMembers();
  }, [bandId, bandReady, refreshMembers]);

  // Each band has its own instruments (and quorum minimums).
  useEffect(() => {
    setInstruments([]);
    if (bandReady) api.bandInstruments(bandId).then(setInstruments).catch((e) => setError(e.message));
  }, [bandId, bandReady]);

  const me = members.find((m) => m.is_me) || null;

  const openBand = useCallback(async (band) => {
    await refreshBands().catch((e) => setError(e.message));
    setBandId(band.id);
    setView({ name: 'list' });
  }, [refreshBands]);

  const handleJoined = useCallback((band) => {
    onDoneJoining();
    openBand(band);
  }, [onDoneJoining, openBand]);

  if (bands === null) return <div className="splash muted">Loading…</div>;

  const band = bands.find((b) => b.id === bandId);
  let body;
  if (joinCode) {
    body = (
      <JoinBand code={joinCode} user={user} onJoined={handleJoined} onCancel={onDoneJoining} />
    );
  } else if (view.name === 'account') {
    body = (
      <AccountSettings
        user={user}
        onUserUpdated={onUserUpdated}
        onBack={() => setView({ name: 'list' })}
        onError={setError}
      />
    );
  } else if (view.name === 'create-band' || !band) {
    body = (
      <>
        {!band && (
          <div className="welcome">
            <h2>Welcome, {user.display_name}!</h2>
            <p className="muted">
              Create a band below, or open an invite link from a bandmate to join theirs.
            </p>
            <p className="muted small-text">
              Already in a band? You may have signed up another way (Google or a username): sign out and
              sign in that way.
            </p>
          </div>
        )}
        <CreateBand
          onCreated={openBand}
          onCancel={band ? () => setView({ name: 'list' }) : undefined}
        />
      </>
    );
  } else {
    body = (
      <>
        <nav className="tabs">
          <button className={view.name !== 'members' ? 'active' : ''} onClick={() => setView({ name: 'list' })}>
            Events
          </button>
          <button className={view.name === 'members' ? 'active' : ''} onClick={() => setView({ name: 'members' })}>
            Members ({members.length})
          </button>
        </nav>

        {view.name === 'list' && (
          <EventList
            bandId={bandId}
            me={me}
            onOpen={(id) => setView({ name: 'event', id })}
            onNew={() => setView({ name: 'new' })}
            onError={setError}
          />
        )}
        {view.name === 'event' && (
          <EventDetail
            eventId={view.id}
            me={me}
            members={members}
            instruments={instruments}
            onBack={() => setView({ name: 'list' })}
            onEdit={(event) => setView({ name: 'edit', event })}
            onDuplicate={(event) => setView({ name: 'new', template: event })}
            onNotice={(text) => setNotice(text ? { eventId: view.id, text } : null)}
            onError={setError}
          />
        )}
        {(view.name === 'new' || view.name === 'edit') && (
          <EventForm
            bandId={bandId}
            members={members}
            initial={view.event}
            template={view.template}
            onCancel={() => {
              const from = view.event || view.template; // back to the event being edited or copied
              setView(from ? { name: 'event', id: from.id } : { name: 'list' });
            }}
            onSaved={(event) => {
              setView({ name: 'event', id: event.id });
              const text = view.name === 'new' ? notifiedMessage(event) : '';
              setNotice(text ? { eventId: event.id, text } : null);
            }}
          />
        )}
        {view.name === 'members' && (
          <MembersPanel
            bandId={bandId}
            members={members}
            instruments={instruments}
            setInstruments={setInstruments}
            isAdmin={Boolean(me?.is_admin)}
            onChanged={refreshMembers}
            onLeft={() => refreshBands().then((b) => setBandId(b[0]?.id ?? null))}
            onError={setError}
          />
        )}
      </>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={() => setView({ name: 'list' })}>
          <span className="brand-mark">♫</span> Funklist
        </button>

        <div className="topbar-controls">
          {bands.length > 0 && (
            <label>
              <span>Band</span>
              <select
                value={bandId ?? ''}
                onChange={(e) => {
                  setBandId(Number(e.target.value));
                  setView({ name: 'list' });
                }}
              >
                {bands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>
          )}
          {bands.length > 0 && (
            <button className="ghost" onClick={() => setView({ name: 'create-band' })}>+ Band</button>
          )}
          <div className="user-chip">
            <span className="avatar" aria-hidden="true">{user.display_name.slice(0, 1).toUpperCase()}</span>
            <span className="user-name">
              {user.display_name}
              {me?.instrument && <span className="muted"> · {me.instrument}</span>}
            </span>
            <button className="ghost small" onClick={() => setView({ name: 'account' })}>Account</button>
            <button className="ghost small" onClick={onSignOut}>Sign out</button>
          </div>
        </div>
      </header>

      {error && (
        <div className="banner error" onClick={() => setError('')}>{error} <span>✕</span></div>
      )}
      {notice && view.name === 'event' && view.id === notice.eventId && (
        <div className="banner info" role="status" onClick={() => setNotice(null)}>{notice.text} <span>✕</span></div>
      )}

      <main className="content">{body}</main>
    </div>
  );
}
