const fs = require('fs');
const path = require('path');

// Load server/.env (GOOGLE_CLIENT_ID etc.) before anything reads process.env.
try { process.loadEnvFile(path.join(__dirname, '.env')); } catch { /* no .env file */ }

const express = require('express');
const db = require('./db');
const { newInviteCode } = require('./db');
const { HttpError, clean } = require('./errors');
const auth = require('./auth');
const { quorumFor } = require('./quorum');
const { notifyBand } = require('./notify');
const { emailEnabled } = require('./mailer');

const app = express();
// Behind a hosting proxy (e.g. Fly.io), trust its X-Forwarded-For so req.ip is the real client
// (used by the login rate limit).
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
app.use(express.json());
app.use(auth.loadUser);
app.use('/api/auth', auth.router);
// Everything else under /api requires a signed-in user.
app.use('/api', auth.requireUser);

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

app.get('/api/instruments', (req, res) => {
  res.json(db.prepare('SELECT * FROM instruments ORDER BY sort_order, name').all());
});

app.post('/api/instruments', (req, res) => {
  const name = clean(req.body.name);
  if (!name) throw new HttpError(400, 'Instrument name is required');
  const existing = db.prepare('SELECT * FROM instruments WHERE name = ?').get(name);
  if (existing) return res.json(existing);
  const { lastInsertRowid } = db.prepare('INSERT INTO instruments (name) VALUES (?)').run(name);
  res.status(201).json(db.prepare('SELECT * FROM instruments WHERE id = ?').get(lastInsertRowid));
});

// ---------- Bands ----------

// Only the bands the signed-in user belongs to.
app.get('/api/bands', (req, res) => {
  res.json(db.prepare(`
    SELECT b.id, b.name, m.id AS member_id
    FROM bands b JOIN band_members m ON m.band_id = b.id AND m.user_id = ?
    ORDER BY b.name
  `).all(req.user.id));
});

function validInstrumentId(value) {
  const id = value ? Number(value) : null;
  if (id) findOr404('SELECT id FROM instruments WHERE id = ?', id, 'Instrument');
  return id;
}

