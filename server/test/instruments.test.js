const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, signUp } = require('./helpers');
const { todayIn } = require('../time');

const srv = startServer();
test.after(() => srv.close());

const tomorrow = () => {
  const d = new Date(`${todayIn('America/New_York')}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

// A band whose admin plays Vocals; "Phil" (no account) plays Saxophones and also Trumpets + Tubas.
async function setup(prefix) {
  const boss = await signUp(srv.base, `${prefix}boss`);
  const inst = Object.fromEntries((await boss.get('/api/instruments')).data.map((i) => [i.name, i.id]));
  const band = (await boss.post('/api/bands', { name: `${prefix} Band`, instrument_id: inst.Vocals })).data;
  const phil = (await boss.post(`/api/bands/${band.id}/members`, { name: 'Phil', instrument_id: inst.Saxophones })).data;
  const update = (fields) => boss.put(`/api/members/${phil.id}`, { name: 'Phil', instrument_id: inst.Saxophones, ...fields });
  return { boss, band, phil, inst, update };
}

test('secondary instruments: set, keep, clear, and never include the primary', async () => {
  const { boss, band, phil, inst, update } = await setup('s');
  let r = await update({ secondary_instrument_ids: [inst.Trumpets, inst.Tubas, inst.Saxophones, inst.Trumpets] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.secondary_instrument_ids, [inst.Trumpets, inst.Tubas].sort((a, b) => a - b), 'primary and duplicates dropped');

  r = await update({}); // omitted: keep
  assert.equal(r.data.secondary_instrument_ids.length, 2);

  // Making a secondary the primary removes it from the secondaries.
  r = await boss.put(`/api/members/${phil.id}`, { name: 'Phil', instrument_id: inst.Trumpets });
  assert.deepEqual(r.data.secondary_instrument_ids, [inst.Tubas]);

  assert.equal((await update({ secondary_instrument_ids: 'Tubas' })).status, 400);
  assert.equal((await update({ secondary_instrument_ids: [99999] })).status, 404);
  r = await update({ secondary_instrument_ids: [] });
  assert.deepEqual(r.data.secondary_instrument_ids, []);
  const listed = (await boss.get(`/api/bands/${band.id}/members`)).data.find((m) => m.id === phil.id);
  assert.deepEqual(listed.secondary_instrument_ids, []);
});

test('event cards: (Phil) appears in each other section he plays, mirroring his RSVP', async () => {
  const { boss, band, phil, inst, update } = await setup('c');
  await update({ secondary_instrument_ids: [inst.Trumpets, inst.Tubas] });
  const ev = (await boss.post(`/api/bands/${band.id}/events`, { type: 'gig', title: 'Gig', event_date: tomorrow(), notify: false })).data;
  const entries = async () => (await boss.get(`/api/bands/${band.id}/events`)).data
    .find((e) => e.id === ev.id).attendees.filter((a) => a.id === phil.id);

  let phils = await entries();
  assert.deepEqual(phils.map((a) => [a.instrument, Boolean(a.secondary), a.status]), [
    ['Trumpets', true, null], ['Saxophones', false, null], ['Tubas', true, null],
  ], 'in instrument order (Trumpets, Saxophones, Tubas), no RSVP yet');

  await boss.put(`/api/events/${ev.id}/rsvp`, { member_id: phil.id, status: 'iffy', iffy_reason: 'Maybe' });
  phils = await entries();
  assert.ok(phils.every((a) => a.status === 'iffy' && a.iffy_reason === 'Maybe'), 'secondary entries mirror the RSVP');

  // Playing Trumpets at this event: main under Trumpets, (Phil) under Saxophones and Tubas.
  await boss.put(`/api/events/${ev.id}/rsvp`, { member_id: phil.id, status: 'yes', instrument_id: inst.Trumpets });
  phils = await entries();
  assert.deepEqual(phils.map((a) => [a.instrument, Boolean(a.secondary)]), [
    ['Trumpets', false], ['Saxophones', true], ['Tubas', true],
  ]);
});

test("secondary entries don't count toward quorum or response counts", async () => {
  const { boss, band, phil, inst, update } = await setup('q');
  await update({ secondary_instrument_ids: [inst.Tubas] });
  const ev = (await boss.post(`/api/bands/${band.id}/events`, { type: 'gig', title: 'Q', event_date: tomorrow(), notify: false })).data;
  await boss.put(`/api/events/${ev.id}/rsvp`, { member_id: phil.id, status: 'yes' });
  const listed = (await boss.get(`/api/bands/${band.id}/events`)).data.find((e) => e.id === ev.id);
  assert.ok(listed.quorum.needed.some((n) => n.instrument === 'Tubas'), 'a sax player who also plays tuba is not the tuba');
  assert.equal(listed.no_response_count, 1, 'only the admin is unanswered; secondary copies are not counted');
  const page = (await boss.get(`/api/events/${ev.id}`)).data;
  assert.ok(page.quorum.needed.some((n) => n.instrument === 'Tubas'));
});

test('Event page Going groups include (Phil) for Yes responders, in instrument order', async () => {
  const { boss, band, phil, inst, update } = await setup('g');
  await update({ secondary_instrument_ids: [inst.Tubas, inst.Vocals] });
  const ev = (await boss.post(`/api/bands/${band.id}/events`, { type: 'gig', title: 'G', event_date: tomorrow(), notify: false })).data;
  await boss.put(`/api/events/${ev.id}/rsvp`, { status: 'yes' }); // the admin, Vocals
  const page = (await boss.put(`/api/events/${ev.id}/rsvp`, { member_id: phil.id, status: 'yes' })).data;
  assert.deepEqual(
    page.attendance.going_by_instrument.map((g) => `${g.instrument}: ${g.members.map((m) => (m.secondary ? `(${m.name})` : m.name)).join(', ')}`),
    ['Vocals: gboss, (Phil)', 'Saxophones: Phil', 'Tubas: (Phil)'],
  );
});
