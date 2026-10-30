import { useState } from 'react';
import { captainLabel } from '../captains';

const OPTIONS = [
  { value: 'yes', label: 'Yes' },
  { value: 'iffy', label: 'Iffy' },
  { value: 'no', label: 'No' },
];
const LABELS = { yes: 'Yes', iffy: 'Iffy', no: 'No' };

// Admin-only: answer for a bandmate (e.g. someone who texted instead, or a sub without an account).
// onRsvp(memberId, status, iffyReason, instrumentId) saves; responses come from the event's attendance.
// For bandmates who also play other instruments, a Playing menu picks which one they play at this event
// ('' = their usual instrument; undefined keeps the saved choice).
export default function AdminRsvp({ members, me, instruments = [], responses, captainIds, saving, onRsvp }) {
  const others = members.filter((m) => m.id !== me.id);
  const [memberId, setMemberId] = useState('');
  const [reason, setReason] = useState('');
  const [pendingInstrument, setPendingInstrument] = useState(''); // held until the first RSVP click
  if (others.length === 0) return null;

  const member = others.find((m) => String(m.id) === memberId);
  const current = memberId ? responses[memberId] : null;
  // Their also-plays instruments in band order, plus any other instrument already chosen for this event.
  const alsoPlay = new Set(member?.secondary_instrument_ids || []);
  const playable = instruments.filter((i) => i.id !== member?.instrument_id
    && (alsoPlay.has(i.id) || i.id === current?.instrument_id));
  const playing = current ? String(current.instrument_id ?? '') : pendingInstrument;
  const choose = (id) => {
    setMemberId(id);
    setReason(responses[id]?.iffy_reason ?? '');
    setPendingInstrument('');
  };
  const changeInstrument = (value) => {
    if (current) onRsvp(Number(memberId), current.status, undefined, value);
    else setPendingInstrument(value);
  };

  return (
    <div className="admin-rsvp">
      <div className="admin-rsvp-row">
        <label>
          <span className="admin-tag">Admin</span> RSVP for
          <select value={memberId} onChange={(e) => choose(e.target.value)}>
            <option value="">Choose a bandmate…</option>
            {others.map((m) => (
              <option key={m.id} value={m.id}>
                {captainLabel(m.name, captainIds.has(m.id))}{m.instrument ? ` (${m.instrument})` : ''}
                {responses[m.id] ? ` · ${LABELS[responses[m.id].status]}` : ' · no response'}
              </option>
            ))}
          </select>
        </label>
        {member && playable.length > 0 && (
          <label className="playing">
            <span className="muted">Playing</span>
            <select value={playing} disabled={saving} onChange={(e) => changeInstrument(e.target.value)}>
              <option value="">{member.instrument ? `${member.instrument} (usual)` : 'No instrument'}</option>
              {playable.map((i) => (
                <option key={i.id} value={i.id}>{i.name}{alsoPlay.has(i.id) ? ' (also plays)' : ''}</option>
              ))}
            </select>
          </label>
        )}
        {memberId && (
          <div className="rsvp-buttons">
            {OPTIONS.map((o) => (
              <button
                key={o.value}
                className={`rsvp small ${o.value} ${current?.status === o.value ? 'selected' : ''}`}
                disabled={saving}
                onClick={() => onRsvp(Number(memberId), o.value, o.value === 'iffy' ? reason.trim() : undefined,
                  playable.length > 0 ? playing : undefined)}
              >
                {o.label}
              </button>
            ))}
          </div>
        )}
      </div>
      {memberId && (
        <input
          className="admin-rsvp-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={200}
          placeholder="Reason if Iffy (optional), then click Iffy"
          aria-label="Reason if Iffy"
        />
      )}
    </div>
  );
}
