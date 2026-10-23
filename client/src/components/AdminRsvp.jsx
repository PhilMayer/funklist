import { useState } from 'react';

const OPTIONS = [
  { value: 'yes', label: 'Yes' },
  { value: 'iffy', label: 'Iffy' },
  { value: 'no', label: 'No' },
];
const LABELS = { yes: 'Yes', iffy: 'Iffy', no: 'No' };

// Admin-only: answer for a bandmate (e.g. someone who texted instead, or a sub without an account).
// onRsvp(memberId, status, iffyReason) saves; responses come from the event's attendance.
export default function AdminRsvp({ members, me, responses, saving, onRsvp }) {
  const others = members.filter((m) => m.id !== me.id);
  const [memberId, setMemberId] = useState('');
  const [reason, setReason] = useState('');
  if (others.length === 0) return null;

  const current = memberId ? responses[memberId] : null;
  const choose = (id) => {
    setMemberId(id);
    setReason(responses[id]?.iffy_reason ?? '');
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
                {m.name}{m.instrument ? ` (${m.instrument})` : ''}
                {responses[m.id] ? ` · ${LABELS[responses[m.id].status]}` : ' · no response'}
              </option>
            ))}
          </select>
        </label>
        {memberId && (
          <div className="rsvp-buttons">
            {OPTIONS.map((o) => (
              <button
                key={o.value}
                className={`rsvp small ${o.value} ${current?.status === o.value ? 'selected' : ''}`}
                disabled={saving}
                onClick={() => onRsvp(Number(memberId), o.value, o.value === 'iffy' ? reason.trim() : undefined)}
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
