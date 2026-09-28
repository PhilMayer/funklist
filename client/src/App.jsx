import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import AuthPage from './components/AuthPage';
import CreateBand from './components/CreateBand';
import EventList from './components/EventList';
import EventDetail from './components/EventDetail';
import EventForm from './components/EventForm';
import JoinBand from './components/JoinBand';
import MembersPanel from './components/MembersPanel';

const load = (key) => {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
};
const save = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
};

const readJoinCode = () => new URLSearchParams(window.location.search).get('join');
const clearJoinCode = () => {
  const url = new URL(window.location.href);
  url.searchParams.delete('join');
  window.history.replaceState(null, '', url);
};

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = still checking the session
  const [googleClientId, setGoogleClientId] = useState(null);
  const [joinCode, setJoinCode] = useState(readJoinCode);

  useEffect(() => {
    Promise.all([api.me(), api.authConfig()])
      .then(([{ user }, config]) => {
        setUser(user);
        setGoogleClientId(config.googleClientId);
      })
      .catch(() => setUser(null));
    const onSignedOut = () => setUser(null);
    window.addEventListener('funklist:signed-out', onSignedOut);
    return () => window.removeEventListener('funklist:signed-out', onSignedOut);
  }, []);

  const doneJoining = useCallback(() => {
    clearJoinCode();
    setJoinCode(null);
  }, []);

  async function signOut() {
    await api.logout().catch(() => {});
    setUser(null);
  }

  if (user === undefined) return <div className="splash muted">Loading…</div>;
  if (!user) {
    return <AuthPage googleClientId={googleClientId} joining={Boolean(joinCode)} onSignedIn={setUser} />;
  }
  return (
    <SignedInApp key={user.id} user={user} joinCode={joinCode} onDoneJoining={doneJoining} onSignOut={signOut} />
  );
}

function SignedInApp({ user, joinCode, onDoneJoining, onSignOut }) {
  const [bands, setBands] = useState(null);
  const [bandId, setBandId] = useState(() => load('funklist.bandId'));
  const [members, setMembers] = useState([]);
  const [instruments, setInstruments] = useState([]);
  // view: list | event {id} | new | edit {event} | members | create-band
  const [view, setView] = useState({ name: 'list' });
  const [error, setError] = useState('');

  const refreshBands = useCallback(
    () => api.bands().then((b) => {
      setBands(b);
      return b;
    }),
    []
  );

  useEffect(() => {
    Promise.all([refreshBands(), api.instruments()])
      .then(([b, i]) => {
        setInstruments(i);
        setBandId((current) => (b.some((x) => x.id === current) ? current : b[0]?.id ?? null));
      })
      .catch((e) => setError(e.message));
  }, [refreshBands]);

  const refreshMembers = useCallback(() => {
    if (!bandId) return setMembers([]);
    api.members(bandId).then(setMembers).catch((e) => setError(e.message));
  }, [bandId]);

  useEffect(() => {
    save('funklist.bandId', bandId);
    setMembers([]);
    refreshMembers();
  }, [bandId, refreshMembers]);

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
      <JoinBand code={joinCode} user={user} instruments={instruments} onJoined={handleJoined} onCancel={onDoneJoining} />
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
          </div>
        )}
        <CreateBand
          instruments={instruments}
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
            instruments={instruments}
            onBack={() => setView({ name: 'list' })}
            onEdit={(event) => setView({ name: 'edit', event })}
            onError={setError}
          />
        )}
        {(view.name === 'new' || view.name === 'edit') && (
          <EventForm
            bandId={bandId}
            initial={view.event}
            onCancel={() => setView(view.event ? { name: 'event', id: view.event.id } : { name: 'list' })}
            onSaved={(event) => setView({ name: 'event', id: event.id })}
          />
        )}
        {view.name === 'members' && (
          <MembersPanel
            bandId={bandId}
            members={members}
            instruments={instruments}
            setInstruments={setInstruments}
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
            <button className="ghost small" onClick={onSignOut}>Sign out</button>
          </div>
        </div>
      </header>

      {error && (
        <div className="banner error" onClick={() => setError('')}>{error} <span>✕</span></div>
      )}

      <main className="content">{body}</main>
    </div>
  );
}
