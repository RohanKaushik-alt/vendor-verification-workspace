'use strict';

/**
 * Workflow engine: status transitions, issue evaluation, checklist, tasks.
 *
 *   Draft -> Under Review -> Action Required -> Approved / Rejected
 *
 * System rules (automatic):
 *   - missing required document OR AI/API mismatch  => Action Required
 *   - a follow-up task + an email to the client are created on that transition
 * Reviewer rules (manual):
 *   - the reviewer may move a vendor forward/backward only along allowed edges,
 *   - Approved / Rejected requires no open issues (unless overridden with a note).
 */

const { db } = require('../db');
const { compareDocuments } = require('./compare');
const { sendEmail, missingDocumentEmail } = require('./email');

const STATUSES = ['Draft', 'Under Review', 'Action Required', 'Approved', 'Rejected'];

const TRANSITIONS = {
  Draft: ['Under Review', 'Action Required', 'Rejected'],
  'Under Review': ['Action Required', 'Approved', 'Rejected', 'Draft'],
  'Action Required': ['Under Review', 'Rejected'],
  Approved: ['Under Review', 'Rejected'],
  Rejected: ['Under Review'],
};

const REQUIRED_DOCS = ['Registration Certificate', 'GST Certificate', 'Bank Document'];

const insertStatus = db.prepare(`
  INSERT INTO status_history (vendor_id, from_status, to_status, note)
  VALUES (?, ?, ?, ?)
`);

function getVendor(id) {
  return db.prepare('SELECT * FROM vendors WHERE id = ?').get(id);
}

function getDocuments(vendorId) {
  return db.prepare('SELECT * FROM documents WHERE vendor_id = ? ORDER BY id').all(vendorId);
}

function getTasks(vendorId) {
  return db.prepare("SELECT * FROM tasks WHERE vendor_id = ? ORDER BY (status = 'Completed'), id DESC").all(vendorId);
}

/** Available | Missing | Verified for the three required documents. */
function buildChecklist(vendorId) {
  const documents = getDocuments(vendorId);
  return REQUIRED_DOCS.map((docType) => {
    const matches = documents.filter((d) => d.doc_type === docType);
    if (!matches.length) {
      return { doc_type: docType, status: 'Missing', document_id: null, file: null, edited: false };
    }
    const doc = matches[matches.length - 1];
    return {
      doc_type: docType,
      status: doc.status === 'Missing' ? 'Missing' : doc.status,
      document_id: doc.id,
      file: doc.original_name,
      edited: Boolean(doc.edited),
      extraction_status: doc.extraction_status,
    };
  });
}

/** Aggregate every signal the workflow cares about. */
function evaluate(vendorId) {
  const vendor = getVendor(vendorId);
  if (!vendor) return null;
  const documents = getDocuments(vendorId);
  const checklist = buildChecklist(vendorId);
  const missing = checklist.filter((item) => item.status === 'Missing').map((item) => item.doc_type);
  const comparison = compareDocuments(vendor, documents);
  const lastVerify = db
    .prepare("SELECT * FROM analysis_runs WHERE vendor_id = ? AND kind = 'company_verify' ORDER BY id DESC LIMIT 1")
    .get(vendorId);

  let verifyOutcome = null;
  if (lastVerify) {
    try {
      verifyOutcome = JSON.parse(lastVerify.payload).outcome;
    } catch {
      verifyOutcome = lastVerify.outcome;
    }
  }

  const issues = [];
  if (missing.length) issues.push(`Missing documents: ${missing.join(', ')}`);
  if (comparison.outcome === 'Mismatch') issues.push(`Document mismatch: ${comparison.summary}`);
  if (verifyOutcome === 'Mismatch') issues.push('Company registry verification returned a mismatch');

  return {
    vendor,
    checklist,
    missing,
    comparison,
    verify_outcome: verifyOutcome,
    issues,
    status: vendor.status,
    allowed_transitions: TRANSITIONS[vendor.status] || [],
    tasks: getTasks(vendorId),
  };
}

