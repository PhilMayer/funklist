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

function buildEmail({ event, bandName, creatorName, recipientName, link }) {
  const kind = event.type === 'gig' ? 'gig' : 'rehearsal';
  const subject = `New ${kind}: ${event.title} (${formatDate(event.event_date)})`;
  const facts = [
    ['When', formatDate(event.event_date)],
    ['Call time', formatTime(event.call_time)],
    ['Hit time', formatTime(event.hit_time)],
    ['Venue', event.venue],
  ].filter(([, v]) => v);
  const songs = (event.set_list || '').split('\n').map((s) => s.trim()).filter(Boolean);

  const text = [
    `Hi ${recipientName},`,
    '',
    `${creatorName} added a new ${kind} for ${bandName}:`,
    '',
    event.title,
    ...facts.map(([k, v]) => `${k}: ${v}`),
    ...(event.description ? ['', event.description] : []),
    ...(songs.length ? ['', 'Set list:', ...songs.map((s, i) => `${i + 1}. ${s}`)] : []),
    '',
    `Can you make it? RSVP here: ${link}`,
  ].join('\n');

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f6f4f1;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#1d1b19">
  <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e4dfd8;border-radius:10px;padding:24px">
    <p style="margin:0 0 16px">Hi ${escapeHtml(recipientName)},</p>
    <p style="margin:0 0 16px">${escapeHtml(creatorName)} added a new ${kind} for <strong>${escapeHtml(bandName)}</strong>:</p>
    <h1 style="font-size:20px;margin:0 0 12px">${escapeHtml(event.title)}</h1>
    <table style="border-collapse:collapse;margin:0 0 16px;font-size:15px">
      ${facts.map(([k, v]) => `<tr><td style="padding:2px 16px 2px 0;color:#6f6a64">${k}</td><td style="padding:2px 0;font-weight:600">${escapeHtml(v)}</td></tr>`).join('')}
    </table>
    ${event.description ? `<p style="margin:0 0 16px;white-space:pre-wrap">${escapeHtml(event.description)}</p>` : ''}
    ${songs.length ? `<p style="margin:0 0 4px;color:#6f6a64">Set list</p><ol style="margin:0 0 16px;padding-left:20px">${songs.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ol>` : ''}
    <p style="margin:24px 0 8px"><a href="${escapeHtml(link)}" style="display:inline-block;background:#c2410c;color:#fff;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:8px">View event &amp; RSVP</a></p>
    <p style="margin:0;font-size:13px;color:#6f6a64">Or open: <a href="${escapeHtml(link)}" style="color:#c2410c">${escapeHtml(link)}</a></p>
  </div>
</body></html>`;

  return { subject, text, html };
}

// Emails each recipient separately (so addresses aren't shared). Runs in the background:
// failures are logged and never affect the request that created the event.
async function notifyNewEvent({ event, bandName, creator, recipients, appUrl }) {
  const link = `${appUrl}/?event=${event.id}`;
  let sent = 0;
  for (const r of recipients) {
    try {
      const email = buildEmail({ event, bandName, creatorName: creator.name, recipientName: r.name, link });
      await sendMail({ to: r.email, replyTo: creator.email || undefined, ...email });
      sent++;
    } catch (err) {
      console.error(`Event ${event.id}: failed to email member ${r.id}: ${err.message}`);
    }
  }
  console.log(`Event ${event.id}: new-event email ${emailEnabled ? 'sent' : 'logged (SMTP not configured)'} for ${sent}/${recipients.length} members`);
}

module.exports = { notifyNewEvent, buildEmail };
