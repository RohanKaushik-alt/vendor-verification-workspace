'use strict';

/**
 * End-to-end smoke test for the API (also handy as proof during the demo).
 *
 *   npm run samples     # once - creates data/samples/*.pdf
 *   node scripts/smoke-test.js
 *
 * Covers: create/edit vendor -> upload 3 documents -> AI extraction ->
 * comparison -> company verification -> checklist -> missing-document email ->
 * workflow status -> tasks -> version restore.
 */

const fs = require('fs');
const path = require('path');

const BASE = process.env.API_BASE || 'http://localhost:4000/api';
const samplesDir = path.join(__dirname, '..', 'data', 'samples');

let passed = 0;
let failed = 0;

function check(label, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${label}${detail ? ` :: ${detail}` : ''}`);
  }
}

async function api(method, url, body, headers = {}) {
  const response = await fetch(`${BASE}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: response.status, json };
}

async function upload(vendorId, filePath, docType) {
  const form = new FormData();
  form.append('doc_type', docType);
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
  form.append('file', new Blob([fs.readFileSync(filePath)], { type: mimeTypes[ext] || 'application/pdf' }), path.basename(filePath));
  const response = await fetch(`${BASE}/vendors/${vendorId}/documents`, { method: 'POST', body: form });
  const json = await response.json().catch(() => ({}));
  return { status: response.status, json };
}

