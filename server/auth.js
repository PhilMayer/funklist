const crypto = require('crypto');
const { promisify } = require('util');
const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const db = require('./db');
const { HttpError, clean } = require('./errors');

const scrypt = promisify(crypto.scrypt);

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || null;
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

const SESSION_COOKIE = 'funklist_session';
const SESSION_DAYS = 30;
// Secure cookies need HTTPS; enable in production or explicitly with COOKIE_SECURE=1.
const COOKIE_SECURE = process.env.COOKIE_SECURE
  ? process.env.COOKIE_SECURE === '1'
  : process.env.NODE_ENV === 'production';

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 200;

// ---------- Passwords (scrypt, built into Node) ----------

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = (stored || '').split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

// Hashed when a username doesn't exist, so failed logins take the same time either way.
const DUMMY_HASH = `scrypt$${'0'.repeat(32)}$${'0'.repeat(128)}`;

// ---------- Sessions ----------

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, datetime('now', ?))`)
    .run(sha256(token), userId, `+${SESSION_DAYS} days`);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: COOKIE_SECURE,
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
  });
}

function endSession(req, res) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

const USER_FIELDS = 'u.id, u.username, u.email, u.display_name, u.google_sub IS NOT NULL AS has_google';

// Sets req.user when the request carries a valid session cookie.
function loadUser(req, res, next) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  req.user = token
    ? db.prepare(`
        SELECT ${USER_FIELDS} FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ? AND s.expires_at > datetime('now')
      `).get(sha256(token)) || null
    : null;
  next();
}

function requireUser(req, res, next) {
  if (!req.user) throw new HttpError(401, 'Please sign in');
  next();
}

const publicUser = (u) => ({
  id: u.id,
  username: u.username,
  email: u.email,
  display_name: u.display_name,
  has_google: Boolean(u.has_google),
});
const getUser = (id) => publicUser(db.prepare(`SELECT ${USER_FIELDS} FROM users u WHERE u.id = ?`).get(id));

// ---------- Basic brute-force protection (in memory, per IP) ----------

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 20;
const attempts = new Map();

function rateLimit(req, res, next) {
  const now = Date.now();
  const entry = attempts.get(req.ip);
  if (!entry || entry.resetAt < now) {
    attempts.set(req.ip, { count: 1, resetAt: now + WINDOW_MS });
  } else if (++entry.count > MAX_ATTEMPTS) {
    throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
  }
  next();
}

// ---------- Routes ----------

const router = express.Router();

router.get('/config', (req, res) => {
  res.json({ googleClientId: GOOGLE_CLIENT_ID });
});

router.get('/me', (req, res) => {
  res.json({ user: req.user ? publicUser(req.user) : null });
});

router.post('/register', rateLimit, async (req, res) => {
  const username = clean(req.body.username);
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const displayName = clean(req.body.display_name) || username;
  if (!username || !USERNAME_RE.test(username)) {
    throw new HttpError(400, 'Username must be 3–32 characters: letters, numbers, dot, dash, or underscore');
  }
  if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) {
    throw new HttpError(400, `Password must be at least ${MIN_PASSWORD} characters`);
  }
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
    throw new HttpError(409, 'That username is taken');
  }
  const passwordHash = await hashPassword(password);
  const { lastInsertRowid } = db
    .prepare('INSERT INTO users (username, password_hash, display_name) VALUES (?, ?, ?)')
    .run(username, passwordHash, displayName);
  startSession(res, lastInsertRowid);
  res.status(201).json({ user: getUser(lastInsertRowid) });
});

router.post('/login', rateLimit, async (req, res) => {
  const username = clean(req.body.username) || '';
  const password = typeof req.body.password === 'string' ? req.body.password.slice(0, MAX_PASSWORD) : '';
  const user = db.prepare('SELECT id, password_hash FROM users WHERE username = ?').get(username);
  const ok = await verifyPassword(password, user?.password_hash || DUMMY_HASH);
  if (!user || !user.password_hash || !ok) throw new HttpError(401, 'Incorrect username or password');
  startSession(res, user.id);
  res.json({ user: getUser(user.id) });
});

// The browser gets an ID token from Google Identity Services; we verify its signature and audience.
router.post('/google', rateLimit, async (req, res) => {
  if (!googleClient) throw new HttpError(400, 'Google sign-in is not configured on this server');
  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({ idToken: req.body.credential, audience: GOOGLE_CLIENT_ID });
    payload = ticket.getPayload();
  } catch {
    throw new HttpError(401, 'Google sign-in failed. Please try again.');
  }
  const existing = db.prepare('SELECT id FROM users WHERE google_sub = ?').get(payload.sub);
  let userId = existing?.id;
  if (!userId) {
    userId = db
      .prepare('INSERT INTO users (google_sub, email, display_name) VALUES (?, ?, ?)')
      .run(payload.sub, payload.email_verified ? payload.email : null, payload.name || payload.email || 'Google user')
      .lastInsertRowid;
  }
  startSession(res, userId);
  res.status(existing ? 200 : 201).json({ user: getUser(userId) });
});

router.post('/logout', (req, res) => {
  endSession(req, res);
  res.status(204).end();
});

module.exports = { router, loadUser, requireUser };
