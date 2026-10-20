import { useEffect, useState } from 'react';
import { api } from '../api';

const STATUS = {
  unconfirmed: { label: 'Pending', className: 'pending' },
  confirmed: { label: 'Confirmed', className: 'confirmed' },
  cancelled: { label: 'Cancelled', className: 'cancelled' },
};

const monthLabel = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
};
const dayLabel = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
};

// Quick view of every gig and rehearsal, grouped by month. Past months are hidden until asked for.
// `refreshKey` changes when RSVPs or events change elsewhere on the page.
export default function EventsOverview({ bandId, refreshKey, onOpen, onError }) {
  const [data, setData] = useState(null);
  const [showPast, setShowPast] = useState(false);

  useEffect(() => {
    api.eventsOverview(bandId).then(setData).catch((e) => onError(e.message));
  }, [bandId, refreshKey, onError]);

  if (!data || data.events.length === 0) return null;

  const thisMonth = data.today.slice(0, 7);
  const months = [];
  for (const e of data.events) {
    const ym = e.event_date.slice(0, 7);
    if (months.at(-1)?.ym !== ym) months.push({ ym, events: [] });
    months.at(-1).events.push(e);
  }
  const pastCount = months.filter((m) => m.ym < thisMonth).length;
  const shown = showPast ? months : months.filter((m) => m.ym >= thisMonth);

  return (
    <section className="overview card" aria-label="All events by month">
      <div className="overview-head">
        <h2>At a glance</h2>
        {pastCount > 0 && (
          <button className="link inline" onClick={() => setShowPast((s) => !s)}>
            {showPast ? 'Hide past months' : `Show past months (${pastCount})`}
          </button>
        )}
      </div>
      {shown.length === 0 ? (
        <p className="muted small-text">No upcoming events.</p>
      ) : (
        <div className="table-wrap">
          <table className="overview-table">
            <thead>
              <tr><th>Date</th><th>Event</th><th>Status</th></tr>
            </thead>
            {shown.map((m) => (
              <tbody key={m.ym}>
                <tr className="month-row"><th colSpan={3} scope="colgroup">{monthLabel(m.ym)}</th></tr>
                {m.events.map((e) => (
                  <tr
                    key={e.id}
                    className={`${e.status} ${e.event_date < data.today ? 'past' : ''}`}
                    onClick={() => onOpen(e.id)}
                  >
                    <td className="nowrap">{dayLabel(e.event_date)}</td>
                    <td>
                      <button className="link inline title-link" onClick={(ev) => { ev.stopPropagation(); onOpen(e.id); }}>
                        {e.title}
                      </button>
                    </td>
                                        <td><span className={`status-pill ${STATUS[e.status].className}`}>{STATUS[e.status].label}</span></td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}
    </section>
  );
}
