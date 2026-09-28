// Confirmation shown after an action that emails the band (new event, confirm, cancel).
export function notifiedMessage({ notified, missing_email: missing, email_enabled: enabled }) {
  if (notified && !enabled) return 'Email isn’t set up on this server yet, so no one was emailed.';
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const noEmail = missing
    ? `${plural(missing, 'bandmate has', 'bandmates have')} no email address yet; add it on the Members tab.`
    : '';
  if (notified) return `Emailed ${plural(notified, 'bandmate', 'bandmates')} about this event. ${noEmail}`.trim();
  return noEmail ? `No one was emailed: ${noEmail}` : '';
}