/** Create a follow-up task if an equivalent open one does not already exist. */
function ensureTask(vendorId, { title, priority = 'High', dueDate }) {
  const existing = db
    .prepare("SELECT id FROM tasks WHERE vendor_id = ? AND title = ? AND status = 'Pending'")
    .get(vendorId, title);
  if (existing) return { id: existing.id, created: false };

  const info = db
    .prepare(`INSERT INTO tasks (vendor_id, title, priority, due_date, status) VALUES (?, ?, ?, ?, 'Pending')`)
    .run(vendorId, title, priority, dueDate);
  return { id: Number(info.lastInsertRowid), created: true };
}

function addDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Manually move a vendor to a new status (validated against the transition map). */
function setStatus(vendorId, nextStatus, note = null, { force = false } = {}) {
  const vendor = getVendor(vendorId);
  if (!vendor) return { error: 'not_found' };
  if (!STATUSES.includes(nextStatus)) return { error: `Unknown status "${nextStatus}"` };

  const allowed = TRANSITIONS[vendor.status] || [];
  if (!force && vendor.status !== nextStatus && !allowed.includes(nextStatus)) {
    return { error: `Cannot move from "${vendor.status}" to "${nextStatus}". Allowed: ${allowed.join(', ') || 'none'}` };
  }

  db.prepare("UPDATE vendors SET status = ?, status_reason = ?, updated_at = datetime('now') WHERE id = ?").run(
    nextStatus,
    note,
    vendorId,
  );
  insertStatus.run(vendorId, vendor.status, nextStatus, note);
  return { from: vendor.status, to: nextStatus, note };
}

/**
 * Automatic reaction to detected problems.
 * Only fires when transitioning INTO "Action Required", so repeated checks do
 * not spam the client with duplicate emails.
 */
async function applySystemRules(vendorId, { sendEmailNow = true } = {}) {
  const report = evaluate(vendorId);
  if (!report) return null;

  const hasIssues = report.issues.length > 0;
  const shouldFlag = hasIssues && report.vendor.status !== 'Action Required';
  let transitioned = false;

  if (shouldFlag) {
    const result = setStatus(vendorId, 'Action Required', report.issues.join(' | '), { force: true });
    transitioned = !result.error;
  } else if (!hasIssues && report.vendor.status === 'Action Required' && !report.missing.length) {
    // Issues cleared: hand it back to the reviewer instead of auto-approving.
    const unresolvedCompare = report.comparison.outcome !== 'Mismatch';
    if (unresolvedCompare && report.verify_outcome !== 'Mismatch') {
      setStatus(vendorId, 'Under Review', 'All issues resolved automatically.', { force: true });
      transitioned = true;
    }
  }

  const tasks = [];
  if (hasIssues) {
    tasks.push(
      ensureTask(vendorId, {
        title:
          report.missing.length > 0
            ? `Collect missing document(s): ${report.missing.join(', ')}`
            : 'Resolve verification mismatch with the vendor',
        priority: 'High',
        dueDate: addDays(3),
      }),
    );
  }

  const emailLog = [];
  if (sendEmailNow && report.missing.length) {
    // Only notify about documents the client has not been told about yet.
    const notified = db
      .prepare("SELECT reason FROM emails WHERE vendor_id = ? AND status != 'failed' ORDER BY id DESC")
      .all(vendorId)
      .map((row) => row.reason || '');
    const unannounced = report.missing.filter((docType) => !notified.some((reason) => reason.includes(docType)));

    if (unannounced.length) {
      const { subject, text } = missingDocumentEmail(
        report.vendor,
        unannounced.map((docType) => ({ doc_type: docType })),
      );
      const result = await sendEmail({
        vendorId,
        to: report.vendor.email,
        subject,
        text,
        reason: `Missing document(s): ${unannounced.join(', ')}`,
      });
      emailLog.push(result);
    }
  }

  return {
    transitioned,
    issues: report.issues,
    missing: report.missing,
    tasks,
    emails: emailLog,
    report: evaluate(vendorId),
  };
}

module.exports = {
  STATUSES,
  TRANSITIONS,
  REQUIRED_DOCS,
  evaluate,
  buildChecklist,
  setStatus,
  ensureTask,
  applySystemRules,
  getVendor,
  getDocuments,
  getTasks,
  addDays,
};
