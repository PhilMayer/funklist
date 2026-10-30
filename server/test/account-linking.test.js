const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, signUp, password } = require('./helpers');

const srv = startServer();
test.after(() => srv.close());

// Stands in for Google: the "credential" is the token's claims as JSON.
require('../auth').google.verify = async (credential) => JSON.parse(credential);
const googleLogin = (c, sub, email, extra = {}) =>
  c.post('/api/auth/google', { credential: JSON.stringify({ sub, email, email_verified: true, name: 'G', ...extra }) });

const settle = () => new Promise((r) => setTimeout(r, 50)); // reset emails send in the background
const userCount = () => srv.db.prepare('SELECT COUNT(*) AS n FROM users').get().n;

// Proves the account's email the way a person would: by using an emailed reset link.
// Returns the client that used it, the only one still signed in.
async function confirmEmail(email) {
  await client(srv.base).post('/api/auth/forgot', { identifier: email });
  await settle();
  const mail = srv.sentMail.filter((m) => m.to === email).at(-1);
  const token = mail.text.match(/\?reset=([A-Za-z0-9_-]+)/)[1];
  const browser = client(srv.base);
  assert.equal((await browser.post('/api/auth/reset', { token, password: password() })).status, 200);
  return browser;
}

test('new Google accounts are created with their verified email', async () => {
  const before = userCount();
  const res = await googleLogin(client(srv.base), 'g-new', 'fresh@example.com');
  assert.equal(res.status, 201);
  assert.equal(res.data.user.email, 'fresh@example.com');
  assert.equal(userCount(), before + 1);
  assert.equal((await googleLogin(client(srv.base), 'g-new', 'fresh@example.com')).status, 200, 'same account next time');
  assert.equal(userCount(), before + 1);
});

test('Google sign-in with an unconfirmed matching email asks to confirm it, without making a second account', async () => {
  const owner = await signUp(srv.base, 'unconfirmed', { email: 'unconfirmed@example.com' });
  const before = userCount();
  const res = await googleLogin(client(srv.base), 'g-unconfirmed', 'Unconfirmed@Example.com');
  assert.equal(res.status, 409);
  assert.match(res.data.error, /Forgot password/);
  assert.equal(userCount(), before);

  await confirmEmail('unconfirmed@example.com');
  const linked = await googleLogin(client(srv.base), 'g-unconfirmed', 'unconfirmed@example.com');
  assert.equal(linked.status, 200);
  assert.equal(linked.data.user.id, owner.user.id, 'signed in to the existing account');
  assert.equal(linked.data.user.has_google, true);
  assert.equal(linked.data.user.has_password, true);
  assert.equal(userCount(), before);
});

test('a Google sign-in links to the confirmed account and sees its bands', async () => {
  const owner = await signUp(srv.base, 'bandowner', { email: 'owner@example.com' });
  const band = (await owner.post('/api/bands', { name: 'Linked Band' })).data;
  await confirmEmail('owner@example.com');

  const viaGoogle = client(srv.base);
  const res = await googleLogin(viaGoogle, 'g-owner', 'owner@example.com');
  assert.equal(res.status, 200);
  assert.equal(res.data.user.username, 'bandowner');
  assert.ok((await viaGoogle.get('/api/bands')).data.some((b) => b.id === band.id));
});

test('an earlier empty Google duplicate is folded into the confirmed account', async () => {
  const owner = await signUp(srv.base, 'dupowner', { email: 'dup@example.com' });
  // A duplicate from before Google sign-ins were linked by email.
  srv.db.prepare("INSERT INTO users (google_sub, email, email_verified, display_name) VALUES ('g-dup', 'dup@example.com', 1, 'Dup')").run();
  const dupId = srv.db.prepare("SELECT id FROM users WHERE google_sub = 'g-dup'").get().id;

  srv.sentMail.length = 0;
  await confirmEmail('dup@example.com');
  assert.equal(srv.sentMail.length, 1, 'only the reset link, not also the "signs in with Google" email');

  const res = await googleLogin(client(srv.base), 'g-dup', 'dup@example.com');
  assert.equal(res.status, 200);
  assert.equal(res.data.user.id, owner.user.id);
  assert.equal(srv.db.prepare('SELECT 1 FROM users WHERE id = ?').get(dupId), undefined, 'duplicate removed');
});

test('a Google account that is already in a band is never folded into another', async () => {
  const g = client(srv.base);
  const first = await googleLogin(g, 'g-apart', 'apart@example.com');
  await g.post('/api/bands', { name: 'Google Band' });
  // A duplicate with the same email (sign-up refuses it now, but older ones exist).
  const other = await signUp(srv.base, 'keepapart');
  await other.put('/api/auth/account', { email: 'apart@example.com' });
  await confirmEmail('apart@example.com');
  const again = await googleLogin(client(srv.base), 'g-apart', 'apart@example.com');
  assert.equal(again.data.user.id, first.data.user.id);
  assert.equal(again.data.user.username, null);
});

test('signing up with an email that already has an account is refused', async () => {
  await googleLogin(client(srv.base), 'g-taken', 'taken@example.com');
  const res = await client(srv.base).post('/api/auth/register', { username: 'second', password: password(), email: 'TAKEN@example.com' });
  assert.equal(res.status, 409);
});

test('changing the account email unconfirms it and cancels reset links sent to the old one', async () => {
  await signUp(srv.base, 'mover', { email: 'old@example.com' });
  const me = await confirmEmail('old@example.com');
  await client(srv.base).post('/api/auth/forgot', { identifier: 'old@example.com' });
  await settle();
  const token = srv.sentMail.filter((m) => m.to === 'old@example.com').at(-1).text.match(/\?reset=([A-Za-z0-9_-]+)/)[1];

  await me.put('/api/auth/account', { email: 'new@example.com' });
  assert.equal((await client(srv.base).post('/api/auth/reset', { token, password: password() })).status, 400);
  assert.equal((await googleLogin(client(srv.base), 'g-mover', 'new@example.com')).status, 409, 'new email not confirmed yet');
});
