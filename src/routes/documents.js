'use strict';

/**
 * Document upload + AI extraction endpoints.
 *
 * POST   /api/vendors/:id/documents     multipart upload -> store -> extract -> auto-check
 * POST   /api/documents/:id/extract     re-run extraction (e.g. after adding an AI key)
 * PATCH  /api/documents/:id             correct AI-extracted values / mark Verified
 * DELETE /api/documents/:id             remove -> document becomes "Missing"
 * GET    /api/documents/:id/file        download the original file
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { z } = require('zod');

const config = require('../config');
const { db } = require('../db');
const { asyncHandler, badRequest, notFound } = require('../http');
const { extractDocument, readPdfText } = require('../services/ai');
const { evaluate, applySystemRules, REQUIRED_DOCS } = require('../services/workflow');
const { summarize } = require('./summary');
const { FIELD_KEYS } = require('../services/ai/local');

const router = express.Router();

fs.mkdirSync(config.uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, config.uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().slice(0, 10);
    cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`);
  },
});

const ALLOWED_MIME = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']);

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    // Some clients (and scripts using Blob without a type) send
    // application/octet-stream - fall back to the file extension.
    if (!file.mimetype || file.mimetype === 'application/octet-stream') {
      const inferred = {
        '.pdf': 'application/pdf',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
      }[path.extname(file.originalname).toLowerCase()];
      if (inferred) file.mimetype = inferred;
    }
    if (ALLOWED_MIME.has(file.mimetype)) return cb(null, true);
    cb(Object.assign(new Error(`Unsupported file type "${file.mimetype}". Use PDF, PNG, JPG or WEBP.`), { status: 415 }));
  },
}).single('file');

/** Run extraction for a stored file and persist the outcome. */
async function runExtraction(doc) {
  const filePath = path.join(config.uploadDir, doc.stored_name);
  try {
    const buffer = fs.readFileSync(filePath);
    const result = await extractDocument({ buffer, mimeType: doc.mime_type, docType: doc.doc_type });

    db.prepare(
      `UPDATE documents
         SET extracted = ?, extraction_status = 'Extracted', extracted_at = datetime('now'),
             extraction_error = NULL, edited = 0
       WHERE id = ?`,
    ).run(JSON.stringify({ fields: result.fields, source: result.strategy, warnings: result.warnings }), doc.id);

    return { ok: true, fields: result.fields, source: result.strategy, warnings: result.warnings };
  } catch (err) {
    db.prepare(
      `UPDATE documents SET extraction_status = 'Failed', extraction_error = ?, extracted_at = datetime('now') WHERE id = ?`,
    ).run(err.message, doc.id);
    return { ok: false, error: err.message, details: err.details || null };
  }
}

function loadDoc(id) {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(Number(id));
  return doc ? shapeDocument(doc) : null;
}

/** JSON columns parsed so API consumers never see raw strings. */
function shapeDocument(doc) {
  if (!doc) return doc;
  return {
    ...doc,
    edited: Boolean(doc.edited),
    extracted: doc.extracted ? JSON.parse(doc.extracted) : null,
    url: `/api/documents/${doc.id}/file`,
  };
}

function requireDoc(id) {
  const doc = loadDoc(id);
  if (!doc) throw notFound('Document not found');
  return doc;
}

function workspacePayload(vendorId) {
  const report = evaluate(vendorId);
  return {
    documents: db.prepare('SELECT * FROM documents WHERE vendor_id = ? ORDER BY id').all(vendorId).map(shapeDocument),
    workflow: summarize(report),
    checklist: report.checklist,
    comparison: report.comparison,
    vendor: report.vendor,
  };
}

