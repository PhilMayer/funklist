import { useEffect, useRef, useState } from 'react';
import { api } from '../api';

// Google Calendar's "Add calendar → From URL" page. Google has no working one-click subscribe link
// for this feed (see calendarLinks in server/index.js), so the member pastes the https:// link here.
const GOOGLE_ADD_BY_URL = 'https://calendar.google.com/calendar/u/0/r/settings/addbyurl';

// Personal calendar subscription: every band's events in the user's calendar app, kept up to date.
export default function CalendarSync({ onClose, onError }) {
  const [links, setLinks] = useState(null);
  const [copied, setCopied] = useState(false);
  const [googleStep, setGoogleStep] = useState(null); // null | 'copied' | 'copy-failed'
  const linkInput = useRef(null);

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

  // Runs when the Google Calendar link is clicked, just before its new tab opens: copy the link so
  // the member only has to paste it on Google's page.
  function startGoogle() {
    const copyFailed = () => {
      setGoogleStep('copy-failed');
      linkInput.current?.select();
    };
    try {
      navigator.clipboard.writeText(links.url).then(() => setGoogleStep('copied'), copyFailed);
    } catch {
      copyFailed(); // no clipboard access at all (e.g. an insecure page)
    }
  }

  async function reset() {
    if (!window.confirm('Create a new calendar link? Calendars subscribed with the current link will stop updating until you subscribe again.')) return;
    try {
      setLinks(await api.resetCalendarLinks());
      setGoogleStep(null);
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
            <a className="button ghost" href={GOOGLE_ADD_BY_URL} target="_blank" rel="noreferrer" onClick={startGoogle}>
              Google Calendar
            </a>
          </div>

          {googleStep && (
            <div className="google-steps" role="status">
              <strong>Finish in Google Calendar</strong>
              <ol>
                <li>
                  {googleStep === 'copied'
                    ? 'Your calendar link is copied.'
                    : 'Copy your calendar link below (it’s selected for you).'}
                </li>
                <li>In the Google Calendar tab, paste it into <em>URL of calendar</em> and click <em>Add calendar</em>.</li>
              </ol>
              <p className="muted small-text">
                No new tab? <a href={GOOGLE_ADD_BY_URL} target="_blank" rel="noreferrer">Open Google Calendar</a>.
                This works in a web browser, not Google’s phone app. If you added Funklist to Google before and
                it’s empty, remove that calendar in Google Calendar first.
              </p>
            </div>
          )}

          <div className="invite-link">
            <input
              ref={linkInput}
              readOnly
              value={links.url}
              onFocus={(e) => e.target.select()}
              aria-label="Calendar subscription link"
            />
            <button className="ghost" type="button" onClick={copy}>{copied ? 'Copied!' : 'Copy link'}</button>
          </div>
          <p className="muted small-text">
            Other apps: paste the link wherever they offer “subscribe by URL”. Google Calendar checks for changes
            about once a day; Apple Calendar and Outlook check more often. This link is private to you; anyone who
            has it can see your bands’ events.{' '}
            <button className="link inline" onClick={reset}>Reset link</button>
          </p>
        </>
      ) : (
        <p className="muted">Loading…</p>
      )}
    </div>
  );
}
