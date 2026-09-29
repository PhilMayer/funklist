# Funklist
https://funklist.fly.dev/

Rehearsal and gig attendance for bands. Built with Node.js (Express), SQLite (`better-sqlite3`), and React (Vite).

## Run it

```bash
npm run install:all   # install root, server, and client dependencies
npm run seed          # optional: demo band "The Funklist" with members and events
npm run dev           # API on :3001, React dev server on :5173 (proxies /api)
```

For production, run `npm run build` and then `npm start`. Express serves the API and the built client on port 3001.

The database lives in `server/funklist.db`. Set `DB_PATH` to put it somewhere else.

## Schema (`server/schema.sql`)

| Table | Purpose |
|---|---|
| `users` | Login accounts: username + password hash and/or Google account id |
| `sessions` | Active sign-in sessions (hashed tokens) |
| `bands` | A band, with its invite code |
| `instruments` | Shared list of instruments (seeded with common ones) |
| `band_members` | A member of a band, with their primary instrument and (once claimed) their user account |
| `events` | Rehearsal or gig: type, title, date, creator |
| `event_details` | 1:1 with events: venue, call time, hit time, set list, description |
| `event_attendance` | One RSVP per member per event: `yes` / `no` / `iffy`, plus an optional instrument for that event |

## API

All routes except `/api/auth/*` need a signed-in session.

- `GET /api/auth/config`, `GET /api/auth/me`, `POST /api/auth/register | login | google | logout`
- `GET /api/invites/:code`, `POST /api/invites/:code/join` with `{ member_id }` to claim a profile, or `{ name, instrument_id }` to join as new
- `POST /api/bands/:id/invite` replaces the invite code

- `GET/POST /api/bands` (only your bands; creating one makes you a member), `GET /api/bands/:id`
- `GET/POST /api/instruments`
- `GET/POST /api/bands/:id/members`, `PUT/DELETE /api/members/:id`
- `GET /api/bands/:id/events?when=upcoming|past`, `POST /api/bands/:id/events`
- `GET/PUT/DELETE /api/events/:id`: GET includes attendance, with "yes" responders grouped by instrument
- `PUT /api/events/:id/rsvp` with `{ status, instrument_id? }`, which always RSVPs as the signed-in member

## Accounts and sign-in

Everyone signs in with a **username and password** or with **Google**. Passwords are hashed with scrypt. Sessions live in the `sessions` table and are sent as an httpOnly, SameSite=Lax cookie. Every API route except `/api/auth/*` requires a session, and you can only see bands you belong to. RSVPs and new events always use the signed-in member, whatever the request body says.

**Joining a band:** whoever creates a band becomes its first member. The Members tab shows an invite link (`/?join=CODE`). People who open it can either claim an existing profile that has no account yet (keeping its RSVP history) or join as a new member. "New link" replaces the code so the old link stops working.

**Bands created before accounts existed** have nobody linked, so print their invite links from the server:

```bash
npm --prefix server run invite
```

**Demo login:** `npm run seed` creates a `demo` user linked to the first member of the demo band. The password is in `server/seed.js`. It's for local development only.

### Enabling Google sign-in

1. In [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials), create an **OAuth client ID** of type **Web application**. You may need to set up the OAuth consent screen first.
2. Under **Authorized JavaScript origins**, add every origin the app runs on, for example `http://localhost`, `http://localhost:5173`, `http://localhost:3001`, and your production URL. No redirect URIs are needed.
3. Copy `server/.env.example` to `server/.env` and set `GOOGLE_CLIENT_ID`.
4. Restart the server. The "Continue with Google" button appears once the ID is set.

The browser gets a signed ID token from Google, and the server verifies its signature and audience before creating a session. No client secret is involved.

### Production notes

- Serve over HTTPS and set `NODE_ENV=production` (or `COOKIE_SECURE=1`) so the cookie is marked Secure.
- The login rate limit is in memory and per IP. If you run behind a reverse proxy, set Express's `trust proxy` so it sees real client IPs.
