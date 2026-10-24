import { useEffect, useState } from 'react';
import { api } from '../api';
import InstrumentsEditor from './InstrumentsEditor';
import { cleanRows, toRows } from './instrumentRows';

export default function CreateBand({ onCreated, onCancel }) {
  const [name, setName] = useState('');
  const [rows, setRows] = useState(null); // instrument list, pre-filled with the default lineup
  const [myInstrument, setMyInstrument] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.instrumentDefaults().then((list) => setRows(toRows(list))).catch((e) => setError(e.message));
  }, []);

  const instrumentNames = rows ? cleanRows(rows).map((r) => r.name) : [];

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      onCreated(await api.createBand(name, cleanRows(rows), instrumentNames.includes(myInstrument) ? myInstrument : ''));
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form className="card form" onSubmit={handleSubmit}>
      <h1>Create a band</h1>
      <p className="muted">You’ll be its first member and its admin. Invite bandmates from the Members tab afterwards.</p>
      <label className="field">
        <span className="label">Band name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
      </label>

      <div className="field">
        <span className="label">Instruments and quorum</span>
        <p className="muted small-text">
          List your band’s sections in the order you want them shown. For each, set how many players need to say
          Yes for an event to have quorum (0 if it isn’t required). You can change this later on the Members tab.
        </p>
        {rows ? <InstrumentsEditor value={rows} onChange={setRows} disabled={busy} /> : <p className="muted">Loading…</p>}
      </div>

      <label className="field">
        <span className="label">Your instrument</span>
        <select value={myInstrument} onChange={(e) => setMyInstrument(e.target.value)}>
          <option value="">Choose…</option>
          {instrumentNames.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>

      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions">
        {onCancel && <button type="button" className="ghost" onClick={onCancel}>Cancel</button>}
        <button type="submit" className="primary" disabled={busy || !rows}>{busy ? 'Creating…' : 'Create band'}</button>
      </div>
    </form>
  );
}
