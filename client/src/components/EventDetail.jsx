import { useEffect, useState } from 'react';
import { api, formatDate, formatTime } from '../api';
import { notifiedMessage } from '../messages';

const RSVP_OPTIONS = [
  { value: 'yes', label: 'Yes' },
  { value: 'iffy', label: 'Iffy' },
  { value: 'no', label: 'No' },
];

export default function EventDetail({ eventId, me, instruments, onBack, onEdit, onNotice, onError }) {
  const [event, setEvent] = useState(null);
  const [saving, setSaving] = useState(false);
  // Instrument picked before RSVPing, held until the first RSVP click. Keyed by member so
  // switching "I am" doesn't carry one person's choice over to another.
  const [pendingInstrument, setPendingInstrument] = useState({ memberId: null, value: '' });

  useEffect(() => {
    api.event(eventId).then(setEvent).catch((e) => onError(e.message));
  }, [eventId, onError]);

  if (!event) return <p className="muted">Loading…</p>;

  const { attendance } = event;
  const myResponse = me ? attendance.responses[me.id] : null;
  const myStatus = myResponse?.status;
  // '' means "my usual instrument".
  const playing = myResponse
    ? String(myResponse.instrument_id ?? '')
    : pendingInstrument.memberId === me?.id ? pendingInstrument.value : '';
  const goingCount = attendance.going_by_instrument.reduce((n, g) => n + g.members.length, 0);
  const songs = (event.set_list || '').split('\n').map((s) => s.trim()).filter(Boolean);

  async function rsvp(status, instrument = playing) {
    setSaving(true);
    try {
      setEvent(await api.rsvp(event.id, status, instrument ? Number(instrument) : null));
    } catch (e) {
      onError(e.message);
    } finally {
      setSaving(false);
    }
  }

  function changeInstrument(value) {
    if (myStatus) rsvp(myStatus, value);
    else setPendingInstrument({ memberId: me.id, value });
  }

  async function changeStatus(status) {
    const quorumNote = event.quorum.met
      ? ''
      : `It doesn’t have quorum yet (still needed: ${event.quorum.needed.map((n) => `${n.count} ${n.label}`).join(', ')}).\n\n`;
    const question = {
      confirmed: event.status === 'cancelled'
        ? `Reinstate "${event.title}" as confirmed?\n\n${quorumNote}The band will be emailed that it’s back on.`
        : `Confirm "${event.title}"?\n\n${quorumNote}The band will be emailed that it’s confirmed.`,
      cancelled: `Cancel "${event.title}"?\n\nIt will be hidden from the events list and the band will be emailed that it’s cancelled.`,
    }[status];
    if (!window.confirm(question)) return;
    setSaving(true);
    try {
      const updated = await api.setEventStatus(event.id, status);
      setEvent(updated);
      if (!updated.unchanged) onNotice(notifiedMessage(updated));
    } catch (e) {
      onError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Delete "${event.title}"? This cannot be undone.`)) return;
    try {
      await api.deleteEvent(event.id);
      onBack();
    } catch (e) {
      onError(e.message);
    }
  }

  return (
    <section className="detail">
      <button className="link" onClick={onBack}>← All events</button>

      <div className="detail-head">
        <div>
          <span className={`badge ${event.type}`}>{event.type}</span>
          <h1>{event.title}</h1>
          <p className="muted">
            {formatDate(event.event_date)}
            {event.created_by_name && ` · created by ${event.created_by_name}`}
          </p>
        </div>
        {me && (
          <div className="detail-actions">
            <button className="ghost" onClick={() => onEdit(event)}>Edit</button>
            <button className="ghost danger" onClick={handleDelete}>Delete</button>
          </div>
        )}
      </div>

      <StatusBar event={event} canChange={Boolean(me)} saving={saving} onChange={changeStatus} />

      <dl className="facts">
        <div><dt>Venue</dt><dd>{event.venue || '—'}</dd></div>
        <div><dt>Call time</dt><dd>{formatTime(event.call_time) || '—'}</dd></div>
        <div><dt>Hit time</dt><dd>{formatTime(event.hit_time) || '—'}</dd></div>
      </dl>

      {event.status !== 'cancelled' && (
      <div className="rsvp-box">
        {me ? (
          <>
            <div className="rsvp-prompt">
              <span>
                <strong>{me.name}</strong>, can you make it?
              </span>
              <label className="playing">
                <span className="muted">Playing</span>
                <select value={playing} disabled={saving} onChange={(e) => changeInstrument(e.target.value)}>
                  <option value="">{me.instrument ? `${me.instrument} (usual)` : 'No instrument'}</option>
                  {instruments
                    .filter((i) => i.id !== me.instrument_id)
                    .map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
              </label>
            </div>
            <div className="rsvp-buttons">
              {RSVP_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  className={`rsvp ${o.value} ${myStatus === o.value ? 'selected' : ''}`}
                  disabled={saving}
                  onClick={() => rsvp(o.value)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </>
        ) : (
          <span className="muted">Loading…</span>
        )}
      </div>
      )}

      <div className="grid">
        <div className="card">
          <h2>Going <span className="pill yes">{goingCount}</span></h2>
          {attendance.going_by_instrument.length === 0 ? (
            <p className="muted">Nobody has said yes yet.</p>
          ) : (
            <div className="instrument-groups">
              {attendance.going_by_instrument.map((g) => (
                <div key={g.instrument} className="instrument-group">
                  <h3>{g.instrument}</h3>
                  <ul>
                    {g.members.map((m) => (
                      <li key={m.id} className={me?.id === m.id ? 'me' : ''}>
                        {m.name}
                        {me?.id === m.id && <span className="you"> (you)</span>}
                        {m.primary_instrument && (
                          <span className="covering" title={`Usually plays ${m.primary_instrument}`}>
                            usually {m.primary_instrument}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          <ResponseList title="Iffy" tone="iffy" people={attendance.iffy} />
          <ResponseList title="Can't make it" tone="no" people={attendance.no} />
          <ResponseList title="No response" tone="none" people={attendance.no_response} />
        </div>

        <div className="card">
          <h2>Set list {songs.length > 0 && <span className="pill">{songs.length}</span>}</h2>
          {songs.length ? (
            <ol className="setlist">{songs.map((s, i) => <li key={i}>{s}</li>)}</ol>
          ) : (
            <p className="muted">No set list yet.</p>
          )}
          {event.description && (
            <>
              <h2>Notes</h2>
              <p className="description">{event.description}</p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

// "When" for status changes; stored as UTC 'YYYY-MM-DD HH:MM:SS'.
const changedOn = (utc) =>
  utc ? new Date(`${utc.replace(' ', 'T')}Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';

function StatusBar({ event, canChange, saving, onChange }) {
  const by = [event.status_updated_by_name && `by ${event.status_updated_by_name}`, changedOn(event.status_updated_at)]
    .filter(Boolean).join(' on ');
  const status = {
    unconfirmed: { label: 'Not confirmed yet', note: event.quorum.met ? 'Quorum reached' : null },
    confirmed: { label: '✓ Confirmed', note: by },
    cancelled: { label: 'Cancelled', note: `${by ? `${by}. ` : ''}It’s hidden from the events list.` },
  }[event.status];

  return (
    <div className={`status-bar ${event.status}`} role="status">
      <div>
        <strong>{status.label}</strong>
        {status.note && <span className="status-note"> · {status.note}</span>}
      </div>
      {canChange && (
        <div className="status-actions">
          {event.status !== 'confirmed' && (
            <button className="confirm-btn" disabled={saving} onClick={() => onChange('confirmed')}>
              {event.status === 'cancelled' ? 'Reinstate as confirmed' : '✓ Confirm event'}
            </button>
          )}
          {event.status !== 'cancelled' && (
            <button className="ghost danger" disabled={saving} onClick={() => onChange('cancelled')}>
              Cancel event
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ResponseList({ title, tone, people }) {
  if (people.length === 0) return null;
  return (
    <div className="response-list">
      <h3>{title} <span className={`pill ${tone}`}>{people.length}</span></h3>
      <p>
        {people.map((p, i) => (
          <span key={p.id}>
            {p.name}{p.instrument && <span className="muted"> ({p.instrument})</span>}
            {i < people.length - 1 && ', '}
          </span>
        ))}
      </p>
    </div>
  );
}
