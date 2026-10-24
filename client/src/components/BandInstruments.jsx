import { useState } from 'react';
import { api } from '../api';
import InstrumentsEditor from './InstrumentsEditor';
import { cleanRows, toRows } from './instrumentRows';

// Members tab: the band's instruments and quorum minimums. Admins can edit; others see a summary.
export default function BandInstruments({ bandId, instruments, isAdmin, onSaved, onError }) {
  const [rows, setRows] = useState(null); // non-null while editing
  const [busy, setBusy] = useState(false);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      onSaved(await api.saveBandInstruments(bandId, cleanRows(rows)));
      setRows(null);
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const required = instruments.filter((i) => i.min_count > 0);
  return (
    <div className="band-setting band-instruments">
      <div className="band-instruments-head">
        <strong>Instruments and quorum</strong>
        {isAdmin && !rows && (
          <button type="button" className="ghost small" onClick={() => setRows(toRows(instruments))}>Edit</button>
        )}
      </div>
      {rows ? (
        <form onSubmit={save}>
          <InstrumentsEditor value={rows} onChange={setRows} disabled={busy} />
          <div className="form-actions">
            <button type="button" className="ghost" onClick={() => setRows(null)} disabled={busy}>Cancel</button>
            <button type="submit" className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save instruments'}</button>
          </div>
        </form>
      ) : (
        <p className="muted small-text">
          {instruments.map((i) => i.name).join(', ') || 'No instruments yet.'}
          {' · '}
          {required.length
            ? `Quorum: ${required.map((i) => `${i.min_count} ${i.name}`).join(', ')}.`
            : 'No quorum minimums set.'}
          {!isAdmin && ' Only admins can change these.'}
        </p>
      )}
    </div>
  );
}
