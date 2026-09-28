const { sendMail, emailEnabled } = require('./mailer');

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Dates are stored as YYYY-MM-DD; format at UTC midnight so the day never shifts.
const formatDate = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });

function formatTime(hhmm) {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

// What the recipient has answered, for confirmation emails.
const RSVP_LINES = {
  yes: 'You’re down as a Yes. Event details:',
  iffy: 'You’re down as Iffy. Please firm up your RSVP:',
  no: 'You said you can’t make it. If that’s changed, update your RSVP:',
  none: 'You haven’t RSVP’d yet. Can you make it?',
};

// kind: 'created' | 'confirmed' | 'cancelled'
function buildEmail({ kind, event, bandName, actorName, recipient, link }) {
  const type = event.type === 'gig' ? 'gig' : 'rehearsal';
  const date = formatDate(event.event_date);
  const cancelled = kind === 'cancelled';

  const subject = {
    created: `New ${type}: ${event.title} (${date})`,
    confirmed: `Confirmed: ${event.title} (${date})`,
    cancelled: `Cancelled: ${event.title} (${date})`,
  }[kind];
  const intro = {
    created: `${actorName} added a new ${type} for ${bandName}:`,
    confirmed: `${actorName} confirmed this ${type} for ${bandName}. It’s on!`,
    cancelled: `${actorName} cancelled this ${type} for ${bandName}. It’s no longer happening.`,
  }[kind];
  const closing = {
    created: 'Can you make it? RSVP here:',
    confirmed: RSVP_LINES[recipient.rsvp || 'none'],
    cancelled: 'Event page:',
  }[kind];
  const button = cancelled ? 'View event' : 'View event & RSVP';

  // A cancellation only needs to say which event it was.
  const facts = [
    ['When', date],
    ['Call time', cancelled ? null : formatTime(event.call_time)],
    ['Hit time', cancelled ? null : formatTime(event.hit_time)],
    ['Venue', event.venue],
  ].filter(([, v]) => v);
  const description = cancelled ? null : event.description;
  const songs = cancelled ? [] : (event.set_list || '').split('\n').map((s) => s.trim()).filter(Boolean);

  const text = [
    `Hi ${recipient.name},`,
    '',
    intro,
    '',
    event.title,
    ...facts.map(([k, v]) => `${k}: ${v}`),
    ...(description ? ['', description] : []),
    ...(songs.length ? ['', 'Set list:', ...songs.map((s, i) => `${i + 1}. ${s}`)] : []),
    '',
    `${closing} ${link}`,
  ].join('\n');

  const pill = {
    confirmed: '<span style="display:inline-block;background:#dcfce7;color:#15803d;font-weight:700;font-size:12px;letter-spacing:.05em;padding:3px 8px;border-radius:6px;margin:0 0 8px">CONFIRMED</span>',
    cancelled: '<span style="display:inline-block;background:#fee2e2;color:#b91c1c;font-weight:700;font-size:12px;letter-spacing:.05em;padding:3px 8px;border-radius:6px;margin:0 0 8px">CANCELLED</span>',
  }[kind] || '';

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f6f4f1;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#1d1b19">
  <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e4dfd8;border-radius:10px;padding:24px">
    <p style="margin:0 0 16px">Hi ${escapeHtml(recipient.name)},</p>
    <p style="margin:0 0 16px">${escapeHtml(intro)}</p>
    ${pill}
    <h1 style="font-size:20px;margin:0 0 12px${cancelled ? ';text-decoration:line-through;color:#6f6a64' : ''}">${escapeHtml(event.title)}</h1>
    <table style="border-collapse:collapse;margin:0 0 16px;font-size:15px">
      ${facts.map(([k, v]) => `<tr><td style="padding:2px 16px 2px 0;color:#6f6a64">${k}</td><td style="padding:2px 0;font-weight:600">${escapeHtml(v)}</td></tr>`).join('')}
    </table>
    ${description ? `<p style="margin:0 0 16px;white-space:pre-wrap">${escapeHtml(description)}</p>` : ''}
    ${songs.length ? `<p style="margin:0 0 4px;color:#6f6a64">Set list</p><ol style="margin:0 0 16px;padding-left:20px">${songs.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ol>` : ''}
    ${kind === 'confirmed' ? `<p style="margin:16px 0 0">${escapeHtml(closing)}</p>` : ''}
    <p style="margin:24px 0 8px"><a href="${escapeHtml(link)}" style="display:inline-block;background:#c2410c;color:#fff;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:8px">${escapeHtml(button)}</a></p>
    <p style="margin:0;font-size:13px;color:#6f6a64">Or open: <a href="${escapeHtml(link)}" style="color:#c2410c">${escapeHtml(link)}</a></p>
  </div>
</body></html>`;

  return { subject, text, html };
}

// Emails each recipient separately (so addresses aren't shared). Runs in the background:
// failures are logged and never affect the request that triggered it.
// recipients: [{ id, name, email, rsvp? }]; actor: the member who made the change.
async function notifyBand({ kind, event, bandName, actor, recipients, appUrl }) {
  const link = `${appUrl}/?event=${event.id}`;
  let sent = 0;
  for (const recipient of recipients) {
    try {
      const email = buildEmail({ kind, event, bandName, actorName: actor.name, recipient, link });
      await sendMail({ to: recipient.email, replyTo: actor.email || undefined, ...email });
      sent++;
    } catch (err) {
      console.error(`Event ${event.id}: failed to email member ${recipient.id}: ${err.message}`);
    }
  }
  const outcome = emailEnabled ? 'sent' : 'logged (SMTP not configured)';
  console.log(`Event ${event.id}: ${kind} email ${outcome} for ${sent}/${recipients.length} members`);
}

module.exports = { notifyBand, buildEmail };
