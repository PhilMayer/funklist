const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, signUp } = require('./helpers');
const { todayIn } = require('../time');

const srv = startServer();
test.after(() => srv.close());

// A band with an admin ("boss"), a regular member ("player", with an email), and a sub with no account.
async function setup(prefix) {
  const boss = await signUp(srv.base, `${prefix}boss`, { email: `${prefix}boss@example.com` });
  const band = (await boss.post('/api/bands', { name: `${prefix} Band`, timezone: 'America/New_York' })).data;
  const sub = (await boss.post(`/api/bands/${band.id}/members`, { name: 'Sub', email: 'sub@example.com' })).data;
  const { invite_code: code } = (await boss.get(`/api/bands/${band.id}`)).data;
  const player = await signUp(srv.base, `${prefix}player`, { email: `${prefix}player@example.com` });
  await player.post(`/api/invites/${code}/join`, {});
  const members = (await boss.get(`/api/bands/${band.id}/members`)).data;
  const id = (name) => members.find((m) => m.name === name).id;
  return { boss, player, band, subId: sub.id, playerId: id(`${prefix}player`), bossId: id(`${prefix}boss`) };
}

const tomorrow = () => {
  const d = new Date(`${todayIn('America/New_York')}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

test('new events email the rest of the band, not the creator', async () => {
  const { boss, band } = await setup('n');
  srv.sentMail.length = 0;
  const ev = await boss.post(`/api/bands/${band.id}/events`, { type: 'gig', title: 'Opening Night', event_date: tomorrow() });
  assert.equal(ev.status, 201);
  assert.equal(ev.data.notified, 2);
  await new Promise((r) => setTimeout(r, 50)); // emails send in the background
  assert.deepEqual(srv.sentMail.map((m) => m.to).sort(), ['nplayer@example.com', 'sub@example.com']);
  assert.match(srv.sentMail[0].text, /https:\/\/funklist\.test\/\?event=\d+/);
});

test('RSVPs: own answer, Iffy reasons, and cancelled events', async () => {
  const { player, band } = await setup('r');
  const ev = (await player.post(`/api/bands/${band.id}/events`, { type: 'rehearsal', title: 'Run', event_date: tomorrow(), notify: false })).data;
  const me = player.user && (await player.get(`/api/bands/${band.id}/members`)).data.find((m) => m.is_me).id;

  let r = await player.put(`/api/events/${ev.id}/rsvp`, { status: 'iffy', iffy_reason: '  Might work late ' });
  assert.deepEqual(r.data.attendance.responses[me], { status: 'iffy', instrument_id: null, iffy_reason: 'Might work late' });
  r = await player.put(`/api/events/${ev.id}/rsvp`, { status: 'yes' });
  assert.equal(r.data.attendance.responses[me].iffy_reason, null, 'answering Yes clears the reason');
  assert.equal((await player.put(`/api/events/${ev.id}/rsvp`, { status: 'maybe' })).status, 400);
  assert.equal((await player.put(`/api/events/${ev.id}/rsvp`, { status: 'iffy', iffy_reason: 'x'.repeat(201) })).status, 400);

  await player.put(`/api/events/${ev.id}/status`, { status: 'cancelled' });
  assert.equal((await player.put(`/api/events/${ev.id}/rsvp`, { status: 'yes' })).status, 409);
  const upcoming = (await player.get(`/api/bands/${band.id}/events`)).data;
  assert.ok(!upcoming.some((e) => e.id === ev.id), 'cancelled events are left off the list');
  const overview = (await player.get(`/api/bands/${band.id}/events/overview`)).data;
  assert.equal(overview.events.find((e) => e.id === ev.id).status, 'cancelled', '...but shown in the overview');
});

test('status changes email the band once per change', async () => {
  const { boss, band } = await setup('s');
  const ev = (await boss.post(`/api/bands/${band.id}/events`, { type: 'gig', title: 'Gala', event_date: tomorrow(), notify: false })).data;
  srv.sentMail.length = 0;
  assert.equal((await boss.put(`/api/events/${ev.id}/status`, { status: 'confirmed' })).data.notified, 2);
  assert.equal((await boss.put(`/api/events/${ev.id}/status`, { status: 'confirmed' })).data.unchanged, true);
  assert.equal((await boss.put(`/api/events/${ev.id}/status`, { status: 'unconfirmed' })).status, 400);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(srv.sentMail.length, 2);
  assert.ok(srv.sentMail.every((m) => m.subject.startsWith('Confirmed: Gala')));
});

test('admins can RSVP for others and manage admins; members cannot', async () => {
  const { boss, player, band, subId, playerId, bossId } = await setup('a');
  const ev = (await boss.post(`/api/bands/${band.id}/events`, { type: 'gig', title: 'Show', event_date: tomorrow(), notify: false })).data;

  const forSub = await boss.put(`/api/events/${ev.id}/rsvp`, { member_id: subId, status: 'iffy', iffy_reason: 'Texted me' });
  assert.equal(forSub.data.attendance.responses[subId].status, 'iffy');
  assert.equal(forSub.data.attendance.responses[bossId], undefined, "admin's own RSVP untouched");
  assert.equal((await player.put(`/api/events/${ev.id}/rsvp`, { member_id: subId, status: 'no' })).status, 403);

  assert.equal((await player.put(`/api/members/${playerId}/admin`, { is_admin: true })).status, 403);
  assert.equal((await boss.put(`/api/members/${subId}/admin`, { is_admin: true })).status, 400, 'needs an account');
  assert.equal((await boss.put(`/api/members/${bossId}/admin`, { is_admin: false })).status, 409, 'last admin');
  assert.equal((await boss.put(`/api/members/${playerId}/admin`, { is_admin: true })).data.is_admin, true);
  assert.equal((await player.put(`/api/events/${ev.id}/rsvp`, { member_id: subId, status: 'yes' })).status, 200);
});

test('Upcoming vs Past follows the band time zone', async () => {
  const { boss, band } = await setup('t');
  const today = todayIn('America/New_York');
  const ev = (await boss.post(`/api/bands/${band.id}/events`, { type: 'gig', title: 'Tonight', event_date: today, notify: false })).data;
  const upcoming = async () => (await boss.get(`/api/bands/${band.id}/events`)).data.some((e) => e.id === ev.id);
  assert.equal(await upcoming(), true, "today's event is upcoming in the band's zone");
  // A zone where it's already tomorrow somewhere else in the world moves it to Past if that date is later.
  await boss.put(`/api/bands/${band.id}`, { timezone: 'Pacific/Kiritimati' }); // UTC+14
  const kiritimatiToday = todayIn('Pacific/Kiritimati');
  assert.equal(await upcoming(), kiritimatiToday <= today);
});

test('calendar feed: secret link, valid output, reset kills the old link', async () => {
  const { boss, band } = await setup('c');
  await boss.post(`/api/bands/${band.id}/events`, { type: 'gig', title: 'Feed Gig', event_date: tomorrow(), notify: false });
  const links = (await boss.get('/api/me/calendar')).data;
  assert.deepEqual(Object.keys(links).sort(), ['url', 'webcal_url']);
  const path = new URL(links.url).pathname;
  const feed = await fetch(srv.base + path);
  assert.equal(feed.status, 200);
  assert.match(feed.headers.get('content-type'), /text\/calendar/);
  assert.match(await feed.text(), /SUMMARY:Feed Gig/);
  await boss.post('/api/me/calendar/reset');
  assert.equal((await fetch(srv.base + path)).status, 404);
});
