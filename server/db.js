const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { DEFAULT_TIMEZONE } = require('./time');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'funklist.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

const newInviteCode = () => crypto.randomBytes(9).toString('base64url');

// Migrations for databases created before a column existed (CREATE TABLE IF NOT EXISTS won't add it).
const hasColumn = (table, column) =>
  db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
if (!hasColumn('event_attendance', 'instrument_id')) {
  db.exec('ALTER TABLE event_attendance ADD COLUMN instrument_id INTEGER REFERENCES instruments(id) ON DELETE SET NULL');
}
if (!hasColumn('event_attendance', 'iffy_reason')) {
  db.exec('ALTER TABLE event_attendance ADD COLUMN iffy_reason TEXT');
}
if (!hasColumn('band_members', 'user_id')) {
  db.exec('ALTER TABLE band_members ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE SET NULL');
}
if (!hasColumn('bands', 'invite_code')) {
  db.exec('ALTER TABLE bands ADD COLUMN invite_code TEXT');
}
if (!hasColumn('users', 'calendar_token')) {
  db.exec('ALTER TABLE users ADD COLUMN calendar_token TEXT');
}
if (!hasColumn('bands', 'timezone')) {
  db.exec('ALTER TABLE bands ADD COLUMN timezone TEXT');
}
// Bands created before time zones existed get the server default (DEFAULT_TIMEZONE).
db.prepare('UPDATE bands SET timezone = ? WHERE timezone IS NULL').run(DEFAULT_TIMEZONE);
if (!hasColumn('events', 'status')) {
  db.exec(`
    ALTER TABLE events ADD COLUMN status TEXT NOT NULL DEFAULT 'unconfirmed'
      CHECK (status IN ('unconfirmed', 'confirmed', 'cancelled'));
    ALTER TABLE events ADD COLUMN status_updated_at TEXT;
    ALTER TABLE events ADD COLUMN status_updated_by INTEGER REFERENCES band_members(id) ON DELETE SET NULL;
  `);
}
// Indexes on migrated columns live here so they run after the columns exist.
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_members_band_user ON band_members(band_id, user_id) WHERE user_id IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_bands_invite ON bands(invite_code);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_calendar_token ON users(calendar_token);
`);
const setInvite = db.prepare('UPDATE bands SET invite_code = ? WHERE id = ?');
for (const { id } of db.prepare('SELECT id FROM bands WHERE invite_code IS NULL').all()) {
  setInvite.run(newInviteCode(), id);
}
db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
// Member profiles linked to an account with an email (e.g. Google sign-in) use it for notifications
// unless the profile already has its own.
db.prepare(`
  UPDATE band_members SET email = (SELECT u.email FROM users u WHERE u.id = band_members.user_id)
  WHERE email IS NULL AND user_id IS NOT NULL
`).run();

const DEFAULT_INSTRUMENTS = [
  'Vocals', 'Percussion', 'Trumpets', 'Midhorns', 'Saxophones', 'Tubas', 'Dance Team'
];
const insertInstrument = db.prepare(
  'INSERT OR IGNORE INTO instruments (name, sort_order) VALUES (?, ?)'
);
DEFAULT_INSTRUMENTS.forEach((name, i) => insertInstrument.run(name, i));

module.exports = db;
module.exports.newInviteCode = newInviteCode;
