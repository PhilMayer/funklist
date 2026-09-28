const nodemailer = require('nodemailer');

// SMTP settings (works with Gmail, Resend, Postmark, SendGrid, SES, ...). See .env.example.
// Without SMTP_HOST, emails aren't sent; a summary and the text body are written to the log.
const SMTP_HOST = process.env.SMTP_HOST || null;
const SMTP_PORT = Number(process.env.SMTP_PORT) || 587;
const MAIL_FROM = process.env.MAIL_FROM || process.env.SMTP_USER || 'Funklist <no-reply@localhost>';

const transport = SMTP_HOST
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      // Port 465 uses TLS from the start; other ports upgrade with STARTTLS.
      secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : SMTP_PORT === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    })
  : null;

const emailEnabled = Boolean(transport);
console.log(emailEnabled ? `Email: sending via ${SMTP_HOST}:${SMTP_PORT}` : 'Email: SMTP_HOST not set, logging emails instead of sending');

async function sendMail({ to, subject, text, html, replyTo }) {
  if (!transport) {
    console.log(`[email not sent: SMTP not configured] to=${to} subject=${JSON.stringify(subject)}\n${text}\n`);
    return;
  }
  await transport.sendMail({ from: MAIL_FROM, to, subject, text, html, replyTo });
}

module.exports = { sendMail, emailEnabled };
