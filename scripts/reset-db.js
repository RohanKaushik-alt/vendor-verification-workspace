'use strict';

/**
 * Drops the database file and re-creates it from db/schema.sql with two demo
 * vendors that cover the whole demonstration:
 *
 *   1. "ABC Technologies Pvt Ltd"  - fictional, goes with the sample PDFs
 *      (name mismatch -> Action Required -> missing-document email)
 *   2. "HDFC Bank Limited"         - a real company, so the registry provider
 *      returns a genuine "Verified" result (GLEIF keyless lookup)
 *
 * The demo contact address is the Resend account's own address: Resend only
 * delivers to the account owner until a sending domain is verified, so this
 * makes the automated email show a real "sent" status.
 * Change it to your own address (or add SMTP settings) for a live demo.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dbPath = path.resolve(root, process.env.DB_PATH || 'data/app.db');

for (const suffix of ['', '-wal', '-shm']) {
  const file = `${dbPath}${suffix}`;
  if (fs.existsSync(file)) fs.unlinkSync(file);
}
console.log('removed', dbPath);

// The server auto-seeds an empty database on boot; this script creates the
// demo rows itself so it must opt out of that.
process.env.SEED_DEMO = 'false';

// Fresh module instance so the schema is applied to the new file.
delete require.cache[require.resolve('../src/db')];
const { createVendor } = require('../src/db');

// Real delivery only with Resend's own address until a sending domain is
// verified - override with DEMO_CONTACT_EMAIL in .env (git-ignored).
const demoEmail = (process.env.DEMO_CONTACT_EMAIL || 'vendor@abc-technologies.example.com').trim();

const fictional = createVendor({
  company_name: 'ABC Technologies Pvt Ltd',
  contact_person: 'Ravi Kumar',
  email: demoEmail,
  phone: '+91 98765 43210',
  address: '4th Floor, Tech Park, Outer Ring Road, Bengaluru, Karnataka 560103, India',
  registration_number: 'U74999KA2016PTC091234',
  gst_number: '29AABCA1234A1Z5',
  bank_account_number: '50100234567890',
  ifsc_code: 'HDFC0001234',
});

const real = createVendor({
  company_name: 'HDFC Bank Limited',
  contact_person: 'Corporate Services Desk',
  email: demoEmail,
  phone: '+91 22 6160 6161',
  address: 'HDFC Bank House, Senapati Bapat Marg, Lower Parel (West), Mumbai, Maharashtra 400013, India',
  registration_number: 'L65920MH1994PLC080618', // CIN, exactly as published by GLEIF
  gst_number: null,
  bank_account_number: null,
  ifsc_code: null,
});

console.log(`database recreated:`);
console.log(`  #${fictional}  ABC Technologies Pvt Ltd  (sample docs -> mismatch / missing-doc email)`);
console.log(`  #${real}      HDFC Bank Limited         (real registry -> Verified)`);
console.log('next: npm run samples   then   npm run dev');