// ---------------------------------------------------------------------------
router.post(
  '/vendors/:id/documents',
  (req, res, next) => {
    upload(req, res, (err) => (err ? next(err) : next()));
  },
  asyncHandler(async (req, res) => {
    const vendorId = Number(req.params.id);
    if (!db.prepare('SELECT id FROM vendors WHERE id = ?').get(vendorId)) throw notFound('Vendor not found');
    if (!req.file) throw badRequest('No file uploaded (multipart field name must be "file").');

    const docType = String(req.body.doc_type || '').trim();
    if (!REQUIRED_DOCS.includes(docType)) {
      fs.unlink(req.file.path, () => {});
      throw badRequest(`doc_type must be one of: ${REQUIRED_DOCS.join(', ')}`);
    }

    // Replacing an existing document of the same type keeps the checklist clean.
    const previous = db
      .prepare('SELECT * FROM documents WHERE vendor_id = ? AND doc_type = ? ORDER BY id DESC LIMIT 1')
      .get(vendorId, docType);
    if (previous && previous.status !== 'Missing') {
      fs.unlink(path.join(config.uploadDir, previous.stored_name), () => {});
      db.prepare('DELETE FROM documents WHERE id = ?').run(previous.id);
    }

    const info = db
      .prepare(
        `INSERT INTO documents (vendor_id, doc_type, original_name, stored_name, mime_type, size_bytes, file_path, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'Available')`,
      )
      .run(
        vendorId,
        docType,
        req.file.originalname,
        req.file.filename,
        req.file.mimetype,
        req.file.size,
        req.file.path,
      );

    const doc = loadDoc(Number(info.lastInsertRowid));
    const extraction = await runExtraction(doc);
    const auto = await applySystemRules(vendorId);

    res.status(201).json({
      message: extraction.ok ? 'Uploaded and extracted' : 'Uploaded, extraction failed',
      document: loadDoc(doc.id),
      extraction,
      automation: auto,
      ...workspacePayload(vendorId),
    });
  }),
);

router.post(
  '/documents/:id/extract',
  asyncHandler(async (req, res) => {
    const doc = requireDoc(req.params.id);
    const extraction = await runExtraction(doc);
    const auto = await applySystemRules(doc.vendor_id);
    res.json({ document: loadDoc(doc.id), extraction, automation: auto, ...workspacePayload(doc.vendor_id) });
  }),
);

router.patch(
  '/documents/:id',
  asyncHandler(async (req, res) => {
    const doc = requireDoc(req.params.id);
    const schema = z.object({
      fields: z
        .object(
          Object.fromEntries(FIELD_KEYS.map((k) => [k, z.string().nullish().transform((v) => (v == null || String(v).trim() === '' ? null : String(v).trim()))])),
        )
        .partial()
        .optional(),
      status: z.enum(['Available', 'Verified', 'Missing']).optional(),
      note: z.string().max(500).nullish().transform((v) => v || null),
    });
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) throw parsed.error;

    // loadDoc() already returns `extracted` parsed (or null for a fresh doc)
    const current = doc.extracted && typeof doc.extracted === 'object' ? doc.extracted : { fields: {} };
    if (!current.fields) current.fields = {};
    let edited = doc.edited;

    if (parsed.data.fields) {
      const merged = { ...(current.fields || {}), ...parsed.data.fields };
      for (const key of FIELD_KEYS) if (!(key in merged)) merged[key] = null;
      current.fields = merged;
      current.edited_by = 'reviewer';
      current.edited_at = new Date().toISOString();
      edited = 1;
      db.prepare('UPDATE documents SET extracted = ?, edited = 1 WHERE id = ?').run(JSON.stringify(current), doc.id);
    }

    if (parsed.data.status) {
      db.prepare('UPDATE documents SET status = ? WHERE id = ?').run(parsed.data.status, doc.id);
    }

    const auto = await applySystemRules(doc.vendor_id);
    res.json({
      document: loadDoc(doc.id),
      edited: Boolean(edited),
      automation: auto,
      ...workspacePayload(doc.vendor_id),
    });
  }),
);

router.delete(
  '/documents/:id',
  asyncHandler(async (req, res) => {
    const doc = requireDoc(req.params.id);
    fs.unlink(path.join(config.uploadDir, doc.stored_name), () => {});
    db.prepare('DELETE FROM documents WHERE id = ?').run(doc.id);
    const auto = await applySystemRules(doc.vendor_id);
    res.json({ message: 'Document removed', automation: auto, ...workspacePayload(doc.vendor_id) });
  }),
);

router.get(
  '/documents/:id/file',
  asyncHandler(async (req, res) => {
    const doc = requireDoc(req.params.id);
    const filePath = path.join(config.uploadDir, doc.stored_name);
    if (!fs.existsSync(filePath)) throw notFound('Stored file no longer exists on disk');
    res.setHeader('Content-Type', doc.mime_type);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.original_name)}"`);
    fs.createReadStream(filePath).pipe(res);
  }),
);

/** Preview of the raw text layer - handy when extraction behaves unexpectedly. */
router.get(
  '/documents/:id/text',
  asyncHandler(async (req, res) => {
    const doc = requireDoc(req.params.id);
    if (!doc.mime_type.includes('pdf')) throw badRequest('Text preview is only available for PDFs');
    const filePath = path.join(config.uploadDir, doc.stored_name);
    const buffer = fs.readFileSync(filePath);
    const { text, pages, error } = await readPdfText(buffer);
    res.json({ pages: pages || 0, text: text || '', error: error || null });
  }),
);

module.exports = router;
