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
const JAZZ = [
  { name: 'Piano', min_count: 1 }, { name: 'Bass', min_count: 1 },
  { name: 'Drums', min_count: 1 }, { name: 'Trumpets', min_count: 0 },
];

test("a new band gets the creator's instruments, order, and minimums", async () => {
  const c = await signUp(srv.base, 'jazzlead');
  const r = await c.post('/api/bands', { name: 'Jazz Trio', instruments: JAZZ, instrument_name: 'piano' });
  assert.equal(r.status, 201);
  const list = (await c.get(`/api/bands/${r.data.id}/instruments`)).data;
  assert.deepEqual(list.map((i) => [i.name, i.min_count]), JAZZ.map((i) => [i.name, i.min_count]));
  const me = (await c.get(`/api/bands/${r.data.id}/members`)).data[0];
  assert.equal(me.instrument, 'Piano', 'creator’s instrument matched case-insensitively');

  const ev = (await c.post(`/api/bands/${r.data.id}/events`, { type: 'gig', title: 'Set', event_date: tomorrow(), notify: false })).data;
  await c.put(`/api/events/${ev.id}/rsvp`, { status: 'yes' });
  const q = (await c.get(`/api/bands/${r.data.id}/events`)).data[0].quorum;
  assert.deepEqual(q.needed.map((n) => `${n.count} ${n.label}`), ['1 bass', '1 drum'], 'piano met; trumpets not required');
});

test('band creation validates the instrument list', async () => {
  const c = await signUp(srv.base, 'validator');
  const bad = async (body) => (await c.post('/api/bands', { name: 'X', ...body })).status;
  assert.equal(await bad({ instruments: [] }), 400);
  assert.equal(await bad({ instruments: [{ name: 'Bass' }, { name: 'bass' }] }), 400, 'duplicate names');
  assert.equal(await bad({ instruments: [{ name: 'Bass', min_count: -1 }] }), 400);
  assert.equal(await bad({ instruments: [{ name: 'Bass', min_count: 1.5 }] }), 400);
  assert.equal(await bad({ instruments: [{ name: '' }] }), 400);
  assert.equal(await bad({ instruments: JAZZ, instrument_name: 'Tuba' }), 400, 'creator’s instrument must be listed');
  const dflt = (await c.post('/api/bands', { name: 'Default Band' })).data;
  const list = (await c.get(`/api/bands/${dflt.id}/instruments`)).data;
  assert.deepEqual(list.map((i) => i.name), ['Vocals', 'Percussion', 'Trumpets', 'Midhorns', 'Saxophones', 'Tubas', 'Dance Team']);
});

test('admins edit the list; members can’t; instruments in use as a main instrument can’t be removed', async () => {
  const boss = await signUp(srv.base, 'editboss');
  const band = (await boss.post('/api/bands', { name: 'Edit Band', instruments: JAZZ, instrument_name: 'Piano' })).data;
  const inst = Object.fromEntries((await boss.get(`/api/bands/${band.id}/instruments`)).data.map((i) => [i.name, i.id]));
  const sub = (await boss.post(`/api/bands/${band.id}/members`, { name: 'Sub', instrument_id: inst.Bass })).data;
  await boss.put(`/api/members/${sub.id}`, { name: 'Sub', instrument_id: inst.Bass, secondary_instrument_ids: [inst.Trumpets] });

  const { invite_code: code } = (await boss.get(`/api/bands/${band.id}`)).data;
  const player = await signUp(srv.base, 'editplayer');
  await player.post(`/api/invites/${code}/join`, {});
  assert.equal((await player.put(`/api/bands/${band.id}/instruments`, { instruments: JAZZ })).status, 403);

  const noBass = JAZZ.filter((i) => i.name !== 'Bass');
  const blocked = await boss.put(`/api/bands/${band.id}/instruments`, { instruments: noBass });
  assert.equal(blocked.status, 409);
  assert.match(blocked.data.error, /Sub plays Bass/);

  // Reorder, change minimums, add a new instrument, drop Trumpets (only someone's "also plays").
  const next = [{ name: 'Bass', min_count: 2 }, { name: 'Piano', min_count: 1 }, { name: 'Drums', min_count: 0 }, { name: 'Vibraphone', min_count: 1 }];
  const saved = await boss.put(`/api/bands/${band.id}/instruments`, { instruments: next });
  assert.deepEqual(saved.data.map((i) => [i.name, i.min_count]), next.map((i) => [i.name, i.min_count]));
  const subNow = (await boss.get(`/api/bands/${band.id}/members`)).data.find((m) => m.id === sub.id);
  assert.deepEqual(subNow.secondary_instrument_ids, [], 'removed instrument dropped from "also plays"');
});

test("members' instruments must be on the band's list", async () => {
  const boss = await signUp(srv.base, 'listboss');
  const band = (await boss.post('/api/bands', { name: 'List Band', instruments: JAZZ })).data;
  const other = (await boss.post('/api/bands', { name: 'Other', instruments: [{ name: 'Accordion', min_count: 0 }] })).data;
  const accordion = (await boss.get(`/api/bands/${other.id}/instruments`)).data[0].id;
  assert.equal((await boss.post(`/api/bands/${band.id}/members`, { name: 'Wrong', instrument_id: accordion })).status, 400);
});

test('a band with no minimums shows no quorum', async () => {
  const c = await signUp(srv.base, 'noquorum');
  const band = (await c.post('/api/bands', { name: 'Loose Band', instruments: [{ name: 'Guitar', min_count: 0 }] })).data;
  const ev = (await c.post(`/api/bands/${band.id}/events`, { type: 'rehearsal', title: 'Jam', event_date: tomorrow(), notify: false })).data;
  assert.equal((await c.get(`/api/bands/${band.id}/events`)).data[0].quorum.applicable, false);
  assert.equal((await c.get(`/api/events/${ev.id}`)).data.quorum.applicable, false);
});

test('existing bands get the default lineup plus instruments their members already play', async () => {
  const c = await signUp(srv.base, 'legacy');
  const band = (await c.post('/api/bands', { name: 'Legacy', instruments: [{ name: 'Banjo', min_count: 0 }], instrument_name: 'Banjo' })).data;
  srv.db.prepare('DELETE FROM band_instruments WHERE band_id = ?').run(band.id); // as before this feature
  require('../db').addDefaultInstruments(band.id);
  const list = (await c.get(`/api/bands/${band.id}/instruments`)).data;
  assert.deepEqual(list.map((i) => i.name).slice(-2), ['Dance Team', 'Banjo']);
  assert.equal(list.find((i) => i.name === 'Trumpets').min_count, 2);
});
