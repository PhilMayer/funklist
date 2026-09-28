import { useCallback, useEffect, useState } from 'react';
import { api, formatDate, formatTime } from '../api';

export default function EventList({ bandId, me, onOpen, onNew, onError }) {
  const [when, setWhen] = useState('upcoming');
  const [events, setEvents] = useState(null);
  const [savingId, setSavingId] = useState(null);

  const refresh = useCallback(
    () => api.events(bandId, when).then(setEvents).catch((e) => onError(e.message)),
    [bandId, when, onError]
  );

  useEffect(() => {
    setEvents(null);
    refresh();
  }, [refresh]);

  async function quickRsvp(eventId, status) {
    setSavingId(eventId);
    try {
      // No instrument sent, so any per-event instrument choice made on the Event page is kept.
      await api.rsvp(eventId, status);
      await refresh();
    } catch (e) {
      onError(e.message);
    } finally {
      setSavingId(null);
    }
  }

  return (
    <section>
      <div className="section-head">
        <div className="segmented">
          <button className={when === 'upcoming' ? 'active' : ''} onClick={() => setWhen('upcoming')}>Upcoming</button>
          <button className={when === 'past' ? 'active' : ''} onClick={() => setWhen('past')}>Past</button>
        </div>
        <button className="primary" onClick={onNew}>+ New event</button>
      </div>

      {events?.length > 0 && (
        <div className="legend" aria-hidden="true">
          <span className="yes">Yes</span>
          <span className="iffy">Iffy ?</span>
          <span className="pending">No response</span>
          <span className="no">Not going</span>
        </div>
      )}

      {events === null ? (
        <p className="muted">Loading…</p>
      ) : events.length === 0 ? (
        <div className="empty small">No {when} events.</div>
      ) : (
        <ul className="event-list">
          {events.map((e) => (
            <li key={e.id} className="event-card">
              <button className="event-card-open" onClick={() => onOpen(e.id)}>
                <span className={`badge ${e.type}`}>{e.type}</span>
                <div className="event-card-main">
                  <strong>{e.title}</strong>
                  <span className="muted">
                    {formatDate(e.event_date)}
                    {e.call_time && ` · Call ${formatTime(e.call_time)}`}
                    {e.hit_time && ` · Hit ${formatTime(e.hit_time)}`}
                  </span>
                  {e.venue && <span className="muted">{e.venue}</span>}
                </div>
                <QuorumStatus quorum={e.quorum} />
              </button>
                {e.attendees.length === 0 ? (
                  <div className="attendees muted">No members yet</div>
                ) : (
                  <div className="sections">
                    {groupByInstrument(e.attendees).map((g) => (
                      <div key={g.instrument} className="section-col">
                        <h4>{g.instrument}</h4>
                        <ul>
                          {g.members.map((m) => (
                            <li
                              key={m.id}
                              className={`${m.status || 'pending'} ${me?.id === m.id ? 'me' : ''}`}
                              title={`${m.name}: ${STATUS_LABELS[m.status || 'pending']}`}
                            >
                              {m.name}
                              {m.status === 'iffy' && <span className="iffy-mark" aria-hidden="true"> ?</span>}
                              {m.status !== 'yes' && (
                                <span className="sr-only"> ({STATUS_LABELS[m.status || 'pending']})</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              {me && (
                <div className="quick-rsvp">
                  <span className="muted">
                    {e.my_status ? 'Your RSVP' : 'Can you make it?'}
                  </span>
                  <div className="rsvp-buttons">
                    {RSVP_OPTIONS.map((o) => (
                      <button
                        key={o.value}
                        className={`rsvp small ${o.value} ${e.my_status === o.value ? 'selected' : ''}`}
                        disabled={savingId === e.id}
                        aria-pressed={e.my_status === o.value}
                        onClick={() => quickRsvp(e.id, o.value)}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const STATUS_LABELS = { yes: 'Yes', iffy: 'Iffy', no: 'Not going', pending: 'No response' };

const RSVP_OPTIONS = [
  { value: 'yes', label: 'Yes' },
  { value: 'iffy', label: 'Iffy' },
  { value: 'no', label: 'No' },
];

// Replaces the RSVP counts: either "Quorum" or how many more players (and which) are needed.
function QuorumStatus({ quorum }) {
  if (quorum.met) {
    return (
      <div className="quorum met" title="Quorum reached: every required instrument has enough Yes RSVPs">
        <span className="quorum-badge">✓ Quorum</span>
      </div>
    );
  }
  const detail = quorum.needed.map((n) => `${n.count} ${n.label}`).join(', ');
  return (
    <div className="quorum short" title={`No quorum yet. Still needed: ${detail}`}>
      <span className="quorum-badge">{quorum.total_needed} more needed</span>
      <span className="quorum-detail">
        {quorum.needed.map((n, i) => (
          <span key={n.instrument}>
            {i > 0 && ', '}
            <span className="nowrap">{n.count} {n.label}</span>
          </span>
        ))}
      </span>
    </div>
  );
}

// Attendees arrive sorted by instrument, so consecutive runs form the sections.
function groupByInstrument(attendees) {
  const groups = [];
  for (const m of attendees) {
    const instrument = m.instrument || 'Other';
    const last = groups[groups.length - 1];
    if (last?.instrument === instrument) last.members.push(m);
    else groups.push({ instrument, members: [m] });
  }
  return groups;
}
