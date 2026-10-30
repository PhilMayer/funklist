import { useEffect, useState } from 'react';
import { api } from '../api';

const STATUS = {
  unconfirmed: { label: 'Pending', className: 'pending' },
  confirmed: { label: 'Confirmed', className: 'confirmed' },
  cancelled: { label: 'Cancelled', className: 'cancelled' },
};

const RSVP_LABELS = { yes: 'Yes', iffy: 'Iffy', no: 'No' };

const monthLabel = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
};
const dayLabel = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
};

// Quick view of gigs and rehearsals, grouped by month. Follows the Upcoming/Past tab: past events only
// appear on the Past tab, newest first. `refreshKey` changes when RSVPs or events change elsewhere on the page.
export default function EventsOverview({ bandId, when, refreshKey, onOpen, onError }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    api.eventsOverview(bandId).then(setData).catch((e) => onError(e.message));
  }, [bandId, refreshKey, onError]);

  if (!data || data.events.length === 0) return null;

  const past = when === 'past';
  const events = data.events.filter((e) => (e.event_date < data.today) === past);
  if (past) events.reverse();
  const months = [];
  for (const e of events) {
    const ym = e.event_date.slice(0, 7);
    if (months.at(-1)?.ym !== ym) months.push({ ym, events: [] });
    months.at(-1).events.push(e);
  }

  return (
    <section className="overview card" aria-label="All events by month">
      <div className="overview-head">
        <h2>At a glance</h2>
      </div>
      {months.length === 0 ? (
        <p className="muted small-text">No {past ? 'past' : 'upcoming'} events.</p>
      ) : (
        <div className="table-wrap">
          <table className="overview-table">
            <thead>
              <tr><th>Date</th><th>Event</th><th>Status</th><th>You</th></tr>
            </thead>
            {months.map((m) => (
              <tbody key={m.ym}>
                <tr className="month-row"><th colSpan={4} scope="colgroup">{monthLabel(m.ym)}</th></tr>
                {m.events.map((e) => (
                  <tr
                    key={e.id}
                    className={e.status}
                    onClick={() => onOpen(e.id)}
                  >
                    <td className="nowrap">{dayLabel(e.event_date)}</td>
                    <td>
                      <button className="link inline title-link" onClick={(ev) => { ev.stopPropagation(); onOpen(e.id); }}>
                        {e.title}
                      </button>
                    </td>
                    <td><span className={`status-pill ${STATUS[e.status].className}`}>{STATUS[e.status].label}</span></td>
                    <td><MyRsvp status={e.my_status} cancelled={e.status === 'cancelled'} /></td>
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

// The signed-in member's own answer. No answer on a cancelled event doesn't need one, so it shows a dash.
function MyRsvp({ status, cancelled }) {
  if (status) return <span className={`my-rsvp ${status}`}>{RSVP_LABELS[status]}</span>;
  return <span className="my-rsvp pending">{cancelled ? '–' : 'No response'}</span>;
}
