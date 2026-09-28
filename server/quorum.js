// Minimum number of "Yes" RSVPs per instrument for an event to have quorum.
// Instruments are matched by name (see DEFAULT_INSTRUMENTS in db.js); iffy doesn't count.
// Players count toward the instrument they're playing at that event.
const QUORUM = [
  { instrument: 'Vocals', min: 1, one: 'vocal', many: 'vocals' },
  { instrument: 'Percussion', min: 2, one: 'percussion', many: 'percussion' },
  { instrument: 'Trumpets', min: 2, one: 'trumpet', many: 'trumpets' },
  { instrument: 'Midhorns', min: 2, one: 'midhorn', many: 'midhorns' },
  { instrument: 'Saxophones', min: 2, one: 'saxophone', many: 'saxophones' },
  { instrument: 'Tubas', min: 1, one: 'tuba', many: 'tubas' },
];

// attendees: [{ instrument, status }] for one event.
function quorumFor(attendees) {
  const yesByInstrument = new Map();
  for (const { instrument, status } of attendees) {
    if (status !== 'yes' || !instrument) continue;
    const key = instrument.toLowerCase();
    yesByInstrument.set(key, (yesByInstrument.get(key) || 0) + 1);
  }
  const needed = [];
  for (const q of QUORUM) {
    const count = q.min - (yesByInstrument.get(q.instrument.toLowerCase()) || 0);
    if (count > 0) needed.push({ instrument: q.instrument, count, label: count === 1 ? q.one : q.many });
  }
  return {
    met: needed.length === 0,
    total_needed: needed.reduce((sum, n) => sum + n.count, 0),
    needed,
  };
}

module.exports = { QUORUM, quorumFor };
