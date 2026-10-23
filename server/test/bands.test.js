const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, signUp } = require('./helpers');

const srv = startServer();
test.after(() => srv.close());

test('creating a band makes you its admin; invite links let others join or claim a profile', async () => {
  const leader = await signUp(srv.base, 'leader');
  const band = (await leader.post('/api/bands', { name: 'Test Brass', timezone: 'America/Chicago' })).data;
  assert.equal((await leader.get(`/api/bands/${band.id}`)).data.timezone, 'America/Chicago');

  const sub = await leader.post(`/api/bands/${band.id}/members`, { name: 'Sub Player' });
  assert.equal(sub.data.has_account, false);

  const { invite_code: code } = (await leader.get(`/api/bands/${band.id}`)).data;
  const joiner = await signUp(srv.base, 'joiner');
  const invite = (await joiner.get(`/api/invites/${code}`)).data;
  assert.deepEqual(invite.unclaimed_members.map((m) => m.name), ['Sub Player']);
  assert.equal((await joiner.post(`/api/invites/${code}/join`, { member_id: sub.data.id })).status, 201);

  const members = (await leader.get(`/api/bands/${band.id}/members`)).data;
  assert.deepEqual(members.map((m) => [m.name, m.has_account, m.is_admin]).sort(), [
    ['Sub Player', true, false],
    ['leader', true, true],
  ]);
  // A claimed profile can't be claimed again.
  const third = await signUp(srv.base, 'third');
  assert.equal((await third.post(`/api/invites/${code}/join`, { member_id: sub.data.id })).status, 409);
});

test("people outside a band can't see or change it", async () => {
  const owner = await signUp(srv.base, 'owner2');
  const band = (await owner.post('/api/bands', { name: 'Private Band' })).data;
  const outsider = await signUp(srv.base, 'outsider');
  assert.equal((await outsider.get(`/api/bands/${band.id}/members`)).status, 404);
  assert.equal((await outsider.get(`/api/bands/${band.id}/events`)).status, 404);
  assert.equal((await outsider.put(`/api/bands/${band.id}`, { timezone: 'UTC' })).status, 404);
});

test('band time zone must be valid', async () => {
  const c = await signUp(srv.base, 'tzuser');
  const band = (await c.post('/api/bands', { name: 'TZ Band' })).data;
  assert.equal((await c.put(`/api/bands/${band.id}`, { timezone: 'Mars/Olympus_Mons' })).status, 400);
  assert.equal((await c.put(`/api/bands/${band.id}`, { timezone: 'Europe/Berlin' })).data.timezone, 'Europe/Berlin');
});
