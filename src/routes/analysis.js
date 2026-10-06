'use strict';

/**
 * Analysis endpoints: AI cross-document comparison and external company
 * verification (OpenCorporates), plus the missing-document checklist + email.
 */

const express = require('express');
const { z } = require('zod');

const { db } = require('../db');
const { asyncHandler, badRequest, notFound } = require('../http');
const { compareDocuments } = require('../services/compare');
const { verifyCompany, activeProvider } = require('../services/verify');
const { evaluate, applySystemRules, buildChecklist, REQUIRED_DOCS } = require('../services/workflow');
const { sendEmail, missingDocumentEmail, resolveProvider } = require('../services/email');
const { summarize } = require('./summary');

const router = express.Router();

function recordRun(vendorId, kind, outcome, summary, payload) {
  const info = db
    .prepare('INSERT INTO analysis_runs (vendor_id, kind, outcome, summary, payload) VALUES (?, ?, ?, ?, ?)')
    .run(vendorId, kind, outcome, summary, JSON.stringify(payload));
  return Number(info.lastInsertRowid);
}

function requireVendor(id) {
  const vendor = db.prepare('SELECT * FROM vendors WHERE id = ?').get(Number(id));
  if (!vendor) throw notFound('Vendor not found');
  return vendor;
}

function payload(vendorId) {
  const report = evaluate(vendorId);
  return { workflow: summarize(report), checklist: report.checklist };
}

// ---------------------------------------------------------------------------
// AI comparison of uploaded documents vs the vendor record
// ---------------------------------------------------------------------------
router.post(
  '/vendors/:id/compare',
  asyncHandler(async (req, res) => {
    const vendorId = Number(req.params.id);
    const vendor = requireVendor(vendorId);
    const documents = db.prepare('SELECT * FROM documents WHERE vendor_id = ? ORDER BY id').all(vendorId);
    const extractedCount = documents.filter((d) => d.extraction_status === 'Extracted').length;

    if (extractedCount === 0) {
      throw badRequest('Upload at least one document and extract it before running the AI comparison.');
    }

    const comparison = compareDocuments(vendor, documents);
    const runId = recordRun(vendorId, 'ai_compare', comparison.outcome, comparison.summary, comparison);
    const auto = await applySystemRules(vendorId);

    res.json({ run_id: runId, comparison, automation: auto, ...payload(vendorId) });
  }),
);

// ---------------------------------------------------------------------------
// External company-verification API
// ---------------------------------------------------------------------------
router.post(
  '/vendors/:id/verify',
  asyncHandler(async (req, res) => {
    const vendorId = Number(req.params.id);
    const vendor = requireVendor(vendorId);
    const query = z
      .string()
      .trim()
      .min(2)
      .nullish()
      .transform((v) => v || null)
      .parse(req.body?.query);

    const report = await verifyCompany(vendor, query);
    const runId = recordRun(vendorId, 'company_verify', report.outcome, report.message, report);
    const auto = await applySystemRules(vendorId);

    res.json({ run_id: runId, verification: report, automation: auto, ...payload(vendorId) });
  }),
);

// ---------------------------------------------------------------------------
// Document checklist + automated missing-document email
// ---------------------------------------------------------------------------
router.get(
  '/vendors/:id/checklist',
  asyncHandler(async (req, res) => {
    const vendorId = Number(req.params.id);
    requireVendor(vendorId);
    res.json({
      required_documents: REQUIRED_DOCS,
      checklist: buildChecklist(vendorId),
      email_provider: resolveProvider(),
    });
  }),
);

router.post(
  '/vendors/:id/checklist/notify',
  asyncHandler(async (req, res) => {
    const vendorId = Number(req.params.id);
    const vendor = requireVendor(vendorId);
    const checklist = buildChecklist(vendorId);
    const missing = checklist.filter((item) => item.status === 'Missing').map((item) => item.doc_type);

    if (!missing.length) throw badRequest('No missing documents - nothing to notify the client about.');
    if (!vendor.email) throw badRequest('The vendor has no email address on file.');

    const { subject, text } = missingDocumentEmail(vendor, missing.map((docType) => ({ doc_type: docType })));
    const result = await sendEmail({
      vendorId,
      to: vendor.email,
      subject,
      text,
      reason: `Missing document(s): ${missing.join(', ')}`,
    });

    res.status(result.status === 'failed' ? 502 : 200).json({
      message: result.status === 'sent' ? 'Email sent' : result.status === 'simulated' ? 'Email simulated (no credentials)' : 'Email failed',
      email: result,
      missing,
      ...payload(vendorId),
    });
  }),
);

module.exports = router;
