'use strict';

/**
 * Cross-document comparison engine.
 *
 * - normalises company names / codes so "ABC Technologies Pvt Ltd" and
 *   "ABC Technology Pvt Ltd" are compared on their real content,
 * - reports three outcomes per field: match | mismatch | missing,
 * - and highlights fields that disagree with the vendor's own record.
 */

const { TRACKED_FIELDS } = require('../db');

const FIELD_LABELS = {
  company_name: 'Company Name',
  registration_number: 'Registration Number',
  gst_number: 'GST / Tax Number',
  address: 'Address',
  bank_account_number: 'Bank Account Number',
  ifsc_code: 'IFSC Code',
};

const COMPARE_FIELDS = [
  'company_name',
  'registration_number',
  'gst_number',
  'address',
  'bank_account_number',
  'ifsc_code',
];

// Legal-entity tokens that say nothing about *which* company this is.
// Compared as a token set so "Pvt Ltd" and "Private Limited" line up while
// real differences (Technology vs Technologies) still surface as mismatches.
const NAME_STOP_TOKENS = new Set([
  'pvt',
  'private',
  'ltd',
  'limited',
  'llp',
  'plc',
  'inc',
  'corp',
  'corporation',
  'co',
  'the',
  'company',
  'proprietary',
  'gmbh',
  'sa',
]);

