import { useEffect, useRef, useState } from 'react';
import { formatTime } from '../api';

// "Add to calendar" menu for one event: Google Calendar link, or an .ics download for Apple / Outlook.
// Both are one-time copies; the calendar subscription on the Events page keeps itself up to date.
export default function AddToCalendar({ event }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Close when clicking elsewhere or pressing Escape.
  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const details = [
    event.call_time && `Call time: ${formatTime(event.call_time)}`,
    event.hit_time && `Hit time: ${formatTime(event.hit_time)}`,
    event.description,
    `Details and RSVP: ${window.location.origin}/?event=${event.id}`,
  ].filter(Boolean).join('\n');
  const googleUrl = `https://calendar.google.com/calendar/render?${new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${event.calendar.start}/${event.calendar.end}`,
    details,
    location: event.venue || '',
  })}`;

  return (
    <div className="menu" ref={ref}>
      <button className="ghost" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        Add to calendar ▾
      </button>
      {open && (
        <div className="menu-list" role="menu">
          <a role="menuitem" href={googleUrl} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>
            Google Calendar
          </a>
          <a role="menuitem" href={`/api/events/${event.id}/calendar.ics`} onClick={() => setOpen(false)}>
            Apple Calendar / Outlook (.ics)
          </a>
        </div>
      )}
    </div>
  );
}
