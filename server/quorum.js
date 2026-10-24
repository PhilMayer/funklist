// Quorum: each band sets a minimum number of "Yes" RSVPs per instrument (band_instruments.min_count).
// Iffy doesn't count, and players count once, toward the instrument they're playing at that event.

// "Trumpets" -> { one: 'trumpet', many: 'trumpets' }; names not ending in a single "s" stay as they are.
function labels(name) {
  const many = name.toLowerCase();
  return { one: /[^s]s$/.test(many) ? many.slice(0, -1) : many, many };
}

// attendees: [{ instrument_id, status }] for one event (main entries only).
// requirements: [{ instrument_id, name, min_count }] for the band.
function quorumFor(attendees, requirements) {
  const required = requirements.filter((r) => r.min_count > 0);
  if (required.length === 0) return { applicable: false, met: true, total_needed: 0, needed: [] };
  const yes = new Map();
  for (const { instrument_id: id, status } of attendees) {
    if (status === 'yes' && id) yes.set(id, (yes.get(id) || 0) + 1);
  }
  const needed = [];
  for (const r of required) {
    const count = r.min_count - (yes.get(r.instrument_id) || 0);
    if (count > 0) {
      const { one, many } = labels(r.name);
      needed.push({ instrument: r.name, count, label: count === 1 ? one : many });
    }
  }
  return {
    applicable: true,
    met: needed.length === 0,
    total_needed: needed.reduce((sum, n) => sum + n.count, 0),
    needed,
  };
}

module.exports = { quorumFor, labels };
