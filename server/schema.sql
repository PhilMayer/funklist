PRAGMA foreign_keys = ON;

-- Login accounts. A user signs in with a username/password, Google, or both.
CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  username       TEXT UNIQUE COLLATE NOCASE,  -- NULL for Google-only accounts
  password_hash  TEXT,                        -- scrypt; NULL for Google-only accounts
  google_sub     TEXT UNIQUE,                 -- Google's stable account id
  email          TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0,  -- 1 once the email is proven (from Google, or a used reset link)
  display_name   TEXT NOT NULL,
  calendar_token TEXT,                        -- secret in the calendar feed URL; unique index in db.js
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (username IS NOT NULL OR google_sub IS NOT NULL)
);

-- Login sessions. Only a SHA-256 of the cookie token is stored.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- Password reset links. Only a SHA-256 of the emailed token is stored; single use, short-lived.
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bands (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  invite_code  TEXT,                         -- shared in the join link; unique index in db.js
  timezone     TEXT,                         -- IANA name, e.g. America/New_York; see time.js
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS instruments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  sort_order  INTEGER NOT NULL DEFAULT 100
);

-- Each band's own instrument list, in display order, with the minimum number of Yes RSVPs per
-- instrument for an event to have quorum (0 = not required).
CREATE TABLE IF NOT EXISTS band_instruments (
  band_id        INTEGER NOT NULL REFERENCES bands(id) ON DELETE CASCADE,
  instrument_id  INTEGER NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  min_count      INTEGER NOT NULL DEFAULT 0 CHECK (min_count >= 0),
  PRIMARY KEY (band_id, instrument_id)
);

CREATE TABLE IF NOT EXISTS band_members (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  band_id        INTEGER NOT NULL REFERENCES bands(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  email          TEXT,
  instrument_id  INTEGER REFERENCES instruments(id) ON DELETE SET NULL,
  -- The account this member signs in with; NULL until someone claims the profile.
  user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  -- Admins can RSVP for other members and make others admins. The band's creator starts as admin.
  is_admin       INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_members_band ON band_members(band_id);

-- Other instruments a member also plays ("also plays"). Never includes their primary instrument.
-- Shown as (Name) in those sections on events; doesn't count toward quorum.
CREATE TABLE IF NOT EXISTS member_instruments (
  member_id      INTEGER NOT NULL REFERENCES band_members(id) ON DELETE CASCADE,
  instrument_id  INTEGER NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  PRIMARY KEY (member_id, instrument_id)
);

CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  band_id     INTEGER NOT NULL REFERENCES bands(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('rehearsal', 'gig')),
  title       TEXT NOT NULL,
  event_date  TEXT NOT NULL,              -- YYYY-MM-DD
  created_by  INTEGER REFERENCES band_members(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  -- Unconfirmed until a member confirms or cancels it. Cancelled events are hidden from the list.
  status             TEXT NOT NULL DEFAULT 'unconfirmed' CHECK (status IN ('unconfirmed', 'confirmed', 'cancelled')),
  status_updated_at  TEXT,
  status_updated_by  INTEGER REFERENCES band_members(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_events_band_date ON events(band_id, event_date);

-- One-to-one with events: the longer, optional fields.
CREATE TABLE IF NOT EXISTS event_details (
  event_id     INTEGER PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  venue        TEXT,
  call_time    TEXT,                      -- HH:MM
  hit_time     TEXT,                      -- HH:MM
  set_list     TEXT,                      -- one song per line
  description  TEXT
);

-- Up to two captains per gig (limit enforced in the API); rehearsals have none. Kept in the order chosen (rowid).
CREATE TABLE IF NOT EXISTS event_captains (
  event_id   INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  member_id  INTEGER NOT NULL REFERENCES band_members(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, member_id)
);

CREATE TABLE IF NOT EXISTS event_attendance (
  event_id    INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  member_id   INTEGER NOT NULL REFERENCES band_members(id) ON DELETE CASCADE,
  status      TEXT NOT NULL CHECK (status IN ('yes', 'no', 'iffy')),
  -- Instrument for this event only; NULL means the member's primary instrument.
  instrument_id  INTEGER REFERENCES instruments(id) ON DELETE SET NULL,
  -- Optional reason given with an Iffy RSVP; cleared when the answer changes to yes/no.
  iffy_reason    TEXT,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (event_id, member_id)
);
