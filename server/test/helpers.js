// Starts the API in-process against a throwaway database. Each test file runs in its own process
// (node --test), so each gets a fresh database.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

function startServer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'funklist-test-'));
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DB_PATH: path.join(dir, 'test.db'),
    TRUST_PROXY: '1', // lets each test client use its own address, so the login rate limit doesn't interfere
    APP_URL: 'https://funklist.test',
    DEFAULT_TIMEZONE: 'America/New_York',
  });
  for (const key of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'GOOGLE_CLIENT_ID']) delete process.env[key];

  const app = require('../index');
  const db = require('../db');
  const { sentMail } = require('../mailer');
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const close = () => new Promise((resolve) => server.close(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
    resolve();
  }));
  return { base, db, sentMail, close };
}

let nextIp = 1;
// A test user's HTTP client: keeps its session cookie and has its own client address.
function client(base, ip = `10.1.${Math.floor(nextIp / 250)}.${(nextIp++ % 250) + 1}`) {
  let cookie = '';
  async function call(method, url, body) {
    const res = await fetch(base + url, {
      method,
      redirect: 'manual',
      headers: {
        'x-forwarded-for': ip,
        ...(cookie ? { cookie } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const text = await res.text();
    let data = text;
    try { data = JSON.parse(text); } catch { /* not JSON (e.g. .ics) */ }
    return { status: res.status, data, headers: res.headers };
  }
  return {
    get: (url) => call('GET', url),
    post: (url, body = {}) => call('POST', url, body),
    put: (url, body = {}) => call('PUT', url, body),
    del: (url) => call('DELETE', url),
  };
}

const password = () => crypto.randomBytes(12).toString('base64url');

// Registers a user and returns their client.
async function signUp(base, username, extra = {}) {
  const c = client(base);
  const res = await c.post('/api/auth/register', { username, password: password(), ...extra });
  if (res.status !== 201) throw new Error(`sign-up for ${username} failed: ${res.status} ${JSON.stringify(res.data)}`);
  c.user = res.data.user;
  return c;
}

module.exports = { startServer, client, signUp, password };
