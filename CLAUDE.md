# Funklist

Rehearsal and gig attendance tracker for bands. Live at https://funklist.fly.dev (Fly.io app `funklist`).
Repo: github.com/PhilMayer/funklist.

## Stack and layout
- `server/` Node + Express 5, SQLite via better-sqlite3 (CommonJS). Entry `index.js` exports `app` and only
  listens when run directly.
  - `schema.sql` (fresh databases) + `db.js` (migrations: `hasColumn` checks, `ALTER TABLE`). Every schema
    change needs both.
  - `auth.js` sessions/passwords/Google, `notify.js` + `mailer.js` email, `calendar.js` iCalendar feed,
    `time.js` time zones, `quorum.js` instrument minimums.
- `client/` React 19 + Vite. One page app; views are state in `App.jsx` (no router). `?event=ID` and
  `?join=CODE` URLs are read on load.
- Instruments are a brass band lineup (Vocals, Percussion, Trumpets, Midhorns, Saxophones, Tubas, Dance Team);
  quorum minimums in `server/quorum.js` match instruments by name.

## Commands
- `npm test` (root) runs the server tests: `node --test` in `server/test/`. No extra dependencies.
- `npm --prefix client run build` / `run lint` (oxlint; two existing `set-state-in-effect` warnings are known).
- `npm run dev` runs API (:3001) and Vite (:5173) together; `npm start` serves the built client from :3001.
- `npm run seed` adds demo band "The Funklist" and login `demo` (password in `server/seed.js`). Don't run it
  against real data: it links the demo login to a member.

## Testing manually
- Use a throwaway database, never `server/funklist.db` or production:
  `DB_PATH=<scratch>/t.db node seed.js` then `DB_PATH=<scratch>/t.db PORT=3098 node index.js`.
- Sign-up/login is rate limited per IP (20 / 15 min). For many requests, run with `TRUST_PROXY=1` and send a
  distinct `X-Forwarded-For` per client (the test helper does this).
- Without `SMTP_HOST`, emails are logged (or collected in `mailer.sentMail` under `NODE_ENV=test`), not sent.
  Locally, `server/.env` holds `GOOGLE_CLIENT_ID` (and is skipped when `NODE_ENV=test`).
- Browsers only enforce `minLength` on typed input; set values programmatically and it won't trigger.

## Shipping
- Work on a branch, open a PR against `main` (the user merges). CI (`.github/workflows/ci.yml`) runs server
  tests and the client build/lint.
- Deploy only when asked, from an up-to-date, clean `main`: `~/.fly/bin/flyctl deploy --remote-only -a funklist`
  (no local Docker). `flyctl` builds from the working directory, so check out `main` first.
- After deploying: site returns 200, served bundle has the new code, `fly logs` shows "listening" with no
  errors, `/data/funklist.db` still present. Read production data only read-only and only what's needed
  (counts/columns), via `fly ssh console -C` with a small node script (`better-sqlite3`, `{ readonly: true }`).
- Secrets live in Fly (`GOOGLE_CLIENT_ID`, `SMTP_*`, `MAIL_FROM`); `fly.toml` sets `APP_URL`,
  `DEFAULT_TIMEZONE`, `TRUST_PROXY`. The machine auto-stops when idle (~3s cold start).

## Gotchas
- The shell is zsh: a glob with no matches (e.g. `rm t.db*`) aborts the whole command. Quote paths or list
  files explicitly.
- SQLite string literals use single quotes; double quotes mean identifiers.
- Fly's clock is UTC. "Today" for Upcoming/Past comes from the band's time zone (`time.js todayIn`), never
  the server's local date.
- Google Calendar can't use `webcal://` subscribe links for this HTTPS-only site; members paste the https feed
  link into Google's "From URL" page. Google refreshes subscribed calendars about once a day.
- The calendar feed URL's token is a secret: never log it.

## Known issues (not yet fixed; `test.todo` in `server/test/auth.test.js`)
- Simultaneous sign-ups for the same new username: the loser gets 500 instead of 409.
- Password over 200 chars gets "must be at least 8 characters".
- No max length on display names (long ones break the header) or emails.
- Username field has no hints; punctuation-only usernames ("...") are allowed.
