const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, signUp, password } = require('./helpers');

const srv = startServer();
test.after(() => srv.close());

const settle = () => new Promise((r) => setTimeout(r, 50)); // reset emails send in the background
const linkTokenFor = (email) => {
  const mail = srv.sentMail.filter((m) => m.to === email).at(-1);
  return mail && (mail.text.match(/\?reset=([A-Za-z0-9_-]+)/) || [])[1];
};

test('forgot password: same answer for unknown accounts; link emailed for real ones', async () => {
  srv.sentMail.length = 0;
  const anon = client(srv.base);
  const unknown = await anon.post('/api/auth/forgot', { identifier: 'nobody-at-all' });
  await signUp(srv.base, 'resetme', { email: 'resetme@example.com' });
  const known = await anon.post('/api/auth/forgot', { identifier: 'resetme' });
  assert.equal(unknown.status, 200);
  assert.deepEqual(known.data, unknown.data, "responses don't reveal whether the account exists");
  await settle();
  assert.equal(srv.sentMail.length, 1);
  assert.equal(srv.sentMail[0].to, 'resetme@example.com');
  assert.match(srv.sentMail[0].text, /https:\/\/funklist\.test\/\?reset=/);
});

test('reset link: sets the password, works once, signs out other sessions', async () => {
  const pw = password();
  const other = client(srv.base);
  await other.post('/api/auth/register', { username: 'onceuser', password: pw, email: 'once@example.com' });
  assert.equal((await other.get('/api/bands')).status, 200, 'signed in elsewhere');

  await client(srv.base).post('/api/auth/forgot', { identifier: 'ONCE@example.com' }); // email, any case
  await settle();
  const token = linkTokenFor('once@example.com');
  assert.ok(token);

  const browser = client(srv.base);
  assert.equal((await browser.post('/api/auth/reset', { token, password: 'short' })).status, 400);
  const newPw = password();
  const reset = await browser.post('/api/auth/reset', { token, password: newPw });
  assert.equal(reset.status, 200);
  assert.equal(reset.data.user.username, 'onceuser');
  assert.equal((await browser.get('/api/bands')).status, 200, 'signed in after resetting');
  assert.equal((await other.get('/api/bands')).status, 401, 'other sessions were signed out');
  assert.equal((await browser.post('/api/auth/reset', { token, password: password() })).status, 400, 'single use');

  const login = (p) => client(srv.base).post('/api/auth/login', { username: 'onceuser', password: p });
  assert.equal((await login(pw)).status, 401, 'old password no longer works');
  assert.equal((await login(newPw)).status, 200);
});

test('reset links expire, and a newer link replaces an older one', async () => {
  await signUp(srv.base, 'expiry', { email: 'expiry@example.com' });
  const anon = client(srv.base);
  await anon.post('/api/auth/forgot', { identifier: 'expiry' });
  await settle();
  const first = linkTokenFor('expiry@example.com');
  await anon.post('/api/auth/forgot', { identifier: 'expiry' });
  await settle();
  const second = linkTokenFor('expiry@example.com');
  assert.notEqual(first, second);
  assert.equal((await anon.post('/api/auth/reset', { token: first, password: password() })).status, 400, 'older link replaced');

  srv.db.prepare("UPDATE password_resets SET expires_at = datetime('now', '-1 minute')").run();
  assert.equal((await anon.post('/api/auth/reset', { token: second, password: password() })).status, 400, 'expired');
  assert.equal((await anon.post('/api/auth/reset', { token: 'made-up-token', password: password() })).status, 400);
});

test('accounts without an email get nothing; Google-only accounts get a pointer to Google', async () => {
  srv.sentMail.length = 0;
  await signUp(srv.base, 'noemail');
  await client(srv.base).post('/api/auth/forgot', { identifier: 'noemail' });
  srv.db.prepare("INSERT INTO users (google_sub, email, display_name) VALUES ('g-123', 'google@example.com', 'G User')").run();
  await client(srv.base).post('/api/auth/forgot', { identifier: 'google@example.com' });
  await settle();
  assert.deepEqual(srv.sentMail.map((m) => [m.to, /reset=/.test(m.text), /Google/.test(m.text)]), [
    ['google@example.com', false, true],
  ]);
});

test('signed in: change password (needs the current one) and set the account email', async () => {
  const pw = password();
  const me = client(srv.base);
  await me.post('/api/auth/register', { username: 'settings', password: pw });
  const elsewhere = client(srv.base);
  await elsewhere.post('/api/auth/login', { username: 'settings', password: pw });

  assert.equal((await me.post('/api/auth/password', { current_password: 'wrong-one', new_password: password() })).status, 400);
  const newPw = password();
  assert.equal((await me.post('/api/auth/password', { current_password: pw, new_password: newPw })).status, 200);
  assert.equal((await me.get('/api/bands')).status, 200, 'this device stays signed in');
  assert.equal((await elsewhere.get('/api/bands')).status, 401, 'other devices are signed out');

  assert.equal((await me.put('/api/auth/account', { email: 'not-an-email' })).status, 400);
  const band = (await me.post('/api/bands', { name: 'Email Band' })).data;
  const r = await me.put('/api/auth/account', { email: 'settings@example.com' });
  assert.equal(r.data.user.email, 'settings@example.com');
  const profile = (await me.get(`/api/bands/${band.id}/members`)).data.find((m) => m.is_me);
  assert.equal(profile.email, 'settings@example.com', 'band profile without an email picks it up');
  assert.equal((await client(srv.base).post('/api/auth/password', {})).status, 401, 'needs a session');
});
