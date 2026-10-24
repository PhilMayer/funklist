const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Load server/.env (GOOGLE_CLIENT_ID etc.) before anything reads process.env.
// (Skipped under tests so they never pick up real SMTP or Google settings.)
if (process.env.NODE_ENV !== 'test') {
  try { process.loadEnvFile(path.join(__dirname, '.env')); } catch { /* no .env file */ }
}

const express = require('express');
const db = require('./db');
const { newInviteCode, DEFAULT_INSTRUMENTS, addDefaultInstruments } = require('./db');
const { HttpError, clean } = require('./errors');
const auth = require('./auth');
const { quorumFor } = require('./quorum');
const { notifyBand } = require('./notify');
const { emailEnabled } = require('./mailer');
const { isValidTimeZone, DEFAULT_TIMEZONE, todayIn } = require('./time');
const { buildCalendar, eventTimes } = require('./calendar');

const app = express();
// Behind a hosting proxy (e.g. Fly.io), trust its X-Forwarded-For so req.ip is the real client
// (used by the login rate limit).
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
app.use(express.json());
app.use(auth.loadUser);
app.use('/api/auth', auth.router);

// ---------- Calendar feed (public; the URL's secret token identifies the user) ----------

// Columns buildCalendar needs, for events joined with their band, details, and one member's RSVP.
const CALENDAR_EVENT_COLUMNS = `
  e.id, e.type, e.title, e.event_date, e.status, d.call_time, d.hit_time, d.venue, d.description, d.set_list,
  b.name AS band_name, b.timezone, a.status AS rsvp, a.iffy_reason`;

// Subscribed by Google/Apple/Outlook Calendar, which can't sign in. Covers every band the user is
// in, from a year ago on; cancelled events are left out so they drop off calendars.
app.get('/calendar/:file', (req, res) => {
  const match = /^([A-Za-z0-9_-]{20,})\.ics$/.exec(req.params.file);
  const user = match && db.prepare('SELECT id FROM users WHERE calendar_token = ?').get(match[1]);
  // One log line per fetch, so we can tell whether calendar apps are reaching the feed. Never log
  // the URL: its token is the secret that grants access.
  let eventCount = 0;
  res.on('finish', () => {
    const who = user ? `user ${user.id}, ${eventCount} events` : 'unknown or reset link';
    console.log(`Calendar feed: ${res.statusCode} (${who}) via ${req.protocol}, agent "${req.get('user-agent') || '-'}"`);
  });
  if (!user) return res.status(404).type('text/plain').send('Calendar not found. The link may have been reset.');
  const events = db.prepare(`
    SELECT ${CALENDAR_EVENT_COLUMNS}
    FROM events e
    JOIN bands b ON b.id = e.band_id
    JOIN band_members m ON m.band_id = e.band_id AND m.user_id = ?
    LEFT JOIN event_details d ON d.event_id = e.id
    LEFT JOIN event_attendance a ON a.event_id = e.id AND a.member_id = m.id
    WHERE e.status != 'cancelled' AND e.event_date >= date('now', '-1 year')
    ORDER BY e.event_date, d.call_time
  `).all(user.id);
  eventCount = events.length;
  res.type('text/calendar; charset=utf-8')
    .set('Cache-Control', 'private, max-age=300')
    .send(buildCalendar({ name: 'Funklist', events, appUrl: appUrl(req), includeRsvp: true }));
});

// Everything else under /api requires a signed-in user.
app.use('/api', auth.requireUser);

// ---------- Your calendar subscription link ----------

const newCalendarToken = () => crypto.randomBytes(24).toString('base64url');

// There's deliberately no Google Calendar subscribe link: Google only accepts webcal:// in its
// ?cid= links, then fetches webcal:// over plain http://, which this HTTPS-only site redirects,
// leaving an empty calendar. Google users paste `url` into Google's "From URL" page instead.
function calendarLinks(req, token) {
  const url = `${appUrl(req)}/calendar/${token}.ics`;
  return {
    url, // paste into any calendar app's "subscribe by URL" (incl. Google Calendar's "From URL")
    webcal_url: url.replace(/^https?:/, 'webcal:'), // opens Apple Calendar / Outlook directly
  };
}

app.get('/api/me/calendar', (req, res) => {
  let { calendar_token: token } = db.prepare('SELECT calendar_token FROM users WHERE id = ?').get(req.user.id);
  if (!token) {
    token = newCalendarToken();
    db.prepare('UPDATE users SET calendar_token = ? WHERE id = ?').run(token, req.user.id);
  }
  res.json(calendarLinks(req, token));
});

// New secret, so previously shared or leaked links stop working.
app.post('/api/me/calendar/reset', (req, res) => {
  const token = newCalendarToken();
  db.prepare('UPDATE users SET calendar_token = ? WHERE id = ?').run(token, req.user.id);
  res.json(calendarLinks(req, token));
});

