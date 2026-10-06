'use strict';

/**
 * Email service with three providers and one interface:
 *
 *   resend -> HTTP API (free tier: https://resend.com)
 *   smtp   -> nodemailer (Gmail app password, Brevo, Mailtrap, ...)
 *   log    -> no credentials: the message is stored in the `emails` table and
 *             returned as `simulated` so the flow is still fully demonstrable
 *
 * EMAIL_PROVIDER=auto picks the best available provider at runtime.
 */

const config = require('../../config');
const { db } = require('../../db');

function resolveProvider() {
  const requested = config.email.provider;
  if (requested === 'resend' || requested === 'smtp' || requested === 'log') return requested;
  if (config.email.resendKey) return 'resend';
  if (config.email.smtp.host && config.email.smtp.user) return 'smtp';
  return 'log';
}

async function sendWithResend({ to, from, subject, text }) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.email.resendKey}` },
    body: JSON.stringify({ from, to: [to], subject, text }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    const error = new Error(`Resend error ${response.status}: ${body.slice(0, 200)}`);
    error.status = response.status;
    throw error;
  }
  return response.json().catch(() => ({}));
}

async function sendWithSmtp({ to, from, subject, text }) {
  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({
    host: config.email.smtp.host,
    port: config.email.smtp.port,
    secure: config.email.smtp.secure,
    auth: { user: config.email.smtp.user, pass: config.email.smtp.pass },
  });
  await transporter.sendMail({ from, to, subject, text });
}

/**
 * Send (or simulate) an email and persist it for the audit trail.
 *
 * @returns {Promise<{id:number, provider:string, status:string, error:string|null}>}
 */
async function sendEmail({ vendorId, to, subject, text, reason }) {
  const provider = resolveProvider();
  const from = config.email.from;

  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    const row = db
      .prepare(
        `INSERT INTO emails (vendor_id, to_email, subject, body, reason, provider, status, error)
         VALUES (?, ?, ?, ?, ?, ?, 'failed', ?)`,
      )
      .run(vendorId, to || '(missing)', subject, text, reason, provider, 'Invalid recipient email address');
    return { id: Number(row.lastInsertRowid), provider, status: 'failed', error: 'Invalid recipient email address' };
  }

  let status = 'sent';
  let error = null;

  if (provider === 'resend') {
    try {
      await sendWithResend({ to, from, subject, text });
    } catch (err) {
      status = 'failed';
      error = err.message;
    }
  } else if (provider === 'smtp') {
    try {
      await sendWithSmtp({ to, from, subject, text });
    } catch (err) {
      status = 'failed';
      error = err.message;
    }
  } else {
    status = 'simulated';
    error = 'No email credentials configured (EMAIL_PROVIDER=log) - message stored instead of sent.';
  }

  const row = db
    .prepare(
      `INSERT INTO emails (vendor_id, to_email, subject, body, reason, provider, status, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(vendorId, to, subject, text, reason, provider, status, error);

  return { id: Number(row.lastInsertRowid), provider, status, error };
}

/** The missing-document email required by the assessment. */
function missingDocumentEmail(vendor, missingDocs) {
  const list = missingDocs.map((d) => `  - ${d.doc_type}`).join('\n');
  const subject = `[Action Required] Missing documents for ${vendor.company_name}`;
  const text = [
    `Dear ${vendor.contact_person || 'Team'},`,
    '',
    `We are completing the onboarding / verification of your company, ${vendor.company_name}.`,
    'Our records show that the following required document(s) are still missing:',
    '',
    list,
    '',
    'Please reply to this email with the document(s) at your earliest convenience so we can finish the verification.',
    'If you have already sent them, kindly ignore this notice.',
    '',
    'Regards,',
    'Vendor Verification Team',
  ].join('\n');
  return { subject, text };
}

module.exports = { sendEmail, missingDocumentEmail, resolveProvider };
