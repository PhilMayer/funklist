// Time zones are IANA names like "America/New_York". Node's built-in time zone data handles them
// regardless of the server's own clock setting (Fly machines run on UTC).

function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || !tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// For bands that don't have a time zone yet. Set DEFAULT_TIMEZONE in production; locally this
// falls back to the machine's own zone.
const DEFAULT_TIMEZONE = isValidTimeZone(process.env.DEFAULT_TIMEZONE)
  ? process.env.DEFAULT_TIMEZONE
  : Intl.DateTimeFormat().resolvedOptions().timeZone;

// Today's date as YYYY-MM-DD in the given time zone.
function todayIn(tz, now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(now)
      .map((p) => [p.type, p.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// How far the time zone is ahead of UTC at a given moment, in milliseconds (DST-aware).
function offsetMs(tz, instant) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(instant).map((x) => [x.type, x.value])
  );
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - instant.getTime();
}

// The exact moment a local date and time ('YYYY-MM-DD', 'HH:MM') happen in a time zone.
function zonedTimeToUtc(date, time, tz) {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  // First guess using the offset at the wall-clock time, then correct with the offset at the
  // resulting moment (they differ only around daylight-saving changes).
  const guess = wall - offsetMs(tz, new Date(wall));
  return new Date(wall - offsetMs(tz, new Date(guess)));
}

// 'HH:MM' → '7:30 PM'
function formatTime12(hhmm) {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

module.exports = { isValidTimeZone, DEFAULT_TIMEZONE, todayIn, zonedTimeToUtc, formatTime12 };
