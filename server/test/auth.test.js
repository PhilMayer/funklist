const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, signUp, password } = require('./helpers');

const srv = startServer();
test.after(() => srv.close());
const register = (body) => client(srv.base).post('/api/auth/register', body);

test('usernames: 3–32 characters from A–Z a–z 0–9 . _ -', async () => {
  for (const ok of ['abc', 'a'.repeat(32), 'MiXeD123', 'under_score', 'dot.name', 'dash-name']) {
    assert.equal((await register({ username: ok, password: password() })).status, 201, ok);
  }
  for (const bad of ['ab', 'b'.repeat(33), 'a b c', 'José', 'аlice', 'zero​width', 'trumpet🎺', 'user@name', "a'; DROP TABLE users;--", '<script>', '', null, 12345]) {
    assert.equal((await register({ username: bad, password: password() })).status, 400, JSON.stringify(bad));
  }
});

test('usernames are unique regardless of case, and trimmed', async () => {
  await signUp(srv.base, 'Unique1');
  assert.equal((await register({ username: 'UNIQUE1', password: password() })).status, 409);
  assert.equal((await register({ username: '  unique1 ', password: password() })).status, 409);
});

test('passwords: 8–200 characters', async () => {
  assert.equal((await register({ username: 'pw7', password: 'x'.repeat(7) })).status, 400);
  assert.equal((await register({ username: 'pw8', password: 'x'.repeat(8) })).status, 201);
  assert.equal((await register({ username: 'pw200', password: 'x'.repeat(200) })).status, 201);
  assert.equal((await register({ username: 'pw201', password: 'x'.repeat(201) })).status, 400);
});

test('email is optional but must be valid', async () => {
  assert.equal((await register({ username: 'em1', password: password(), email: 'not-an-email' })).status, 400);
  const ok = await register({ username: 'em2', password: password(), email: '  band@example.com ' });
  assert.equal(ok.status, 201);
  assert.equal(ok.data.user.email, 'band@example.com');
});

test('login works case-insensitively and rejects wrong passwords the same way', async () => {
  const pw = password();
  await client(srv.base).post('/api/auth/register', { username: 'LoginUser', password: pw });
  assert.equal((await client(srv.base).post('/api/auth/login', { username: 'loginuser', password: pw })).status, 200);
  const wrong = await client(srv.base).post('/api/auth/login', { username: 'loginuser', password: 'wrong-password' });
  const unknown = await client(srv.base).post('/api/auth/login', { username: 'nobody-here', password: 'wrong-password' });
  assert.equal(wrong.status, 401);
  assert.deepEqual(wrong.data, unknown.data);
});

test('API needs a session; logout ends it', async () => {
  assert.equal((await client(srv.base).get('/api/bands')).status, 401);
  const c = await signUp(srv.base, 'logoutuser');
  assert.equal((await c.get('/api/bands')).status, 200);
  assert.equal((await c.post('/api/auth/logout')).status, 204);
  assert.equal((await c.get('/api/bands')).status, 401);
});

test('malformed JSON is a 400, not a 500', async () => {
  assert.equal((await client(srv.base).post('/api/auth/register', '{"username":')).status, 400);
});

test('21st sign-up/login attempt from one address in 15 minutes is refused', async () => {
  const c = client(srv.base, '10.99.99.99');
  for (let i = 0; i < 20; i++) await c.post('/api/auth/register', { username: 'x' });
  assert.equal((await c.post('/api/auth/register', { username: 'x' })).status, 429);
});

// Known issues found in testing (see CLAUDE.md); flip to real tests when fixed.
test.todo('two simultaneous sign-ups for the same username: the loser gets 409, not 500');
test('a password over 200 characters gets a message that mentions the maximum', async () => {
  const r = await register({ username: 'pwmsg', password: 'x'.repeat(201) });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /8–200 characters/);
});
test.todo('display names have a maximum length');
