// Populates a demo band with members and a couple of events, plus a demo login linked to the
// first member. Safe to re-run: each part is skipped if it already exists.
const crypto = require('crypto');
const db = require('./db');
const { newInviteCode } = require('./db');

const BAND = 'The Funklist';
// Local development only. Override with DEMO_PASSWORD=... npm run seed
const DEMO_USERNAME = 'demo';
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'funklist-demo';

function seedDemoUser() {
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(DEMO_USERNAME)) return;
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(DEMO_PASSWORD, salt, 64);
  const userId = db.prepare('INSERT INTO users (username, password_hash, display_name) VALUES (?, ?, ?)')
    .run(DEMO_USERNAME, `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`, 'Demo User').lastInsertRowid;
  // Link to the demo band's first unclaimed member so the account lands in a populated band.
  const member = db.prepare(`
    SELECT m.id, m.name FROM band_members m JOIN bands b ON b.id = m.band_id
    WHERE b.name = ? AND m.user_id IS NULL ORDER BY m.id LIMIT 1
  `).get(BAND);
  if (member) db.prepare('UPDATE band_members SET user_id = ? WHERE id = ?').run(userId, member.id);
  console.log(`Created login "${DEMO_USERNAME}"${member ? ` (plays as ${member.name})` : ''}. Password is in seed.js.`);
}

if (db.prepare('SELECT id FROM bands WHERE name = ?').get(BAND)) {
  console.log(`"${BAND}" already exists — skipping band.`);
  seedDemoUser();
  process.exit(0);
}

// Creates the instrument if it isn't in the default list (see db.js), so the seed can't break.
const instrumentId = (name) => {
  db.prepare('INSERT OR IGNORE INTO instruments (name) VALUES (?)').run(name);
  return db.prepare('SELECT id FROM instruments WHERE name = ?').get(name).id;
};
const isoDate = (daysFromNow) => {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toLocaleDateString('en-CA'); // YYYY-MM-DD in local time
};

db.transaction(() => {
  const bandId = db.prepare('INSERT INTO bands (name, invite_code, timezone) VALUES (?, ?, ?)')
    .run(BAND, newInviteCode(), Intl.DateTimeFormat().resolvedOptions().timeZone).lastInsertRowid;

  const members = [
    ['Aretha', 'Vocals'], ['Bootsy', 'Tubas'], ['Clyde', 'Percussion'], ['Maceo', 'Saxophones'],
    ['Fred', 'Midhorns'], ['Nile', 'Trumpets'], ['Bernie', 'Trumpets'], ['Sheila', 'Percussion'],
  ].map(([name, inst]) =>
    db.prepare('INSERT INTO band_members (band_id, name, instrument_id) VALUES (?, ?, ?)')
      .run(bandId, name, instrumentId(inst)).lastInsertRowid
  );

  const addEvent = (type, title, days, details) => {
    const id = db.prepare('INSERT INTO events (band_id, type, title, event_date, created_by) VALUES (?, ?, ?, ?, ?)')
      .run(bandId, type, title, isoDate(days), members[0]).lastInsertRowid;
    db.prepare(`INSERT INTO event_details (event_id, venue, call_time, hit_time, set_list, description)
                VALUES (@id, @venue, @call, @hit, @setList, @description)`).run({ id, ...details });
    return id;
  };

  const rehearsal = addEvent('rehearsal', 'Weekly Rehearsal', 3, {
    venue: 'Studio B', call: '18:30', hit: '19:00',
    setList: 'Cold Sweat\nChameleon\nPick Up the Pieces', description: 'Run the new horn arrangements.',
  });
  const gig = addEvent('gig', 'Friday Night at The Blue Room', 10, {
    venue: 'The Blue Room, 123 Main St', call: '19:00', hit: '21:00',
    setList: 'Intro Vamp\nCold Sweat\nChameleon\nPick Up the Pieces\nSuperstition\nGive Up the Funk',
    description: 'Two 45-minute sets. Black attire.',
  });

  const rsvp = db.prepare('INSERT INTO event_attendance (event_id, member_id, status) VALUES (?, ?, ?)');
  ['yes', 'yes', 'yes', 'iffy', 'yes', 'no', 'yes'].forEach((s, i) => rsvp.run(rehearsal, members[i], s));
  ['yes', 'yes', 'yes', 'yes', 'yes', 'yes', 'iffy', 'yes'].forEach((s, i) => rsvp.run(gig, members[i], s));
})();

console.log(`Seeded "${BAND}".`);
seedDemoUser();