function norm(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .toLowerCase()
    .replace(/[.,'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Company-name normalisation: drops legal-entity tokens, keeps the real words. */
function normCompany(value) {
  return norm(value)
    .split(' ')
    .filter((token) => token && !NAME_STOP_TOKENS.has(token))
    .join(' ');
}

function normCode(value) {
  return norm(value).replace(/[\s-]/g, '');
}

function lev(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i += 1) {
    const row = [i];
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = row;
  }
  return prev[n];
}

function similarity(a, b) {
  if (!a && !b) return 1;
  const longest = Math.max(a.length, b.length);
  if (!longest) return 1;
  return 1 - lev(a, b) / longest;
}

/** Decide whether two values for `field` should be treated as the same. */
function valuesMatch(field, rawA, rawB) {
  const a = rawA === null || rawA === undefined ? '' : String(rawA).trim();
  const b = rawB === null || rawB === undefined ? '' : String(rawB).trim();

  if (!a && !b) return { equal: true, reason: 'both empty' };
  if (!a || !b) return { equal: null, reason: 'one side missing' }; // -> "missing", not a mismatch

  if (field === 'company_name') {
    const na = normCompany(a);
    const nb = normCompany(b);
    const sim = similarity(na, nb);
    return { equal: sim >= 0.9, score: sim, reason: sim >= 0.9 ? 'normalised name match' : 'name differs' };
  }
  if (field === 'address') {
    const sim = similarity(norm(a), norm(b));
    return { equal: sim >= 0.7, score: sim, reason: sim >= 0.7 ? 'address similar' : 'address differs' };
  }
  if (['gst_number', 'ifsc_code', 'registration_number', 'bank_account_number'].includes(field)) {
    const equal = normCode(a) === normCode(b);
    return { equal, reason: equal ? 'exact code match' : 'code differs' };
  }
  const equal = norm(a) === norm(b);
  return { equal, reason: equal ? 'exact match' : 'value differs' };
}

function docLabel(doc) {
  return doc.doc_type || `Document #${doc.id}`;
}

function parseExtracted(doc) {
  if (!doc.extracted) return {};
  try {
    const parsed = JSON.parse(doc.extracted);
    return parsed.fields || parsed;
  } catch {
    return {};
  }
}

/**
 * Compare every extracted document against the others and against the vendor record.
 *
 * @returns {{outcome: 'OK'|'Mismatch'|'Incomplete', summary: string, fields: Array, missing: Array}}
 */
function compareDocuments(vendor, documents) {
  const usable = documents.filter((d) => d.extracted && d.extraction_status === 'Extracted');
  const missingDocs = documents.filter((d) => d.status === 'Missing');

  const perDoc = usable.map((doc) => ({ id: doc.id, label: docLabel(doc), values: parseExtracted(doc) }));
  const fields = [];
  let mismatchCount = 0;
  let missingCount = 0;
  let conflictCount = 0;

  for (const field of COMPARE_FIELDS) {
    const vendorValue = vendor ? vendor[field] : null;
    const sources = perDoc
      .map((d) => ({ label: d.label, docId: d.id, value: d.values[field] ?? null }))
      .filter((s) => s.value !== null && String(s.value).trim() !== '');

    const pairwise = [];
    for (let i = 0; i < sources.length; i += 1) {
      for (let j = i + 1; j < sources.length; j += 1) {
        const verdict = valuesMatch(field, sources[i].value, sources[j].value);
        if (verdict.equal === false) {
          pairwise.push({
            left: sources[i],
            right: sources[j],
            score: verdict.score ?? null,
            reason: verdict.reason,
          });
        }
      }
    }

    // Agreement between extracted docs and the vendor form itself.
    const vendorChecks = sources
      .map((s) => ({ source: s, verdict: valuesMatch(field, vendorValue, s.value) }))
      .filter((c) => c.verdict.equal === false);

    const missingIn = perDoc.filter((d) => {
      const v = d.values[field];
      return v === null || v === undefined || String(v).trim() === '';
    });

    if (pairwise.length) mismatchCount += 1;
    if (vendorChecks.length) conflictCount += 1;
    if (sources.length && missingIn.length) missingCount += 1;

    fields.push({
      field,
      label: FIELD_LABELS[field] || field,
      vendor_value: vendorValue ?? null,
      sources,
      status: pairwise.length
        ? 'mismatch'
        : vendorChecks.length
          ? 'conflict'
          : sources.length === 0
            ? 'absent'
            : missingIn.length
              ? 'incomplete'
              : 'match',
      mismatches: pairwise,
      vendor_conflicts: vendorChecks.map((c) => ({
        doc_label: c.source.label,
        doc_id: c.source.docId,
        vendor_value: vendorValue,
        doc_value: c.source.value,
        reason: c.verdict.reason,
      })),
      missing_in: missingIn.map((d) => d.label),
    });
  }

  const hardMismatches = fields.filter((f) => f.status === 'mismatch');
  const vendorConflicts = fields.filter((f) => f.status === 'conflict');

  let outcome = 'OK';
  if (hardMismatches.length || vendorConflicts.length) outcome = 'Mismatch';
  else if (missingDocs.length || missingCount) outcome = 'Incomplete';

  const parts = [];
  if (hardMismatches.length) {
    parts.push(
      `${hardMismatches.length} field mismatch: ${hardMismatches
        .map(
          (f) =>
            `${f.label} ("${f.mismatches[0].left.value}" in ${f.mismatches[0].left.label} vs "${
              f.mismatches[0].right.value
            }" in ${f.mismatches[0].right.label}")`,
        )
        .join('; ')}`,
    );
  }
  if (vendorConflicts.length) {
    parts.push(
      `${vendorConflicts.length} field disagrees with the vendor form: ${vendorConflicts
        .map((f) => `${f.label} (form "${f.vendor_value}" vs doc "${f.vendor_conflicts[0].doc_value}")`)
        .join('; ')}`,
    );
  }
  if (missingDocs.length) parts.push(`Missing documents: ${missingDocs.map((d) => d.doc_type).join(', ')}`);
  if (!parts.length) parts.push('All extracted documents agree with each other and with the vendor record.');

  return {
    outcome,
    summary: parts.join(' | '),
    fields,
    compared_documents: perDoc.map((d) => ({ id: d.id, label: d.label })),
    counts: { mismatches: mismatchCount, vendor_conflicts: conflictCount, incomplete: missingCount },
    missing_documents: missingDocs.map((d) => d.doc_type),
    tracked_fields: TRACKED_FIELDS,
  };
}

module.exports = { compareDocuments, valuesMatch, normCompany, normCode, similarity, COMPARE_FIELDS, FIELD_LABELS };
