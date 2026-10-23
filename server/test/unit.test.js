const test = require('node:test');
const assert = require('node:assert/strict');
process.env.NODE_ENV = 'test';
const { zonedTimeToUtc, todayIn, formatTime12 } = require('../time');
const { quorumFor } = require('../quorum');
const { buildCalendar, eventTimes } = require('../calendar');

test('zonedTimeToUtc handles offsets and daylight saving', () => {
  const cases = [
    ['2026-10-08', '19:00', 'America/New_York', '2026-10-08T23:00:00.000Z'], // EDT
    ['2026-12-10', '21:00', 'America/New_York', '2026-12-11T02:00:00.000Z'], // EST, next UTC day
    ['2026-10-08', '19:00', 'Asia/Kolkata', '2026-10-08T13:30:00.000Z'], // half-hour offset
    ['2026-03-08', '03:30', 'America/New_York', '2026-03-08T07:30:00.000Z'], // after spring-forward
    ['2026-11-01', '03:00', 'America/New_York', '2026-11-01T08:00:00.000Z'], // after fall-back
  ];
  for (const [d, t, tz, want] of cases) assert.equal(zonedTimeToUtc(d, t, tz).toISOString(), want, `${d} ${t} ${tz}`);
});

test('todayIn uses the band time zone, not the server clock', () => {
  const lateEvening = new Date('2026-09-29T02:30:00Z'); // 10:30 PM on the 28th in New York
  assert.equal(todayIn('America/New_York', lateEvening), '2026-09-28');
  assert.equal(todayIn('UTC', lateEvening), '2026-09-29');
});

test('formatTime12', () => {
  assert.equal(formatTime12('00:05'), '12:05 AM');
  assert.equal(formatTime12('19:30'), '7:30 PM');
  assert.equal(formatTime12(null), null);
});

test('quorum counts only Yes, per instrument', () => {
  const y = (instrument, n, status = 'yes') => Array.from({ length: n }, () => ({ instrument, status }));
  const full = [...y('Vocals', 1), ...y('Percussion', 2), ...y('Trumpets', 2), ...y('Midhorns', 2), ...y('Saxophones', 2), ...y('Tubas', 1)];
  assert.equal(quorumFor(full).met, true);
  const noTuba = quorumFor([...full.slice(0, -1), ...y('Trumpets', 5)]);
  assert.equal(noTuba.met, false);
  assert.deepEqual(noTuba.needed.map((n) => `${n.count} ${n.label}`), ['1 tuba']);
  assert.equal(quorumFor([...full.slice(1), ...y('Vocals', 1, 'iffy')]).total_needed, 1);
});

test('calendar times: call to 2h after hit, all-day without times, after-midnight hit', () => {
  assert.deepEqual(eventTimes({ event_date: '2026-10-08', call_time: '19:00', hit_time: '21:00' }, 'America/New_York'),
    { all_day: false, start: '20261008T230000Z', end: '20261009T030000Z' });
  assert.deepEqual(eventTimes({ event_date: '2026-10-15' }, 'America/New_York'),
    { all_day: true, start: '20261015', end: '20261016' });
  const late = eventTimes({ event_date: '2026-12-31', call_time: '23:00', hit_time: '00:30' }, 'America/New_York');
  assert.equal(late.end, '20270101T073000Z');
});

test('calendar output escapes text and folds long lines', () => {
  const ics = buildCalendar({
    name: 'Funklist',
    appUrl: 'https://funklist.test',
    events: [{
      id: 1, type: 'gig', title: 'Café; Olé, 🎺', event_date: '2026-10-08', status: 'confirmed', timezone: 'UTC',
      venue: 'Main St; Back door', description: 'Très important. '.repeat(20), call_time: '19:00',
    }],
  });
  const lines = ics.split('\r\n');
  assert.ok(lines.every((l) => Buffer.byteLength(l) <= 75), 'every line is at most 75 bytes');
  assert.ok(!ics.replace(/\r\n/g, '').includes('\n'), 'CRLF line endings only');
  assert.ok(ics.includes(String.raw`SUMMARY:Café\; Olé\, 🎺`), 'semicolons and commas are escaped');
  assert.ok(ics.includes('STATUS:CONFIRMED'));
});