const EVENT_TYPES = ['rehearsal', 'gig'];
const RSVP_STATUSES = ['yes', 'no', 'iffy'];
const MAX_IFFY_REASON = 200;
// Statuses a member can set from the Event page (new events start 'unconfirmed').
const SETTABLE_EVENT_STATUSES = ['confirmed', 'cancelled'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Public base URL for links in emails. Set APP_URL in production; otherwise use the request's host.
const appUrl = (req) => (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');

function findOr404(sql, id, what) {
  const row = db.prepare(sql).get(id);
  if (!row) throw new HttpError(404, `${what} not found`);
  return row;
}

// The signed-in user's member profile in a band. Non-members get 404 so band ids don't leak.
function requireMember(req, bandId) {
  const member = db.prepare('SELECT * FROM band_members WHERE band_id = ? AND user_id = ?')
    .get(Number(bandId), req.user.id);
  if (!member) throw new HttpError(404, 'Band not found');
  return member;
}

function requireEventMember(req, eventId) {
  const event = findOr404('SELECT id, band_id, status FROM events WHERE id = ?', eventId, 'Event');
  try {
    return { event, member: requireMember(req, event.band_id) };
  } catch {
    throw new HttpError(404, 'Event not found');
  }
}

// ---------- Instruments ----------

// The lineup a new band starts with (the create-band form pre-fills it; everything is editable).
app.get('/api/instruments/defaults', (req, res) => {
  res.json(DEFAULT_INSTRUMENTS);
});

// A band's instruments in display order, with quorum minimums: [{ id, name, min_count }].
const bandInstruments = (bandId) => db.prepare(`
  SELECT i.id, i.name, bi.min_count FROM band_instruments bi JOIN instruments i ON i.id = bi.instrument_id
  WHERE bi.band_id = ? ORDER BY bi.sort_order, i.name
`).all(bandId);
// The same, shaped for quorumFor().
const quorumRequirements = (bandId) =>
  bandInstruments(bandId).map(({ id, name, min_count: min }) => ({ instrument_id: id, name, min_count: min }));

// Validates an instrument list from the app: [{ name, min_count }], in order. Returns it cleaned up.
function validInstrumentList(list) {
  if (!Array.isArray(list) || list.length === 0) throw new HttpError(400, 'Add at least one instrument');
  if (list.length > 40) throw new HttpError(400, 'That’s too many instruments (40 at most)');
  const seen = new Set();
  return list.map((item) => {
    const name = clean(item?.name);
    if (!name || name.length > 40) throw new HttpError(400, 'Instrument names must be 1–40 characters');
    if (seen.has(name.toLowerCase())) throw new HttpError(400, `"${name}" is listed twice`);
    seen.add(name.toLowerCase());
    const min = Number(item.min_count ?? 0);
    if (!Number.isInteger(min) || min < 0 || min > 50) throw new HttpError(400, `The minimum for ${name} must be a whole number from 0 to 50`);
    return { name, min_count: min };
  });
}

// Saves a band's instrument list (validated). Instruments are shared by name across bands.
// Refuses to drop an instrument that's still someone's main instrument; drops it from "also plays".
function saveBandInstruments(bandId, list) {
  db.transaction(() => {
    const getId = db.prepare('SELECT id FROM instruments WHERE name = ?');
    const ids = list.map(({ name }) => {
      db.prepare('INSERT OR IGNORE INTO instruments (name, sort_order) VALUES (?, 100)').run(name);
      return getId.get(name).id;
    });
    const placeholders = ids.map(() => '?').join(',');
    const stillPlayed = db.prepare(`
      SELECT i.name, GROUP_CONCAT(m.name, ', ') AS players FROM band_members m JOIN instruments i ON i.id = m.instrument_id
      WHERE m.band_id = ? AND m.instrument_id NOT IN (${placeholders}) GROUP BY i.id
    `).all(bandId, ...ids);
    if (stillPlayed.length) {
      const { name, players } = stillPlayed[0];
      throw new HttpError(409, `${players} ${players.includes(',') ? 'play' : 'plays'} ${name}. Give them another instrument before removing ${name}.`);
    }
    db.prepare(`
      DELETE FROM member_instruments WHERE instrument_id NOT IN (${placeholders})
        AND member_id IN (SELECT id FROM band_members WHERE band_id = ?)
    `).run(...ids, bandId);
    db.prepare('DELETE FROM band_instruments WHERE band_id = ?').run(bandId);
    const insert = db.prepare('INSERT INTO band_instruments (band_id, instrument_id, sort_order, min_count) VALUES (?, ?, ?, ?)');
    ids.forEach((id, i) => insert.run(bandId, id, i, list[i].min_count));
  })();
}

// ---------- Bands ----------

// Only the bands the signed-in user belongs to.
app.get('/api/bands', (req, res) => {
  res.json(db.prepare(`
    SELECT b.id, b.name, m.id AS member_id
    FROM bands b JOIN band_members m ON m.band_id = b.id AND m.user_id = ?
    ORDER BY b.name
  `).all(req.user.id));
});

// An instrument id from the request, which must be on the band's instrument list (or empty).
function validInstrumentId(value, bandId) {
  const id = value ? Number(value) : null;
  if (id && !db.prepare('SELECT 1 FROM band_instruments WHERE band_id = ? AND instrument_id = ?').get(bandId, id)) {
    throw new HttpError(400, 'That instrument isn’t on this band’s instrument list');
  }
  return id;
}

// Creating a band makes you its first member.
app.post('/api/bands', (req, res) => {
  const name = clean(req.body.name);
  if (!name) throw new HttpError(400, 'Band name is required');
  // The creator's instruments and quorum minimums; without a list, the default lineup.
  const instruments = req.body.instruments === undefined ? null : validInstrumentList(req.body.instruments);
  const myInstrument = clean(req.body.instrument_name);
  if (myInstrument && instruments && !instruments.some((i) => i.name.toLowerCase() === myInstrument.toLowerCase())) {
    throw new HttpError(400, 'Your instrument has to be one of the band’s instruments');
  }
  // The app sends the creator's browser time zone.
  const timezone = isValidTimeZone(req.body.timezone) ? req.body.timezone : DEFAULT_TIMEZONE;
  const bandId = db.transaction(() => {
    const id = db.prepare('INSERT INTO bands (name, invite_code, timezone) VALUES (?, ?, ?)')
      .run(name, newInviteCode(), timezone).lastInsertRowid;
    if (instruments) saveBandInstruments(id, instruments);
    else addDefaultInstruments(id);
    const instrumentId = myInstrument
      ? db.prepare('SELECT id FROM instruments WHERE name = ?').get(myInstrument)?.id ?? null
      : validInstrumentId(req.body.instrument_id, id);
    db.prepare('INSERT INTO band_members (band_id, name, email, instrument_id, user_id, is_admin) VALUES (?, ?, ?, ?, ?, 1)')
      .run(id, req.user.display_name, req.user.email, instrumentId, req.user.id);
    return id;
  })();
  res.status(201).json(db.prepare(`
    SELECT b.id, b.name, m.id AS member_id FROM bands b JOIN band_members m ON m.band_id = b.id AND m.user_id = ?
    WHERE b.id = ?
  `).get(req.user.id, bandId));
});

app.get('/api/bands/:bandId', (req, res) => {
  const member = requireMember(req, req.params.bandId);
  const band = db.prepare('SELECT id, name, invite_code, timezone FROM bands WHERE id = ?').get(member.band_id);
  res.json({ ...band, member_id: member.id });
});

// The band's instruments and quorum minimums. Any member can see them; admins can change them.
app.get('/api/bands/:bandId/instruments', (req, res) => {
  const me = requireMember(req, req.params.bandId);
  res.json(bandInstruments(me.band_id));
});

app.put('/api/bands/:bandId/instruments', (req, res) => {
  const me = requireMember(req, req.params.bandId);
  if (!me.is_admin) throw new HttpError(403, 'Only band admins can change the band’s instruments');
  saveBandInstruments(me.band_id, validInstrumentList(req.body.instruments));
  res.json(bandInstruments(me.band_id));
});

// Band settings. Currently just the time zone, which decides when events move from Upcoming to Past.
app.put('/api/bands/:bandId', (req, res) => {
  const member = requireMember(req, req.params.bandId);
  if (!isValidTimeZone(req.body.timezone)) throw new HttpError(400, 'Choose a valid time zone');
  db.prepare('UPDATE bands SET timezone = ? WHERE id = ?').run(req.body.timezone, member.band_id);
  const band = db.prepare('SELECT id, name, invite_code, timezone FROM bands WHERE id = ?').get(member.band_id);
  res.json({ ...band, member_id: member.id });
});

// Replaces the invite code, so old links stop working.
app.post('/api/bands/:bandId/invite', (req, res) => {
  const member = requireMember(req, req.params.bandId);
  const code = newInviteCode();
  db.prepare('UPDATE bands SET invite_code = ? WHERE id = ?').run(code, member.band_id);
  res.json({ invite_code: code });
});

// ---------- Joining via invite link ----------

function bandForInvite(code) {
  const band = typeof code === 'string' && db.prepare('SELECT id, name FROM bands WHERE invite_code = ?').get(code);
  if (!band) throw new HttpError(404, 'This invite link is invalid or has been replaced');
  return band;
}

app.get('/api/invites/:code', (req, res) => {
  const band = bandForInvite(req.params.code);
  const already = db.prepare('SELECT id FROM band_members WHERE band_id = ? AND user_id = ?').get(band.id, req.user.id);
  const unclaimed = db.prepare(`
    SELECT m.id, m.name, i.name AS instrument
    FROM band_members m LEFT JOIN instruments i ON i.id = m.instrument_id
    LEFT JOIN band_instruments bi ON bi.band_id = m.band_id AND bi.instrument_id = m.instrument_id
    WHERE m.band_id = ? AND m.user_id IS NULL
    ORDER BY COALESCE(bi.sort_order, 9999), m.name
  `).all(band.id);
  res.json({ band, already_member: Boolean(already), unclaimed_members: unclaimed, instruments: bandInstruments(band.id) });
});

// Join either by claiming an existing (account-less) member profile, or as a new member.
app.post('/api/invites/:code/join', (req, res) => {
  const band = bandForInvite(req.params.code);
  if (db.prepare('SELECT 1 FROM band_members WHERE band_id = ? AND user_id = ?').get(band.id, req.user.id)) {
    return res.json({ id: band.id, name: band.name });
  }
  if (req.body.member_id) {
    const { changes } = db.prepare(`
      UPDATE band_members SET user_id = ?, email = COALESCE(email, ?)
      WHERE id = ? AND band_id = ? AND user_id IS NULL
    `).run(req.user.id, req.user.email, Number(req.body.member_id), band.id);
    if (!changes) throw new HttpError(409, 'That member profile has already been claimed');
  } else {
    db.prepare('INSERT INTO band_members (band_id, name, email, instrument_id, user_id) VALUES (?, ?, ?, ?, ?)')
      .run(band.id, clean(req.body.name) || req.user.display_name, req.user.email,
        validInstrumentId(req.body.instrument_id, band.id), req.user.id);
  }
  // A band without any admin (e.g. created before admins existed, nobody signed up yet) gets one.
  db.prepare(`
    UPDATE band_members SET is_admin = 1
    WHERE band_id = @band AND user_id = @user
      AND NOT EXISTS (SELECT 1 FROM band_members WHERE band_id = @band AND is_admin = 1)
  `).run({ band: band.id, user: req.user.id });
  res.status(201).json({ id: band.id, name: band.name });
});

// ---------- Band members ----------

const memberSelect = (userId) => `
  SELECT m.id, m.band_id, m.name, m.email, m.instrument_id, i.name AS instrument,
         m.user_id IS NOT NULL AS has_account, m.user_id IS ${Number(userId)} AS is_me, m.is_admin,
         (SELECT GROUP_CONCAT(mi.instrument_id) FROM member_instruments mi WHERE mi.member_id = m.id) AS secondary_ids
  FROM band_members m
  LEFT JOIN instruments i ON i.id = m.instrument_id
  LEFT JOIN band_instruments bi ON bi.band_id = m.band_id AND bi.instrument_id = m.instrument_id`;

const toMember = (m) => {
  if (!m) return m;
  const { secondary_ids: ids, ...rest } = m;
  return {
    ...rest, has_account: Boolean(m.has_account), is_me: Boolean(m.is_me), is_admin: Boolean(m.is_admin),
    secondary_instrument_ids: ids ? String(ids).split(',').map(Number).sort((a, b) => a - b) : [],
  };
};

// Replaces a member's secondary instruments (when `ids` is given) and keeps the rule that the
// primary instrument is never also a secondary.
function saveSecondaryInstruments(memberId, bandId, primaryId, ids) {
  if (ids !== undefined) {
    if (!Array.isArray(ids)) throw new HttpError(400, 'secondary_instrument_ids must be a list');
    const unique = [...new Set(ids.map(Number))].filter((id) => id !== primaryId);
    for (const id of unique) {
      if (!Number.isInteger(id)) throw new HttpError(400, 'Unknown instrument');
      validInstrumentId(id, bandId);
    }
    db.prepare('DELETE FROM member_instruments WHERE member_id = ?').run(memberId);
    const insert = db.prepare('INSERT INTO member_instruments (member_id, instrument_id) VALUES (?, ?)');
    for (const id of unique) insert.run(memberId, id);
  }
  if (primaryId) {
    db.prepare('DELETE FROM member_instruments WHERE member_id = ? AND instrument_id = ?').run(memberId, primaryId);
  }
}

app.get('/api/bands/:bandId/members', (req, res) => {
  const me = requireMember(req, req.params.bandId);
  res.json(
    db.prepare(`${memberSelect(req.user.id)} WHERE m.band_id = ? ORDER BY COALESCE(bi.sort_order, 9999), m.name`)
      .all(me.band_id).map(toMember)
  );
});

function validateMember(body, bandId) {
  const name = clean(body.name);
  if (!name) throw new HttpError(400, 'Member name is required');
  const email = clean(body.email);
  if (email && !EMAIL_RE.test(email)) throw new HttpError(400, `"${email}" doesn't look like an email address`);
  return { name, email, instrumentId: validInstrumentId(body.instrument_id, bandId) };
}

// Adds a member profile without an account (e.g. a sub). They can claim it later via the invite link.
app.post('/api/bands/:bandId/members', (req, res) => {
  const me = requireMember(req, req.params.bandId);
  const { name, email, instrumentId } = validateMember(req.body, me.band_id);
  const { lastInsertRowid } = db
    .prepare('INSERT INTO band_members (band_id, name, email, instrument_id) VALUES (?, ?, ?, ?)')
    .run(me.band_id, name, email, instrumentId);
  res.status(201).json(toMember(db.prepare(`${memberSelect(req.user.id)} WHERE m.id = ?`).get(lastInsertRowid)));
});

// Any member of the same band may edit or remove members.
function requireSameBand(req, memberId) {
  const target = findOr404('SELECT id, band_id FROM band_members WHERE id = ?', memberId, 'Member');
  try {
    requireMember(req, target.band_id);
  } catch {
    throw new HttpError(404, 'Member not found');
  }
  return target;
}

app.put('/api/members/:memberId', (req, res) => {
  const target = requireSameBand(req, req.params.memberId);
  const { name, email, instrumentId } = validateMember(req.body, target.band_id);
  // secondary_instrument_ids: omitted keeps the current list; [] clears it.
  db.transaction(() => {
    db.prepare('UPDATE band_members SET name = ?, email = ?, instrument_id = ? WHERE id = ?')
      .run(name, email, instrumentId, target.id);
    saveSecondaryInstruments(target.id, target.band_id, instrumentId, req.body.secondary_instrument_ids);
  })();
  res.json(toMember(db.prepare(`${memberSelect(req.user.id)} WHERE m.id = ?`).get(target.id)));
});

// Make a member an admin, or remove admin. Admins only; the member needs an account, and a
// band always keeps at least one admin.
app.put('/api/members/:memberId/admin', (req, res) => {
  const target = findOr404('SELECT id, band_id, user_id, is_admin FROM band_members WHERE id = ?', req.params.memberId, 'Member');
  let me;
  try {
    me = requireMember(req, target.band_id);
  } catch {
    throw new HttpError(404, 'Member not found');
  }
  if (!me.is_admin) throw new HttpError(403, 'Only band admins can change who is an admin');
  const makeAdmin = req.body.is_admin === true;
  if (makeAdmin && !target.user_id) throw new HttpError(400, 'Only members with an account can be admins');
  if (!makeAdmin && target.is_admin) {
    const admins = db.prepare('SELECT COUNT(*) AS n FROM band_members WHERE band_id = ? AND is_admin = 1').get(target.band_id).n;
    if (admins <= 1) throw new HttpError(409, 'A band needs at least one admin. Make someone else an admin first.');
  }
  db.prepare('UPDATE band_members SET is_admin = ? WHERE id = ?').run(makeAdmin ? 1 : 0, target.id);
  res.json(toMember(db.prepare(`${memberSelect(req.user.id)} WHERE m.id = ?`).get(target.id)));
});

app.delete('/api/members/:memberId', (req, res) => {
  const target = requireSameBand(req, req.params.memberId);
  db.prepare('DELETE FROM band_members WHERE id = ?').run(target.id);
  res.status(204).end();
});

// ---------- Events ----------

function validateEvent(body) {
  const type = body.type;
  if (!EVENT_TYPES.includes(type)) throw new HttpError(400, 'Type must be "rehearsal" or "gig"');
  const title = clean(body.title);
  if (!title) throw new HttpError(400, 'Title is required');
  if (!DATE_RE.test(body.event_date || '')) throw new HttpError(400, 'Date must be YYYY-MM-DD');
  const callTime = clean(body.call_time);
  const hitTime = clean(body.hit_time);
  if (callTime && !TIME_RE.test(callTime)) throw new HttpError(400, 'Call time must be HH:MM');
  if (hitTime && !TIME_RE.test(hitTime)) throw new HttpError(400, 'Hit time must be HH:MM');
  return {
    type,
    title,
    eventDate: body.event_date,
    venue: clean(body.venue),
    callTime,
    hitTime,
    setList: clean(body.set_list),
    description: clean(body.description),
  };
}

// Compact overview of every event in the band, cancelled ones included, oldest first. `today` is
// the band's local date so the app can tell past months from upcoming ones.
app.get('/api/bands/:bandId/events/overview', (req, res) => {
  const me = requireMember(req, req.params.bandId);
  const { timezone } = db.prepare('SELECT timezone FROM bands WHERE id = ?').get(me.band_id);
  const events = db.prepare(`
    SELECT e.id, e.type, e.title, e.event_date, e.status, d.call_time
    FROM events e LEFT JOIN event_details d ON d.event_id = e.id
    WHERE e.band_id = ?
    ORDER BY e.event_date, d.call_time, e.id
  `).all(me.band_id);
  res.json({ today: todayIn(timezone || DEFAULT_TIMEZONE), events });
});

// List events with RSVP counts, upcoming first by default.
// my_status is the signed-in member's own response.
app.get('/api/bands/:bandId/events', (req, res) => {
  const me = requireMember(req, req.params.bandId);
  const when = req.query.when === 'past' ? 'past' : 'upcoming';
  // Events stay in Upcoming through their whole day in the band's time zone. (The server's own
  // clock is UTC on Fly, which would move evening events to Past before they happen.)
  const { timezone } = db.prepare('SELECT timezone FROM bands WHERE id = ?').get(me.band_id);
  const today = todayIn(timezone || DEFAULT_TIMEZONE);
  // Cancelled events are left off the list (they stay reachable by link).
  const dateFilter = (when === 'past' ? 'e.event_date < @today' : 'e.event_date >= @today')
    + " AND e.status != 'cancelled'";
  const rows = db.prepare(`
    SELECT e.id, e.type, e.title, e.event_date, e.status, d.venue, d.call_time, d.hit_time,
           SUM(a.status = 'yes')  AS yes_count,
           SUM(a.status = 'iffy') AS iffy_count,
           SUM(a.status = 'no')   AS no_count,
           MAX(CASE WHEN a.member_id = @memberId THEN a.status END) AS my_status,
           MAX(CASE WHEN a.member_id = @memberId THEN a.iffy_reason END) AS my_iffy_reason
    FROM events e
    LEFT JOIN event_details d ON d.event_id = e.id
    LEFT JOIN event_attendance a ON a.event_id = e.id
    WHERE e.band_id = @bandId AND ${dateFilter}
    GROUP BY e.id
    ORDER BY e.event_date ${when === 'past' ? 'DESC' : 'ASC'}, d.call_time ASC
  `).all({ bandId: me.band_id, memberId: me.id, today });

  // Every band member for every listed event, with their response (null = hasn't responded),
  // grouped by the instrument they're playing. Within an instrument: yes, iffy, no response, no.
  const attendance = db.prepare(`
    SELECT e.id AS event_id, a.status, a.iffy_reason, m.id, m.name,
           i.id AS instrument_id, i.name AS instrument, bi.sort_order
    FROM events e
    JOIN band_members m ON m.band_id = e.band_id
    LEFT JOIN event_attendance a ON a.event_id = e.id AND a.member_id = m.id
    LEFT JOIN instruments i ON i.id = COALESCE(a.instrument_id, m.instrument_id)
    LEFT JOIN band_instruments bi ON bi.band_id = e.band_id AND bi.instrument_id = i.id
    WHERE e.band_id = @bandId AND ${dateFilter}
    ORDER BY COALESCE(bi.sort_order, 9999), i.name,
             CASE a.status WHEN 'yes' THEN 0 WHEN 'iffy' THEN 1 WHEN 'no' THEN 3 ELSE 2 END, m.name
  `).all({ bandId: me.band_id, today });
  const byEvent = new Map();
  for (const row of attendance) {
    if (!byEvent.has(row.event_id)) byEvent.set(row.event_id, []);
    byEvent.get(row.event_id).push(row);
  }
  const plays = instrumentsPlayed(me.band_id);
  const requirements = quorumRequirements(me.band_id);
  const shape = ({ id, name, instrument, status, iffy_reason, secondary }) =>
    ({ id, name, instrument, status, iffy_reason, ...(secondary ? { secondary: true } : {}) });

  res.json(rows.map((r) => {
    const main = byEvent.get(r.id) || [];
    return {
      ...r,
      yes_count: r.yes_count || 0,
      iffy_count: r.iffy_count || 0,
      no_count: r.no_count || 0,
      no_response_count: main.filter((m) => !m.status).length,
      // Main entries plus (Name) entries in the other sections each member also plays.
      attendees: withSecondaryEntries(main, plays).map(shape),
      // Counts and quorum use main entries only: a player counts once, for what they're playing.
      quorum: quorumFor(main, requirements),
    };
  }));
});

// Every instrument each member of a band plays (primary + secondaries): Map(memberId -> [{ id, name, sort_order }]).
function instrumentsPlayed(bandId) {
  const rows = db.prepare(`
    SELECT m.id AS member_id, i.id, i.name, bi.sort_order
    FROM band_members m JOIN instruments i ON i.id = m.instrument_id
    LEFT JOIN band_instruments bi ON bi.band_id = m.band_id AND bi.instrument_id = i.id
    WHERE m.band_id = @band
    UNION
    SELECT mi.member_id, i.id, i.name, bi.sort_order
    FROM member_instruments mi JOIN band_members m ON m.id = mi.member_id JOIN instruments i ON i.id = mi.instrument_id
    LEFT JOIN band_instruments bi ON bi.band_id = m.band_id AND bi.instrument_id = i.id
    WHERE m.band_id = @band
  `).all({ band: bandId });
  const map = new Map();
  for (const { member_id: memberId, ...inst } of rows) {
    if (!map.has(memberId)) map.set(memberId, []);
    map.get(memberId).push(inst);
  }
  return map;
}

const STATUS_RANK = { yes: 0, iffy: 1, no: 3 };
// Adds a secondary copy of each entry in every other instrument that member plays (not the one
// they're playing), then sorts: instrument order, main before secondary, status, name.
function withSecondaryEntries(entries, plays) {
  const all = [...entries];
  for (const e of entries) {
    for (const inst of plays.get(e.id) || []) {
      if (inst.id === e.instrument_id) continue;
      all.push({ ...e, instrument_id: inst.id, instrument: inst.name, sort_order: inst.sort_order, secondary: true });
    }
  }
  return all.sort((a, b) =>
    (a.sort_order ?? 9999) - (b.sort_order ?? 9999)
    || String(a.instrument ?? '').localeCompare(String(b.instrument ?? ''))
    || (a.secondary ? 1 : 0) - (b.secondary ? 1 : 0)
    || (STATUS_RANK[a.status] ?? 2) - (STATUS_RANK[b.status] ?? 2)
    || a.name.localeCompare(b.name));
}

// Full event: details + attendance. "Yes" responders are grouped by the instrument they're
// playing at this event (their per-event choice, falling back to their primary instrument).
function getEvent(eventId) {
  const event = db.prepare(`
    SELECT e.*, d.venue, d.call_time, d.hit_time, d.set_list, d.description,
           c.name AS created_by_name, su.name AS status_updated_by_name,
           b.name AS band_name, b.timezone AS band_timezone
    FROM events e
    JOIN bands b ON b.id = e.band_id
    LEFT JOIN event_details d ON d.event_id = e.id
    LEFT JOIN band_members c ON c.id = e.created_by
    LEFT JOIN band_members su ON su.id = e.status_updated_by
    WHERE e.id = ?
  `).get(eventId);
  if (!event) throw new HttpError(404, 'Event not found');

  const members = db.prepare(`
    SELECT m.id, m.name, i.id AS instrument_id, i.name AS instrument, bi.sort_order, a.status, a.iffy_reason, a.updated_at,
           a.instrument_id AS event_instrument_id, p.name AS primary_instrument
    FROM band_members m
    LEFT JOIN event_attendance a ON a.member_id = m.id AND a.event_id = ?
    LEFT JOIN instruments i ON i.id = COALESCE(a.instrument_id, m.instrument_id)
    LEFT JOIN instruments p ON p.id = m.instrument_id
    LEFT JOIN band_instruments bi ON bi.band_id = m.band_id AND bi.instrument_id = i.id
    WHERE m.band_id = ?
    ORDER BY COALESCE(bi.sort_order, 9999), i.name, m.name
  `).all(eventId, event.band_id);

  // Yes responders by the instrument they're playing, plus (Name) entries in the other sections
  // they also play. Entries arrive sorted by instrument, so consecutive runs form the groups.
  const goingByInstrument = [];
  const going = withSecondaryEntries(members.filter((m) => m.status === 'yes'), instrumentsPlayed(event.band_id));
  for (const m of going) {
    const key = m.instrument || 'No instrument';
    if (goingByInstrument.at(-1)?.instrument !== key) goingByInstrument.push({ instrument: key, members: [] });
    goingByInstrument.at(-1).members.push(m.secondary ? { id: m.id, name: m.name, secondary: true } : {
      id: m.id,
      name: m.name,
      // Set when they're covering something other than their usual instrument.
      primary_instrument: m.event_instrument_id ? m.primary_instrument : null,
    });
  }

  const pick = (fn) => members.filter(fn).map(({ id, name, instrument }) => ({ id, name, instrument }));

  return {
    ...event,
    // Start/end for "Add to calendar" (UTC, or dates for all-day events).
    calendar: eventTimes(event, event.band_timezone),
    quorum: quorumFor(members, quorumRequirements(event.band_id)),
    attendance: {
      going_by_instrument: goingByInstrument,
      iffy: members.filter((m) => m.status === 'iffy')
        .map(({ id, name, instrument, iffy_reason }) => ({ id, name, instrument, iffy_reason })),
      no: pick((m) => m.status === 'no'),
      no_response: pick((m) => !m.status),
      responses: Object.fromEntries(
        members.filter((m) => m.status).map((m) => [
          m.id, { status: m.status, instrument_id: m.event_instrument_id, iffy_reason: m.iffy_reason },
        ])
      ),
    },
  };
}

app.get('/api/events/:eventId', (req, res) => {
  const { event } = requireEventMember(req, req.params.eventId);
  res.json(getEvent(event.id));
});

// "Add to calendar" download for Apple Calendar / Outlook (a one-time copy; it won't update).
app.get('/api/events/:eventId/calendar.ics', (req, res) => {
  const { event, member } = requireEventMember(req, req.params.eventId);
  const row = db.prepare(`
    SELECT ${CALENDAR_EVENT_COLUMNS}
    FROM events e
    JOIN bands b ON b.id = e.band_id
    LEFT JOIN event_details d ON d.event_id = e.id
    LEFT JOIN event_attendance a ON a.event_id = e.id AND a.member_id = ?
    WHERE e.id = ?
  `).get(member.id, event.id);
  const filename = row.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'event';
  res.type('text/calendar; charset=utf-8')
    .attachment(`${filename}.ics`)
    .send(buildCalendar({ name: row.title, events: [row], appUrl: appUrl(req), includeRsvp: true }));
});

const createEvent = db.transaction((bandId, createdBy, e) => {
  const { lastInsertRowid: eventId } = db
    .prepare('INSERT INTO events (band_id, type, title, event_date, created_by) VALUES (?, ?, ?, ?, ?)')
    .run(bandId, e.type, e.title, e.eventDate, createdBy);
  db.prepare(`
    INSERT INTO event_details (event_id, venue, call_time, hit_time, set_list, description)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(eventId, e.venue, e.callTime, e.hitTime, e.setList, e.description);
  return eventId;
});

// Emails everyone else in the band about an event (kind: 'created' | 'confirmed' | 'cancelled').
// Sending happens in the background; returns counts for the confirmation message in the app.
function emailBand(req, { kind, event, actor }) {
  const others = db.prepare(`
    SELECT m.id, m.name, m.email, a.status AS rsvp
    FROM band_members m
    LEFT JOIN event_attendance a ON a.member_id = m.id AND a.event_id = ?
    WHERE m.band_id = ? AND m.id != ?
  `).all(event.id, event.band_id, actor.id);
  const recipients = others.filter((m) => m.email);
  if (recipients.length) {
    const bandName = db.prepare('SELECT name FROM bands WHERE id = ?').get(event.band_id).name;
    // Not awaited: the response doesn't wait on the mail server.
    notifyBand({ kind, event, bandName, actor, recipients, appUrl: appUrl(req) })
      .catch((err) => console.error(`Event ${event.id}: ${kind} notification failed: ${err.message}`));
  }
  return { notified: recipients.length, missing_email: others.length - recipients.length, email_enabled: emailEnabled };
}

// Emails the rest of the band about the new event unless the request sends notify: false.
app.post('/api/bands/:bandId/events', (req, res) => {
  const me = requireMember(req, req.params.bandId);
  const eventId = createEvent(me.band_id, me.id, validateEvent(req.body));
  const event = getEvent(eventId);
  const emailed = req.body.notify !== false
    ? emailBand(req, { kind: 'created', event, actor: me })
    : { notified: 0, missing_email: 0, email_enabled: emailEnabled };
  res.status(201).json({ ...event, ...emailed });
});

// Confirm or cancel an event (a cancelled event can be confirmed again). Emails the band on change.
app.put('/api/events/:eventId/status', (req, res) => {
  const { event, member } = requireEventMember(req, req.params.eventId);
  const status = req.body.status;
  if (!SETTABLE_EVENT_STATUSES.includes(status)) throw new HttpError(400, 'Status must be "confirmed" or "cancelled"');
  if (status === event.status) {
    return res.json({ ...getEvent(event.id), notified: 0, missing_email: 0, email_enabled: emailEnabled, unchanged: true });
  }
  db.prepare(`UPDATE events SET status = ?, status_updated_at = datetime('now'), status_updated_by = ? WHERE id = ?`)
    .run(status, member.id, event.id);
  const updated = getEvent(event.id);
  res.json({ ...updated, ...emailBand(req, { kind: status, event: updated, actor: member }) });
});

const updateEvent = db.transaction((eventId, e) => {
  db.prepare('UPDATE events SET type = ?, title = ?, event_date = ? WHERE id = ?')
    .run(e.type, e.title, e.eventDate, eventId);
  db.prepare(`
    INSERT INTO event_details (event_id, venue, call_time, hit_time, set_list, description)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(event_id) DO UPDATE SET
      venue = excluded.venue, call_time = excluded.call_time, hit_time = excluded.hit_time,
      set_list = excluded.set_list, description = excluded.description
  `).run(eventId, e.venue, e.callTime, e.hitTime, e.setList, e.description);
});

app.put('/api/events/:eventId', (req, res) => {
  const { event } = requireEventMember(req, req.params.eventId);
  updateEvent(event.id, validateEvent(req.body));
  res.json(getEvent(event.id));
});

app.delete('/api/events/:eventId', (req, res) => {
  const { event } = requireEventMember(req, req.params.eventId);
  db.prepare('DELETE FROM events WHERE id = ?').run(event.id);
  res.status(204).end();
});

// ---------- RSVP ----------

// Members RSVP for themselves (from the session); admins may pass member_id to answer for a bandmate.
app.put('/api/events/:eventId/rsvp', (req, res) => {
  const { event, member: me } = requireEventMember(req, req.params.eventId);
  if (event.status === 'cancelled') throw new HttpError(409, 'This event was cancelled, so it no longer takes RSVPs');
  // Admins may answer for any member of the band (member_id); everyone else answers for themselves.
  let member = me;
  if (req.body.member_id != null && Number(req.body.member_id) !== me.id) {
    if (!me.is_admin) throw new HttpError(403, 'Only band admins can RSVP for other members');
    member = db.prepare('SELECT * FROM band_members WHERE id = ? AND band_id = ?').get(Number(req.body.member_id), event.band_id);
    if (!member) throw new HttpError(404, 'Member not found');
  }
  const memberId = member.id;
  const status = req.body.status;
  if (!RSVP_STATUSES.includes(status)) throw new HttpError(400, 'Status must be yes, no, or iffy');

  // instrument_id: omitted keeps the existing choice; null (or their primary) means "my usual instrument".
  const setInstrument = 'instrument_id' in req.body;
  let instrumentId = req.body.instrument_id ? Number(req.body.instrument_id) : null;
  if (instrumentId) validInstrumentId(instrumentId, event.band_id);
  if (instrumentId === member.instrument_id) instrumentId = null;

  // iffy_reason (Iffy only): omitted keeps the existing reason; empty/null clears it.
  // Answering yes or no always clears it.
  const setReason = 'iffy_reason' in req.body;
  const rawReason = req.body.iffy_reason;
  if (setReason && rawReason != null && typeof rawReason !== 'string') throw new HttpError(400, 'Reason must be text');
  const reason = setReason ? clean(rawReason) : null;
  if (reason && reason.length > MAX_IFFY_REASON) {
    throw new HttpError(400, `Keep the reason to ${MAX_IFFY_REASON} characters or fewer`);
  }

  db.prepare(`
    INSERT INTO event_attendance (event_id, member_id, status, instrument_id, iffy_reason, updated_at)
    VALUES (@eventId, @memberId, @status, @instrumentId, CASE WHEN @status = 'iffy' THEN @reason END, datetime('now'))
    ON CONFLICT(event_id, member_id) DO UPDATE SET
      status = excluded.status,
      instrument_id = CASE WHEN @setInstrument THEN excluded.instrument_id ELSE instrument_id END,
      iffy_reason = CASE WHEN excluded.status != 'iffy' THEN NULL
                         WHEN @setReason THEN @reason
                         ELSE iffy_reason END,
      updated_at = excluded.updated_at
  `).run({
    eventId: event.id, memberId, status, instrumentId, reason,
    setInstrument: setInstrument ? 1 : 0, setReason: setReason ? 1 : 0,
  });
  res.json(getEvent(event.id));
});

// ---------- Errors ----------

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// In production, serve the built React app (run `npm run build` first).
const CLIENT_DIST = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.get('/{*splat}', (req, res) => res.sendFile(path.join(CLIENT_DIST, 'index.html')));
}

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  // Bad request bodies rejected by express.json() are client errors, not server errors.
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body is not valid JSON' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request body is too large' });
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// `node index.js` starts the server; tests require() the app and listen on their own port.
if (require.main === module) {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => console.log(`Funklist API listening on http://localhost:${PORT}`));
}

module.exports = app;