async function main() {
  console.log('\n1. Health + provider capabilities');
  const health = await api('GET', '/health');
  check('health responds', health.status === 200 && health.json.ok === true, JSON.stringify(health.json));
  console.log('     providers:', JSON.stringify(health.json.providers));

  console.log('\n2. Vendor create + edit + version history');
  const created = await api('POST', '/vendors', {
    company_name: 'ABC Technologies Pvt Ltd',
    contact_person: 'Ravi Kumar',
    email: 'vendor@abc-technologies.example.com',
    phone: '+91 98765 43210',
    address: '4th Floor, Tech Park, Outer Ring Road, Bengaluru, Karnataka 560103, India',
    registration_number: 'U74999KA2016PTC091234',
    gst_number: '29AABCA1234A1Z5',
    bank_account_number: '50100234567890',
    ifsc_code: 'HDFC0001234',
  });
  check('vendor created (201)', created.status === 201, JSON.stringify(created.json));
  const vendorId = created.json.vendor?.id;

  const edited = await api('PATCH', `/vendors/${vendorId}`, { company_name: 'ABC Technologies Pvt Ltd.' });
  check('edit created version 2', edited.json.version === 2, JSON.stringify(edited.json.changed));

  const versions = await api('GET', `/vendors/${vendorId}/versions`);
  check('two versions stored', versions.json.versions?.length === 2);

  const restored = await api('POST', `/vendors/${vendorId}/versions/1/restore`);
  check('restore works', restored.status === 200 && restored.json.version === 3);

  console.log('\n3. Document upload + AI extraction');
  const files = [
    ['ABC-Registration-Certificate.pdf', 'Registration Certificate'],
    ['ABC-GST-Certificate.pdf', 'GST Certificate'],
    ['ABC-Bank-Document.pdf', 'Bank Document'],
  ];
  const uploads = [];
  for (const [name, docType] of files) {
    const filePath = path.join(samplesDir, name);
    if (!fs.existsSync(filePath)) {
      check(`sample exists (${name})`, false, 'run `npm run samples` first');
      continue;
    }
    const result = await upload(vendorId, filePath, docType);
    const ok = result.status === 201;
    check(`upload + extract ${docType}`, ok, JSON.stringify(result.json).slice(0, 300));
    uploads.push(result.json);
  }

  const extractedCount = uploads.filter((u) => u.document?.extraction_status === 'Extracted').length;
  check('all documents extracted', extractedCount === files.length, `extracted=${extractedCount}`);

  const anyExtracted = uploads.find((u) => u.document?.extraction_status === 'Extracted');
  if (anyExtracted) {
    const fields = anyExtracted.document.extracted?.fields || {};
    check('company name extracted', Boolean(fields.company_name), JSON.stringify(fields));
    check('registration number extracted', Boolean(fields.registration_number), JSON.stringify(fields));
  }

  console.log('\n4. AI cross-document comparison (expects a mismatch)');
  const comparison = await api('POST', `/vendors/${vendorId}/compare`);
  check('comparison runs', comparison.status === 200, JSON.stringify(comparison.json).slice(0, 300));
  check(
    'mismatch detected between registration and GST name',
    comparison.json.comparison?.outcome === 'Mismatch',
    comparison.json.comparison?.summary,
  );
  console.log('     summary:', comparison.json.comparison?.summary);

  console.log('\n5. Company verification API');
  const verify = await api('POST', `/vendors/${vendorId}/verify`, {});
  check('verification runs', verify.status === 200, JSON.stringify(verify.json).slice(0, 300));
  check(
    'outcome is Verified / Mismatch / Unable to Verify',
    ['Verified', 'Mismatch', 'Unable to Verify'].includes(verify.json.verification?.outcome),
    verify.json.verification?.outcome,
  );
  console.log('     outcome:', verify.json.verification?.outcome, '-', verify.json.verification?.message);

  console.log('\n6. Missing document + automated email');
  const beforeList = await api('GET', `/vendors/${vendorId}/checklist`);
  check('checklist has 3 required docs', beforeList.json.checklist?.length === 3);

  // Remove the bank document -> it must be reported Missing and trigger an email.
  const bankDoc = (await api('GET', `/vendors/${vendorId}`)).json.documents?.find(
    (d) => d.doc_type === 'Bank Document',
  );
  if (bankDoc) {
    const removed = await api('DELETE', `/documents/${bankDoc.id}`);
    check('document deleted', removed.status === 200);
    const missing = removed.json.checklist?.find((c) => c.doc_type === 'Bank Document');
    check('checklist now Missing', missing?.status === 'Missing', JSON.stringify(missing));

    const emails = await api('GET', `/vendors/${vendorId}/emails`);
    const sent = emails.json.emails?.find((e) => (e.reason || '').includes('Bank Document'));
    check('missing-document email logged', Boolean(sent), JSON.stringify(emails.json).slice(0, 300));
    if (sent) console.log(`     email -> ${sent.to_email} [${sent.provider}/${sent.status}] "${sent.subject}"`);
  }

  console.log('\n7. Workflow status + automatic Action Required');
  const workspace = await api('GET', `/vendors/${vendorId}`);
  const status = workspace.json.vendor?.status;
  check('auto status is Action Required', status === 'Action Required', status);
  check('allowed transitions exposed', Array.isArray(workspace.json.workflow?.allowed_transitions));

  const tasks = await api('GET', `/vendors/${vendorId}`);
  const pending = (tasks.json.tasks || []).filter((t) => t.status === 'Pending');
  check('follow-up task auto-created', pending.length >= 1, JSON.stringify(tasks.json.tasks));

  const transition = await api('PATCH', `/vendors/${vendorId}/status`, { status: 'Under Review', note: 'Docs re-requested' });
  check('reviewer can move status', transition.status === 200, JSON.stringify(transition.json).slice(0, 200));

  const illegal = await api('PATCH', `/vendors/${vendorId}/status`, { status: 'Approved' });
  check(
    'invalid transition blocked while issues exist',
    illegal.status === 400 || illegal.json.vendor?.status !== 'Approved',
    JSON.stringify(illegal.json).slice(0, 200),
  );

  console.log('\n8. Error handling sanity');
  const missingVendor = await api('GET', '/vendors/999999');
  check('404 for unknown vendor', missingVendor.status === 404);
  const badCreate = await api('POST', '/vendors', { contact_person: 'no name' });
  check('400 for invalid payload', badCreate.status === 400, JSON.stringify(badCreate.json).slice(0, 200));

  console.log('\n9. Resolve issues and approve');
  // a) restore the bank document so the checklist is complete again
  const restoredUpload = await upload(vendorId, path.join(samplesDir, 'ABC-Bank-Document.pdf'), 'Bank Document');
  check('bank document re-uploaded', restoredUpload.status === 201, JSON.stringify(restoredUpload.json).slice(0, 200));

  // b) correct the AI-extracted name on the GST document (the required "edit AI output" flow)
  const gstDoc = (await api('GET', `/vendors/${vendorId}`)).json.documents?.find(
    (d) => d.doc_type === 'GST Certificate',
  );
  const corrected = await api('PATCH', `/documents/${gstDoc.id}`, {
    fields: { company_name: 'ABC Technologies Pvt Ltd' },
  });
  check(
    'extracted values corrected by reviewer',
    corrected.json?.edited === true,
    JSON.stringify(corrected).slice(0, 200),
  );

  // c) re-run the comparison and the verification: no issue must remain
  const recompare = await api('POST', `/vendors/${vendorId}/compare`);
  check(
    'document mismatch resolved',
    recompare.json.comparison?.outcome !== 'Mismatch',
    recompare.json.comparison?.summary,
  );
  await api('POST', `/vendors/${vendorId}/verify`, {});
  const cleared = await api('GET', `/vendors/${vendorId}`);
  check('issues cleared', cleared.json.workflow?.issues?.length === 0, JSON.stringify(cleared.json.workflow?.issues));
  check(
    'status handed back to the reviewer (Under Review)',
    cleared.json.vendor?.status === 'Under Review',
    cleared.json.vendor?.status,
  );

  // d) the reviewer can now approve
  const approved = await api('PATCH', `/vendors/${vendorId}/status`, { status: 'Approved', note: 'All checks passed' });
  check('vendor approved', approved.json.vendor?.status === 'Approved', JSON.stringify(approved.json).slice(0, 200));

  console.log(`\nRESULT: ${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('\nSmoke test crashed:', err.message);
  console.error('Is the API running?  npm run dev  (or: node src/index.js)\n');
  process.exit(1);
});
