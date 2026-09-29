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

module.exports = { isValidTimeZone, DEFAULT_TIMEZONE, todayIn };
