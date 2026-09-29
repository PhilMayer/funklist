import { useEffect, useState } from 'react';
import { api } from '../api';

// Personal calendar subscription: every band's events in the user's calendar app, kept up to date.
export default function CalendarSync({ onClose, onError }) {
  const [links, setLinks] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.calendarLinks().then(setLinks).catch((e) => onError(e.message));
  }, [onError]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(links.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      onError('Could not copy. Select the link and copy it manually.');
    }
  }

  async function reset() {
    if (!window.confirm('Create a new calendar link? Calendars subscribed with the current link will stop updating until you subscribe again.')) return;
    try {
      setLinks(await api.resetCalendarLinks());
    } catch (e) {
      onError(e.message);
    }
  }

  return (
    <div className="calendar-sync card">
      <div className="calendar-sync-head">
        <h2>Sync to your calendar</h2>
        <button className="link close" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <p className="muted small-text">
        Subscribe once and your bands’ events show up in your calendar app and stay up to date.
        Unconfirmed events appear as tentative; cancelled events drop off.
      </p>
      {links ? (
        <>
          <div className="calendar-sync-actions">
            <a className="button primary" href={links.webcal_url}>Apple Calendar / Outlook</a>
            <a className="button ghost" href={links.google_url} target="_blank" rel="noreferrer">Google Calendar</a>
          </div>
          <div className="invite-link">
            <input readOnly value={links.url} onFocus={(e) => e.target.select()} aria-label="Calendar subscription link" />
            <button className="ghost" type="button" onClick={copy}>{copied ? 'Copied!' : 'Copy link'}</button>
          </div>
          <p className="muted small-text">
            Other apps: paste the link wherever they offer “subscribe by URL”. Google Calendar can take several
            hours to pick up changes. This link is private to you; anyone who has it can see your bands’ events.{' '}
            <button className="link inline" onClick={reset}>Reset link</button>
          </p>
        </>
      ) : (
        <p className="muted">Loading…</p>
      )}
    </div>
  );
}
