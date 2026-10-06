'use strict';

const express = require('express');
const { z } = require('zod');
const { db, createVendor, saveVendor, restoreVersion } = require('../db');
const { asyncHandler, badRequest, notFound } = require('../http');
const { evaluate, setStatus, applySystemRules } = require('../services/workflow');
const { getDocuments, getVersions, getEmails, getRuns } = require('../queries');
const { summarize } = require('./summary');

const router = express.Router();

const trimmed = z
  .string()
  .nullish()
  .transform((v) => (v === null || v === undefined ? null : String(v).trim() || null));

const vendorSchema = z.object({
  company_name: z.string().trim().min(2, 'Company name is required'),
  contact_person: trimmed,
  email: trimmed,
  phone: trimmed,
  address: trimmed,
  registration_number: trimmed,
  gst_number: trimmed,
  bank_account_number: trimmed,
  ifsc_code: trimmed,
});

const TRACKED = [
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

function shape(row) {
  if (!row) return null;
  const out = {};
  for (const field of TRACKED) out[field] = row[field];
  return { ...out, id: row.id, status: row.status, status_reason: row.status_reason, created_at: row.created_at, updated_at: row.updated_at };
}

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const rows = db
      .prepare(
        `SELECT v.*,
                (SELECT COUNT(*) FROM documents d WHERE d.vendor_id = v.id) AS document_count,
                (SELECT COUNT(*) FROM tasks t WHERE t.vendor_id = v.id AND t.status = 'Pending') AS pending_tasks
         FROM vendors v ORDER BY v.id DESC`,
      )
      .all();
    res.json({ vendors: rows.map((row) => ({ ...shape(row), document_count: row.document_count, pending_tasks: row.pending_tasks })) });
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = vendorSchema.safeParse(req.body || {});
    if (!parsed.success) throw parsed.error;

    const id = createVendor(parsed.data);
    await applySystemRules(id, { sendEmailNow: false });
    const report = evaluate(id);
    res.status(201).json({ vendor: shape(report.vendor), workflow: summarize(report) });
  }),
);

// ---------------------------------------------------------------------------
// Single vendor
// ---------------------------------------------------------------------------
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const report = evaluate(Number(req.params.id));
    if (!report) throw notFound('Vendor not found');
    res.json({
      vendor: shape(report.vendor),
      workflow: summarize(report),
      documents: getDocuments(report.vendor.id),
      checklist: report.checklist,
      tasks: report.tasks,
      versions: getVersions(report.vendor.id),
      emails: getEmails(report.vendor.id),
      runs: getRuns(report.vendor.id),
    });
  }),
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT id FROM vendors WHERE id = ?').get(id);
    if (!existing) throw notFound('Vendor not found');

    const parsed = vendorSchema.partial().safeParse(req.body || {});
    if (!parsed.success) throw parsed.error;
    if (Object.keys(parsed.data).length === 0) throw badRequest('No fields supplied');

    const result = saveVendor(id, parsed.data, { note: req.body.note || null });
    if (!result) throw notFound('Vendor not found');
    await applySystemRules(id, { sendEmailNow: false });

    const report = evaluate(id);
    res.json({
      vendor: shape(report.vendor),
      workflow: summarize(report),
      changed: result.changed,
      version: result.version,
    });
  }),
);

// ---------------------------------------------------------------------------
// Version history
// ---------------------------------------------------------------------------
router.get(
  '/:id/versions',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT id FROM vendors WHERE id = ?').get(id)) throw notFound('Vendor not found');
    res.json({ versions: getVersions(id) });
  }),
);

router.post(
  '/:id/versions/:version/restore',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const version = Number(req.params.version);
    if (!db.prepare('SELECT id FROM vendors WHERE id = ?').get(id)) throw notFound('Vendor not found');

    const restored = restoreVersion(id, version);
    if (!restored) throw notFound(`Version ${version} not found`);
    await applySystemRules(id, { sendEmailNow: false });

    const report = evaluate(id);
    res.json({
      message: `Restored version ${version} as version ${restored.version}`,
      vendor: shape(report.vendor),
      workflow: summarize(report),
      changed: restored.changed,
      version: restored.version,
    });
  }),
);

// ---------------------------------------------------------------------------
// Workflow status
// ---------------------------------------------------------------------------
router.patch(
  '/:id/status',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { status, note } = req.body || {};
    if (!status) throw badRequest('"status" is required');

    const result = setStatus(id, status, note || null);
    if (result.error) throw badRequest(result.error);
    await applySystemRules(id, { sendEmailNow: false });

    const report = evaluate(id);
    res.json({ transition: result, vendor: shape(report.vendor), workflow: summarize(report) });
  }),
);

router.get(
  '/:id/workflow',
  asyncHandler(async (req, res) => {
    const report = evaluate(Number(req.params.id));
    if (!report) throw notFound('Vendor not found');
    res.json({ ...summarize(report), checklist: report.checklist, comparison: report.comparison });
  }),
);

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------
router.post(
  '/:id/tasks',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT id FROM vendors WHERE id = ?').get(id)) throw notFound('Vendor not found');

    const schema = z.object({
      title: z.string().trim().min(3),
      priority: z.enum(['Low', 'Medium', 'High']).default('Medium'),
      due_date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
        .nullish()
        .transform((v) => v || null),
      status: z.enum(['Pending', 'Completed']).default('Pending'),
    });
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) throw parsed.error;

    const info = db
      .prepare(
        'INSERT INTO tasks (vendor_id, title, priority, due_date, status) VALUES (?, ?, ?, ?, ?)',
      )
      .run(id, parsed.data.title, parsed.data.priority, parsed.data.due_date, parsed.data.status);

    res.status(201).json({ task: db.prepare('SELECT * FROM tasks WHERE id = ?').get(Number(info.lastInsertRowid)) });
  }),
);

router.patch(
  '/:id/tasks/:taskId',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const taskId = Number(req.params.taskId);
    const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND vendor_id = ?').get(taskId, id);
    if (!task) throw notFound('Task not found');

    const schema = z.object({
      title: z.string().trim().min(3).optional(),
      priority: z.enum(['Low', 'Medium', 'High']).optional(),
      due_date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
        .nullish()
        .transform((v) => (v === undefined ? undefined : v || null)),
      status: z.enum(['Pending', 'Completed']).optional(),
    });
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) throw parsed.error;

    const next = { ...task, ...parsed.data };
    db.prepare(
      `UPDATE tasks SET title = ?, priority = ?, due_date = ?, status = ?, updated_at = datetime('now') WHERE id = ?`,
    ).run(next.title, next.priority, next.due_date, next.status, taskId);

    res.json({ task: db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) });
  }),
);

// ---------------------------------------------------------------------------
// Emails sent for this vendor
// ---------------------------------------------------------------------------
router.get(
  '/:id/emails',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT id FROM vendors WHERE id = ?').get(id)) throw notFound('Vendor not found');
    res.json({ emails: getEmails(id) });
  }),
);

module.exports = router;
