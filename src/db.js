'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./config');

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
fs.mkdirSync(config.uploadDir, { recursive: true });

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = fs.readFileSync(path.join(config.root, 'db', 'schema.sql'), 'utf8');
db.exec(schema);

// ---------------------------------------------------------------------------
// Version history helper - every vendor write goes through saveVendor() so the
// snapshot/diff trail is guaranteed to exist.
// ---------------------------------------------------------------------------
const TRACKED_FIELDS = [
  'company_name',
  'contact_person',
  'email',
  'phone',
  'address',
  'registration_number',
  'gst_number',
  'bank_account_number',
  'ifsc_code',
];

function toRow(data) {
  return TRACKED_FIELDS.reduce((acc, field) => {
    acc[field] = data[field] === undefined || data[field] === null ? null : String(data[field]).trim();
    return acc;
  }, {});
}

const insertVersion = db.prepare(`
  INSERT INTO vendor_versions (vendor_id, version_number, snapshot, changed_fields, note)
  VALUES (@vendor_id, @version_number, @snapshot, @changed_fields, @note)
`);

const insertVendorStmt = db.prepare(`
  INSERT INTO vendors (company_name, contact_person, email, phone, address,
                       registration_number, gst_number, bank_account_number, ifsc_code, status, status_reason)
  VALUES (@company_name, @contact_person, @email, @phone, @address,
          @registration_number, @gst_number, @bank_account_number, @ifsc_code, @status, @status_reason)
`);

const updateVendorStmt = db.prepare(`
  UPDATE vendors SET
    company_name = @company_name,
    contact_person = @contact_person,
    email = @email,
    phone = @phone,
    address = @address,
    registration_number = @registration_number,
    gst_number = @gst_number,
    bank_account_number = @bank_account_number,
    ifsc_code = @ifsc_code,
    updated_at = datetime('now')
  WHERE id = @id
`);

/** Diff two tracked snapshots: { field: { from, to } } */
function diff(before, after) {
  const changed = {};
  for (const field of TRACKED_FIELDS) {
    const from = before ? before[field] : null;
    const to = after[field];
    if ((from ?? '') !== (to ?? '')) changed[field] = { from, to };
  }
  return changed;
}

/** Create a vendor (version 1) inside a transaction. */
function createVendor(data, { status = 'Draft', statusReason = null, note = 'Vendor created' } = {}) {
  const row = { ...toRow(data), status, status_reason: statusReason };
  const tx = db.transaction(() => {
    const info = insertVendorStmt.run(row);
    const id = info.lastInsertRowid;
    insertVersion.run({
      vendor_id: id,
      version_number: 1,
      snapshot: JSON.stringify(toRow(data)),
      changed_fields: JSON.stringify({}),
      note,
    });
    return id;
  });
  return Number(tx());
}

/** Update a vendor; only writes a new version when tracked fields changed. */
function saveVendor(id, patch, { note = null } = {}) {
  const current = db.prepare('SELECT * FROM vendors WHERE id = ?').get(id);
  if (!current) return null;

  const next = { ...current, ...toRow({ ...current, ...patch }) };
  const changed = diff(toRow(current), toRow(next));
  if (Object.keys(changed).length === 0) return { id: Number(id), changed: {}, version: null };

  const tx = db.transaction(() => {
    updateVendorStmt.run({ ...toRow(next), id });
    const last = db
      .prepare('SELECT MAX(version_number) v FROM vendor_versions WHERE vendor_id = ?')
      .get(id).v;
    const version = Number(last || 0) + 1;
    insertVersion.run({
      vendor_id: id,
      version_number: version,
      snapshot: JSON.stringify(toRow(next)),
      changed_fields: JSON.stringify(changed),
      note,
    });
    return version;
  });

  const version = tx();
  return { id: Number(id), changed, version };
}

/** Restore a previous snapshot as the newest version (restores are additive, never destructive). */
function restoreVersion(vendorId, versionNumber) {
  const version = db
    .prepare('SELECT * FROM vendor_versions WHERE vendor_id = ? AND version_number = ?')
    .get(vendorId, versionNumber);
  if (!version) return null;
  const snapshot = JSON.parse(version.snapshot);
  return saveVendor(vendorId, snapshot, { note: `Restored from version ${versionNumber}` });
}

/**
 * A fresh deployment (or a wiped ephemeral disk) comes up with an empty
 * database, so seed the two demo vendors exactly once. Set SEED_DEMO=false to
 * start empty, DEMO_CONTACT_EMAIL to control where automated emails go.
 */
function seedIfEmpty() {
  if (process.env.SEED_DEMO === 'false') return 0;
  const count = db.prepare('SELECT COUNT(*) AS n FROM vendors').get().n;
  if (count > 0) return 0;

  const contact = (process.env.DEMO_CONTACT_EMAIL || 'vendor@abc-technologies.example.com').trim();

  createVendor({
    company_name: 'ABC Technologies Pvt Ltd',
    contact_person: 'Ravi Kumar',
    email: contact,
    phone: '+91 98765 43210',
    address: '4th Floor, Tech Park, Outer Ring Road, Bengaluru, Karnataka 560103, India',
    registration_number: 'U74999KA2016PTC091234',
    gst_number: '29AABCA1234A1Z5',
    bank_account_number: '50100234567890',
    ifsc_code: 'HDFC0001234',
  });

  createVendor({
    company_name: 'HDFC Bank Limited',
    contact_person: 'Corporate Services Desk',
    email: contact,
    phone: '+91 22 6160 6161',
    address: 'HDFC Bank House, Senapati Bapat Marg, Lower Parel (West), Mumbai, Maharashtra 400013, India',
    registration_number: 'L65920MH1994PLC080618', // real CIN, exactly as published by GLEIF
    gst_number: null,
    bank_account_number: null,
    ifsc_code: null,
  });

  return 2;
}

const seeded = seedIfEmpty();

module.exports = {
  db,
  TRACKED_FIELDS,
  createVendor,
  saveVendor,
  restoreVersion,
  diff,
  toRow,
  seeded,
};
