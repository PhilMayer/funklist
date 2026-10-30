const crypto = require('crypto');
const { promisify } = require('util');
const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const db = require('./db');
const { HttpError, clean } = require('./errors');
const { sendMail } = require('./mailer');

const scrypt = promisify(crypto.scrypt);

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || null;
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;
// Checks a Google ID token's signature and audience and returns its claims. Tests replace `verify`.
const google = {
  verify: googleClient
    ? async (idToken) => (await googleClient.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID })).getPayload()
    : null,
};

const SESSION_COOKIE = 'funklist_session';
const SESSION_DAYS = 30;
// Secure cookies need HTTPS; enable in production or explicitly with COOKIE_SECURE=1.
const COOKIE_SECURE = process.env.COOKIE_SECURE
  ? process.env.COOKIE_SECURE === '1'
  : process.env.NODE_ENV === 'production';

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 200;
const RESET_MINUTES = 60;

function checkNewPassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) {
    throw new HttpError(400, `Password must be ${MIN_PASSWORD}–${MAX_PASSWORD} characters`);
  }
}

// Base URL for links in emails (APP_URL in production).
const appUrl = (req) => (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');

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

const USER_FIELDS = 'u.id, u.username, u.email, u.display_name, u.google_sub IS NOT NULL AS has_google, u.password_hash IS NOT NULL AS has_password';

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
  has_password: Boolean(u.has_password),
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
  const email = clean(req.body.email); // optional; used for event notifications
  if (!username || !USERNAME_RE.test(username)) {
    throw new HttpError(400, 'Username must be 3–32 characters: letters, numbers, dot, dash, or underscore');
  }
  checkNewPassword(password);
  if (email && !EMAIL_RE.test(email)) throw new HttpError(400, `"${email}" doesn't look like an email address`);
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
    throw new HttpError(409, 'That username is taken');
  }
  if (email && db.prepare('SELECT 1 FROM users WHERE email = ? COLLATE NOCASE').get(email)) {
    throw new HttpError(409, 'There’s already an account with this email. Sign in instead (with Google or your password), or use “Forgot password?”.');
  }
  const passwordHash = await hashPassword(password);
  const { lastInsertRowid } = db
    .prepare('INSERT INTO users (username, password_hash, email, display_name) VALUES (?, ?, ?, ?)')
    .run(username, passwordHash, email, displayName);
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

const LINK_NEEDS_RESET =
  'There’s already a Funklist account with this email. To use Google with it, confirm the email first: ' +
  'choose “Forgot password?”, open the emailed link, and set a password. Then “Continue with Google” signs in to that account.';

// The browser gets an ID token from Google Identity Services; we verify its signature and audience.
// One email, one account: a Google sign-in whose email matches an account that signed up with a username
// signs in to (and links Google to) that account. Its email must be proven first, though; otherwise
// anyone could sign up with someone else's address and share the account they later sign in to.
router.post('/google', rateLimit, async (req, res) => {
  if (!google.verify) throw new HttpError(400, 'Google sign-in is not configured on this server');
  let payload;
  try {
    payload = await google.verify(req.body.credential);
  } catch {
    throw new HttpError(401, 'Google sign-in failed. Please try again.');
  }
  const email = payload.email_verified ? payload.email : null;
  const existing = db.prepare('SELECT id, password_hash FROM users WHERE google_sub = ?').get(payload.sub);
  // A Google-only account that isn't in any band can be folded into a matching account, which also
  // repairs duplicates made before Google sign-ins were linked by email.
  const replaceable = !existing ||
    (!existing.password_hash && !db.prepare('SELECT 1 FROM band_members WHERE user_id = ?').get(existing.id));
  const matches = email && replaceable
    ? db.prepare(`
        SELECT id, email_verified FROM users WHERE email = ? COLLATE NOCASE AND google_sub IS NULL
        ORDER BY email_verified DESC, id
      `).all(email)
    : [];
  let userId = existing?.id;
  if (matches.length && !matches[0].email_verified) throw new HttpError(409, LINK_NEEDS_RESET);
  if (matches.length) {
    userId = matches[0].id;
    db.transaction(() => {
      if (existing) db.prepare('DELETE FROM users WHERE id = ?').run(existing.id);
      db.prepare('UPDATE users SET google_sub = ? WHERE id = ?').run(payload.sub, userId);
    })();
  } else if (!userId) {
    userId = db
      .prepare('INSERT INTO users (google_sub, email, email_verified, display_name) VALUES (?, ?, ?, ?)')
      .run(payload.sub, email, email ? 1 : 0, payload.name || payload.email || 'Google user')
      .lastInsertRowid;
  }
  startSession(res, userId);
  res.status(existing || matches.length ? 200 : 201).json({ user: getUser(userId) });
});

// ---------- Password reset ----------

function sendResetEmail(req, user, token) {
  const link = `${appUrl(req)}/?reset=${token}`;
  return sendMail({
    to: user.email,
    subject: 'Reset your Funklist password',
    text: [
      `Hi ${user.display_name},`,
      '',
      `Someone (hopefully you) asked to reset the password for your Funklist account "${user.username}".`,
      `Choose a new password here within ${RESET_MINUTES} minutes:`,
      link,
      '',
      'If you didn’t ask for this, you can ignore this email; your password won’t change.',
    ].join('\n'),
  });
}

