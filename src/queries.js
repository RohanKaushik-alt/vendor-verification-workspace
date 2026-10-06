'use strict';

/** Read-model helpers shared by the route modules. */

const { db } = require('./db');

function getDocuments(vendorId) {
  return db
    .prepare(
      `SELECT id, vendor_id, doc_type, original_name, mime_type, size_bytes, status,
              extraction_status, extracted, edited, extracted_at, extraction_error, created_at
       FROM documents WHERE vendor_id = ? ORDER BY id`,
    )
    .all(vendorId)
    .map((doc) => ({ ...doc, edited: Boolean(doc.edited), url: `/api/documents/${doc.id}/file`, extracted: doc.extracted ? JSON.parse(doc.extracted) : null }));
}

function getVersions(vendorId) {
  return db
    .prepare('SELECT * FROM vendor_versions WHERE vendor_id = ? ORDER BY version_number DESC')
    .all(vendorId)
    .map((row) => ({
      id: row.id,
      version_number: row.version_number,
      snapshot: JSON.parse(row.snapshot),
      changed_fields: JSON.parse(row.changed_fields),
      note: row.note,
      created_at: row.created_at,
    }));
}

function getEmails(vendorId) {
  return db.prepare('SELECT * FROM emails WHERE vendor_id = ? ORDER BY id DESC').all(vendorId);
}

function getRuns(vendorId) {
  return db
    .prepare('SELECT * FROM analysis_runs WHERE vendor_id = ? ORDER BY id DESC')
    .all(vendorId)
    .map((row) => ({ ...row, payload: JSON.parse(row.payload) }));
}

module.exports = { getDocuments, getVersions, getEmails, getRuns };
