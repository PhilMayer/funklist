import { useState } from 'react';
import { api } from '../api';

export default function CreateBand({ instruments, onCreated, onCancel }) {
  const [name, setName] = useState('');
  const [instrumentId, setInstrumentId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      onCreated(await api.createBand(name, instrumentId));
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form className="card form" onSubmit={handleSubmit}>
      <h1>Create a band</h1>
      <p className="muted">You’ll be its first member. Invite bandmates from the Members tab afterwards.</p>
      <div className="row">
        <label className="field">
          <span className="label">Band name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </label>
        <label className="field">
          <span className="label">Your instrument</span>
          <select value={instrumentId} onChange={(e) => setInstrumentId(e.target.value)}>
            <option value="">Choose…</option>
            {instruments.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </label>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions">
        {onCancel && <button type="button" className="ghost" onClick={onCancel}>Cancel</button>}
        <button type="submit" className="primary" disabled={busy}>{busy ? 'Creating…' : 'Create band'}</button>
      </div>
    </form>
  );
}
