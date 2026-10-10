// Email / notification service.
// - When SMTP credentials are configured, real mail is sent via nodemailer.
// - Otherwise the dev mailer logs to console AND records every message in the
//   `notifications` collection so it is visible in the admin dashboard.
const nodemailer = require('nodemailer');
const config = require('../config');

let transporter = null;

if (config.smtp.host) {
  transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
}

/**
 * Send an email + create an in-app notification record.
 * @param {object} opts { to, subject, text, html, userId, type }
 */
async function send(opts) {
  const record = {
    _id: require('crypto').randomUUID(),
    type: opts.type || 'email',
    to: opts.to,
    userId: opts.userId || null,
    subject: opts.subject,
    text: opts.text,
    channel: transporter ? 'smtp' : 'dev',
    createdAt: new Date().toISOString(),
  };

  if (transporter) {
    try {
      await transporter.sendMail({
        from: config.smtp.from,
        to: opts.to,
        subject: opts.subject,
        text: opts.text,
        html: opts.html || undefined,
      });
      record.status = 'sent';
    } catch (err) {
      record.status = 'failed';
      record.error = err.message;
      console.error('[mailer] send failed:', err.message);
    }
  } else {
    // Dev mode: log to console, mark as delivered via dev channel
    record.status = 'sent';
    console.log('\n[mailer][dev] ------------------------------------------------');
    console.log(`[mailer][dev] To: ${opts.to}`);
    console.log(`[mailer][dev] Subject: ${opts.subject}`);
    console.log(`[mailer][dev] Body:\n${(opts.text || '').slice(0, 400)}`);
    console.log('[mailer][dev] ------------------------------------------------\n');
  }

  // Persist notification + in-app copy for the user
  try {
    const { db } = require('./storage');
    const store = await db();
    await store.insert('notifications', record);
    if (record.userId) {
      await store.insert('notifications', {
        _id: require('crypto').randomUUID(),
        type: 'inapp',
        to: record.to,
        userId: record.userId,
        subject: record.subject,
        text: record.text,
        channel: 'inapp',
        status: 'delivered',
        createdAt: record.createdAt,
      });
    }
  } catch (err) {
    console.error('[mailer] failed to log notification:', err.message);
  }
  return record;
}

module.exports = { send, transporter };