// Creating a band makes you its first member.
app.post('/api/bands', (req, res) => {
  const name = clean(req.body.name);
  if (!name) throw new HttpError(400, 'Band name is required');
  const instrumentId = validInstrumentId(req.body.instrument_id);
  const bandId = db.transaction(() => {
    const id = db.prepare('INSERT INTO bands (name, invite_code) VALUES (?, ?)').run(name, newInviteCode()).lastInsertRowid;
    db.prepare('INSERT INTO band_members (band_id, name, email, instrument_id, user_id) VALUES (?, ?, ?, ?, ?)')
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
  const band = db.prepare('SELECT id, name, invite_code FROM bands WHERE id = ?').get(member.band_id);
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
    WHERE m.band_id = ? AND m.user_id IS NULL
    ORDER BY COALESCE(i.sort_order, 9999), m.name
  `).all(band.id);
  res.json({ band, already_member: Boolean(already), unclaimed_members: unclaimed });
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
        validInstrumentId(req.body.instrument_id), req.user.id);
  }
  res.status(201).json({ id: band.id, name: band.name });
});

// ---------- Band members ----------

const memberSelect = (userId) => `
  SELECT m.id, m.band_id, m.name, m.email, m.instrument_id, i.name AS instrument,
         m.user_id IS NOT NULL AS has_account, m.user_id IS ${Number(userId)} AS is_me
  FROM band_members m
  LEFT JOIN instruments i ON i.id = m.instrument_id`;

const toMember = (m) => m && { ...m, has_account: Boolean(m.has_account), is_me: Boolean(m.is_me) };

app.get('/api/bands/:bandId/members', (req, res) => {
  const me = requireMember(req, req.params.bandId);
  res.json(
    db.prepare(`${memberSelect(req.user.id)} WHERE m.band_id = ? ORDER BY COALESCE(i.sort_order, 9999), m.name`)
      .all(me.band_id).map(toMember)
  );
});

function validateMember(body) {
  const name = clean(body.name);
  if (!name) throw new HttpError(400, 'Member name is required');
  const email = clean(body.email);
  if (email && !EMAIL_RE.test(email)) throw new HttpError(400, `"${email}" doesn't look like an email address`);
  return { name, email, instrumentId: validInstrumentId(body.instrument_id) };
}

// Adds a member profile without an account (e.g. a sub). They can claim it later via the invite link.
app.post('/api/bands/:bandId/members', (req, res) => {
  const me = requireMember(req, req.params.bandId);
  const { name, email, instrumentId } = validateMember(req.body);
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
  const { name, email, instrumentId } = validateMember(req.body);
  db.prepare('UPDATE band_members SET name = ?, email = ?, instrument_id = ? WHERE id = ?')
    .run(name, email, instrumentId, target.id);
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

// List events with RSVP counts, upcoming first by default.
// my_status is the signed-in member's own response.
app.get('/api/bands/:bandId/events', (req, res) => {
  const me = requireMember(req, req.params.bandId);
  const when = req.query.when === 'past' ? 'past' : 'upcoming';
  // Cancelled events are left off the list (they stay reachable by link).
  const dateFilter = (when === 'past'
    ? "e.event_date < date('now', 'localtime')"
    : "e.event_date >= date('now', 'localtime')") + " AND e.status != 'cancelled'";
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
  `).all({ bandId: me.band_id, memberId: me.id });

  // Every band member for every listed event, with their response (null = hasn't responded),
  // grouped by the instrument they're playing. Within an instrument: yes, iffy, no response, no.
  const attendance = db.prepare(`
    SELECT e.id AS event_id, a.status, a.iffy_reason, m.id, m.name, i.name AS instrument
    FROM events e
    JOIN band_members m ON m.band_id = e.band_id
    LEFT JOIN event_attendance a ON a.event_id = e.id AND a.member_id = m.id
    LEFT JOIN instruments i ON i.id = COALESCE(a.instrument_id, m.instrument_id)
    WHERE e.band_id = ? AND ${dateFilter}
    ORDER BY COALESCE(i.sort_order, 9999), i.name,
             CASE a.status WHEN 'yes' THEN 0 WHEN 'iffy' THEN 1 WHEN 'no' THEN 3 ELSE 2 END, m.name
  `).all(me.band_id);
  const byEvent = new Map();
  for (const { event_id, status, iffy_reason, id, name, instrument } of attendance) {
    if (!byEvent.has(event_id)) byEvent.set(event_id, []);
    byEvent.get(event_id).push({ id, name, instrument, status, iffy_reason });
  }

  res.json(rows.map((r) => ({
    ...r,
    yes_count: r.yes_count || 0,
    iffy_count: r.iffy_count || 0,
    no_count: r.no_count || 0,
    no_response_count: (byEvent.get(r.id) || []).filter((m) => !m.status).length,
    attendees: byEvent.get(r.id) || [],
    quorum: quorumFor(byEvent.get(r.id) || []),
  })));
});

// Full event: details + attendance. "Yes" responders are grouped by the instrument they're
// playing at this event (their per-event choice, falling back to their primary instrument).
function getEvent(eventId) {
  const event = db.prepare(`
    SELECT e.*, d.venue, d.call_time, d.hit_time, d.set_list, d.description,
           c.name AS created_by_name, su.name AS status_updated_by_name
    FROM events e
    LEFT JOIN event_details d ON d.event_id = e.id
    LEFT JOIN band_members c ON c.id = e.created_by
    LEFT JOIN band_members su ON su.id = e.status_updated_by
    WHERE e.id = ?
  `).get(eventId);
  if (!event) throw new HttpError(404, 'Event not found');

  const members = db.prepare(`
    SELECT m.id, m.name, i.name AS instrument, i.sort_order, a.status, a.iffy_reason, a.updated_at,
           a.instrument_id AS event_instrument_id, p.name AS primary_instrument
    FROM band_members m
    LEFT JOIN event_attendance a ON a.member_id = m.id AND a.event_id = ?
    LEFT JOIN instruments i ON i.id = COALESCE(a.instrument_id, m.instrument_id)
    LEFT JOIN instruments p ON p.id = m.instrument_id
    WHERE m.band_id = ?
    ORDER BY COALESCE(i.sort_order, 9999), i.name, m.name
  `).all(eventId, event.band_id);

  const goingByInstrument = [];
  const groupIndex = new Map();
  for (const m of members.filter((m) => m.status === 'yes')) {
    const key = m.instrument || 'No instrument';
    if (!groupIndex.has(key)) {
      groupIndex.set(key, goingByInstrument.length);
      goingByInstrument.push({ instrument: key, members: [] });
    }
    goingByInstrument[groupIndex.get(key)].members.push({
      id: m.id,
      name: m.name,
      // Set when they're covering something other than their usual instrument.
      primary_instrument: m.event_instrument_id ? m.primary_instrument : null,
    });
  }

  const pick = (fn) => members.filter(fn).map(({ id, name, instrument }) => ({ id, name, instrument }));

  return {
    ...event,
    quorum: quorumFor(members),
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

// You can only RSVP for yourself: the member comes from the session, not the request body.
app.put('/api/events/:eventId/rsvp', (req, res) => {
  const { event, member } = requireEventMember(req, req.params.eventId);
  if (event.status === 'cancelled') throw new HttpError(409, 'This event was cancelled, so it no longer takes RSVPs');
  const memberId = member.id;
  const status = req.body.status;
  if (!RSVP_STATUSES.includes(status)) throw new HttpError(400, 'Status must be yes, no, or iffy');

  // instrument_id: omitted keeps the existing choice; null (or their primary) means "my usual instrument".
  const setInstrument = 'instrument_id' in req.body;
  let instrumentId = req.body.instrument_id ? Number(req.body.instrument_id) : null;
  if (instrumentId) findOr404('SELECT id FROM instruments WHERE id = ?', instrumentId, 'Instrument');
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

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Funklist API listening on http://localhost:${PORT}`));