function sendGoogleOnlyEmail(user) {
  return sendMail({
    to: user.email,
    subject: 'Signing in to Funklist',
    text: [
      `Hi ${user.display_name},`,
      '',
      'Someone asked to reset the password for the Funklist account with this email address.',
      'That account signs in with Google, so there is no Funklist password to reset: use "Continue with Google" on the sign-in page.',
    ].join('\n'),
  });
}

// Always answers the same way, whether or not an account matches, so it can't be used to find accounts.
// Only the account's own email is used (not band member profile emails, which bandmates can edit).
router.post('/forgot', rateLimit, (req, res) => {
  const identifier = clean(req.body.identifier) || '';
  db.prepare("DELETE FROM password_resets WHERE expires_at < datetime('now')").run();
  const users = identifier.includes('@')
    ? db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').all(identifier)
    : db.prepare('SELECT * FROM users WHERE username = ?').all(identifier);
  const withEmail = users.filter((u) => u.email);
  // Older duplicates can share an email: then the password account's link is all that's needed.
  const anyPassword = withEmail.some((u) => u.password_hash);
  for (const user of withEmail) {
    let sending;
    if (user.password_hash) {
      const token = crypto.randomBytes(32).toString('base64url');
      db.transaction(() => {
        // A new link replaces any earlier unused one.
        db.prepare('DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL').run(user.id);
        db.prepare(`INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, datetime('now', ?))`)
          .run(sha256(token), user.id, `+${RESET_MINUTES} minutes`);
      })();
      sending = sendResetEmail(req, user, token);
    } else if (!anyPassword) {
      sending = sendGoogleOnlyEmail(user);
    } else {
      continue;
    }
    // Not awaited, so the response time doesn't depend on whether an account matched.
    sending.catch((err) => console.error(`Password reset email for user ${user.id} failed: ${err.message}`));
  }
  res.json({ ok: true });
});

// Sets a new password from an emailed link, signs the account out everywhere else, and signs in here.
// Opening the link proves the account's email, so a Google sign-in with that email can then link to it.
router.post('/reset', rateLimit, async (req, res) => {
  const token = typeof req.body.token === 'string' ? req.body.token : '';
  const reset = db.prepare(`
    SELECT token_hash, user_id FROM password_resets
    WHERE token_hash = ? AND used_at IS NULL AND expires_at > datetime('now')
  `).get(sha256(token));
  if (!reset) throw new HttpError(400, 'This reset link is invalid or has expired. Request a new one from the sign-in page.');
  checkNewPassword(req.body.password);
  const passwordHash = await hashPassword(req.body.password);
  db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ?, email_verified = 1 WHERE id = ?').run(passwordHash, reset.user_id);
    db.prepare("UPDATE password_resets SET used_at = datetime('now') WHERE token_hash = ?").run(reset.token_hash);
    db.prepare('DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL').run(reset.user_id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(reset.user_id);
  })();
  startSession(res, reset.user_id);
  res.json({ user: getUser(reset.user_id) });
});

// ---------- Account settings (signed in) ----------

// Change password: needs the current one. Other devices are signed out; this one stays signed in.
router.post('/password', requireUser, async (req, res) => {
  const user = db.prepare('SELECT id, password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!user.password_hash) throw new HttpError(400, 'This account signs in with Google, so it has no Funklist password');
  const current = typeof req.body.current_password === 'string' ? req.body.current_password.slice(0, MAX_PASSWORD) : '';
  if (!(await verifyPassword(current, user.password_hash))) throw new HttpError(400, 'Your current password is incorrect');
  checkNewPassword(req.body.new_password);
  const passwordHash = await hashPassword(req.body.new_password);
  const currentToken = sha256(parseCookies(req.headers.cookie)[SESSION_COOKIE] || '');
  db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, user.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(user.id, currentToken);
    db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(user.id);
  })();
  res.json({ user: getUser(user.id) });
});

// Account email (used for password resets). Also fills band member profiles that have no email,
// so event notifications reach this person too. A new email isn't proven yet, and reset links sent
// to the old one stop working.
router.put('/account', requireUser, (req, res) => {
  const email = clean(req.body.email);
  if (email && !EMAIL_RE.test(email)) throw new HttpError(400, `"${email}" doesn't look like an email address`);
  const changed = (email || '').toLowerCase() !== (req.user.email || '').toLowerCase();
  db.transaction(() => {
    db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email, req.user.id);
    if (changed) {
      db.prepare('UPDATE users SET email_verified = 0 WHERE id = ?').run(req.user.id);
      db.prepare('DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL').run(req.user.id);
    }
    if (email) db.prepare('UPDATE band_members SET email = ? WHERE user_id = ? AND email IS NULL').run(email, req.user.id);
  })();
  res.json({ user: getUser(req.user.id) });
});

router.post('/logout', (req, res) => {
  endSession(req, res);
  res.status(204).end();
});

module.exports = { router, loadUser, requireUser, google };
