import { useEffect, useState } from 'react';
import { api } from '../api';

const NEW = 'new';

// Reached from an invite link (?join=CODE). Lets you claim an existing member profile
// (keeping its RSVP history) or join as a new member.
export default function JoinBand({ code, user, instruments, onJoined, onCancel }) {
  const [invite, setInvite] = useState(null);
  const [error, setError] = useState('');
  const [choice, setChoice] = useState(NEW);
  const [name, setName] = useState(user.display_name);
  const [instrumentId, setInstrumentId] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.invite(code)
      .then((data) => {
        if (data.already_member) onJoined(data.band);
        else setInvite(data);
      })
      .catch((e) => setError(e.message));
  }, [code, onJoined]);

  async function handleJoin(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const band = await api.joinBand(
        code,
        choice === NEW ? { name, instrument_id: instrumentId || null } : { member_id: Number(choice) }
      );
      onJoined(band);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  if (error && !invite) {
    return (
      <div className="empty">
        <h2>Can’t join</h2>
        <p>{error}</p>
        <button className="ghost" onClick={onCancel}>Continue</button>
      </div>
    );
  }
  if (!invite) return <p className="muted">Loading invite…</p>;

  return (
    <form className="card form join" onSubmit={handleJoin}>
      <h1>Join {invite.band.name}</h1>

      {invite.unclaimed_members.length > 0 && (
        <p className="muted">
          If your bandmates already added you, pick your name to keep your RSVPs. Otherwise join as a new member.
        </p>
      )}

      <div className="choices" role="radiogroup">
        {invite.unclaimed_members.map((m) => (
          <label key={m.id} className={`choice ${choice === String(m.id) ? 'selected' : ''}`}>
            <input
              type="radio"
              name="who"
              value={m.id}
              checked={choice === String(m.id)}
              onChange={(e) => setChoice(e.target.value)}
            />
            <span>
              <strong>I’m {m.name}</strong>
              {m.instrument && <span className="muted"> · {m.instrument}</span>}
            </span>
          </label>
        ))}
        <label className={`choice ${choice === NEW ? 'selected' : ''}`}>
          <input type="radio" name="who" value={NEW} checked={choice === NEW} onChange={() => setChoice(NEW)} />
          <span><strong>Join as a new member</strong></span>
        </label>
      </div>

      {choice === NEW && (
        <div className="row">
          <label className="field">
            <span className="label">Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label className="field">
            <span className="label">Instrument</span>
            <select value={instrumentId} onChange={(e) => setInstrumentId(e.target.value)}>
              <option value="">Choose…</option>
              {instruments.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </label>
        </div>
      )}

      {error && <p className="form-error" role="alert">{error}</p>}

      <div className="form-actions">
        <button type="button" className="ghost" onClick={onCancel}>Not now</button>
        <button type="submit" className="primary" disabled={busy}>{busy ? 'Joining…' : 'Join band'}</button>
      </div>
    </form>
  );
}
