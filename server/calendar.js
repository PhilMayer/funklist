// iCalendar (.ics, RFC 5545) output for calendar subscriptions and "Add to calendar".
const { zonedTimeToUtc, formatTime12, DEFAULT_TIMEZONE } = require('./time');

// Events have no end time yet, so calendar entries start at call time (when players need to be
// there, else hit time) and end this long after hit time (or after call time if there's no hit time).
const HOURS_AFTER_HIT = 2;
const HOURS_AFTER_CALL = 3;

const pad = (n) => String(n).padStart(2, '0');
const icsUtc = (d) =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
const icsDate = (iso) => iso.replaceAll('-', '');
const addHours = (d, h) => new Date(d.getTime() + h * 3600 * 1000);

function nextDay(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// Start and end in iCal format: UTC date-times ("20261008T230000Z"), or dates ("20261008")
// for events without times, which become all-day entries.
function eventTimes(event, tz = DEFAULT_TIMEZONE) {
  const startTime = event.call_time || event.hit_time;
  if (!startTime) {
    return { all_day: true, start: icsDate(event.event_date), end: icsDate(nextDay(event.event_date)) };
  }
  const start = zonedTimeToUtc(event.event_date, startTime, tz);
  let end = event.hit_time
    ? addHours(zonedTimeToUtc(event.event_date, event.hit_time, tz), HOURS_AFTER_HIT)
    : addHours(start, HOURS_AFTER_CALL);
  if (end <= start) end = addHours(end, 24); // e.g. call 11 PM, hit 12:30 AM (after midnight)
  return { all_day: false, start: icsUtc(start), end: icsUtc(end) };
}

// Text values escape backslash, semicolon, comma, and newlines.
const escapeText = (s) =>
  String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

// Lines may be at most 75 bytes; longer ones continue on lines starting with a space.
// Split on character boundaries so multi-byte characters stay intact.
function fold(line) {
  if (Buffer.byteLength(line) <= 75) return line;
  const parts = [];
  let current = '';
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const size = Buffer.byteLength(ch);
    if (bytes + size > limit) {
      parts.push(current);
      current = '';
      bytes = 0;
      limit = 74; // continuation lines start with a space
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

const RSVP_TEXT = { yes: 'Yes', iffy: 'Iffy', no: 'No' };

// Plain-text summary used in the calendar entry's notes (and Google Calendar's details).
function eventDescription(event, { link, rsvp, iffyReason } = {}) {
  const type = event.type === 'gig' ? 'Gig' : 'Rehearsal';
  const status = event.status === 'confirmed' ? 'Confirmed' : 'Not confirmed yet';
  const songs = (event.set_list || '').split('\n').map((s) => s.trim()).filter(Boolean);
  const lines = [
    [event.band_name, type, status].filter(Boolean).join(' · '),
    event.call_time && `Call time: ${formatTime12(event.call_time)}`,
    event.hit_time && `Hit time: ${formatTime12(event.hit_time)}`,
    rsvp !== undefined &&
      `Your RSVP: ${rsvp ? RSVP_TEXT[rsvp] : 'not answered yet'}${rsvp === 'iffy' && iffyReason ? ` (${iffyReason})` : ''}`,
  ].filter(Boolean);
  if (event.description) lines.push('', event.description);
  if (songs.length) lines.push('', 'Set list:', ...songs.map((s, i) => `${i + 1}. ${s}`));
  if (link) lines.push('', `Details and RSVP: ${link}`);
  return lines.join('\n');
}

// events: rows with id, type, title, event_date, call_time, hit_time, venue, description,
// set_list, status, band_name, timezone, and optionally rsvp / iffy_reason (for "Your RSVP").
function buildCalendar({ name, events, appUrl, includeRsvp = false }) {
  const host = new URL(appUrl).host;
  const stamp = icsUtc(new Date());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Funklist//Band Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(name)}`,
    // Ask subscribed calendars to check for changes hourly (Google Calendar sets its own pace).
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ];
  for (const event of events) {
    const link = `${appUrl}/?event=${event.id}`;
    const times = eventTimes(event, event.timezone);
    const description = eventDescription(event, {
      link,
      ...(includeRsvp ? { rsvp: event.rsvp || null, iffyReason: event.iffy_reason } : {}),
    });
    lines.push(
      'BEGIN:VEVENT',
      `UID:event-${event.id}@${host}`,
      `DTSTAMP:${stamp}`,
      times.all_day ? `DTSTART;VALUE=DATE:${times.start}` : `DTSTART:${times.start}`,
      times.all_day ? `DTEND;VALUE=DATE:${times.end}` : `DTEND:${times.end}`,
      `SUMMARY:${escapeText(event.title)}`,
      ...(event.venue ? [`LOCATION:${escapeText(event.venue)}`] : []),
      `DESCRIPTION:${escapeText(description)}`,
      `STATUS:${event.status === 'confirmed' ? 'CONFIRMED' : 'TENTATIVE'}`,
      `CATEGORIES:${event.type === 'gig' ? 'Gig' : 'Rehearsal'}`,
      `URL:${link}`,
      'END:VEVENT'
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

module.exports = { buildCalendar, eventTimes, eventDescription };
