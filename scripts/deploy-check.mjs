'use strict';
/**
 * Full-stack E2E check against a *deployed* instance.
 *
 *   BASE=https://vendor-verification-workspace-5ty8.onrender.com node scripts/deploy-check.mjs
 *
 * Creates a temporary vendor, uploads the 3 sample PDFs (live AI extraction),
 * runs the cross-document comparison and the registry verification, then
 * deletes the vendor again so the deployed demo state stays pristine.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.CHECK_BASE || 'https://vendor-verification-workspace-5ty8.onrender.com';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
const ok = (label, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? `  (${extra})` : ''}`);
  if (!cond) failures += 1;
};

const json = async (url, init) => {
  const res = await fetch(`${BASE}${url}`, init);
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
};

console.log(`target: ${BASE}`);

// 0. health / providers
const health = await json('/api/health');
ok('health responds', health.status === 200 && health.body.ok === true);
ok('AI provider live', health.body.providers?.ai?.mode === 'live', JSON.stringify(health.body.providers?.ai));
ok('verification live', health.body.providers?.verify?.mode === 'live', JSON.stringify(health.body.providers?.verify));
ok('email provider live', health.body.providers?.email?.mode === 'live', JSON.stringify(health.body.providers?.email));

// 1. temporary vendor
const created = await json('/api/vendors', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    company_name: 'ABC Technologies Pvt Ltd',
    contact_person: 'Deploy Check',
    email: 'check@example.com',
    phone: '+91 00000 00000',
    address: '4th Floor, Tech Park, Outer Ring Road, Bengaluru, Karnataka 560103, India',
    registration_number: 'U74999KA2016PTC091234',
    gst_number: '29AABCA1234A1Z5',
    bank_account_number: '50100234567890',
    ifsc_code: 'HDFC0001234',
  }),
});
ok('vendor created', created.status === 201, `status=${created.status}`);
const vendorId = created.body.vendor?.id ?? created.body.id;
ok('vendor id returned', Boolean(vendorId), `id=${vendorId}`);

let vendorCreated = Boolean(vendorId);
try {
  // 2. upload the three sample documents (live AI extraction on the server)
  const docs = [
    ['data/samples/ABC-Registration-Certificate.pdf', 'Registration Certificate'],
    ['data/samples/ABC-GST-Certificate.pdf', 'GST Certificate'],
    ['data/samples/ABC-Bank-Document.pdf', 'Bank Document'],
  ];
  for (const [file, docType] of docs) {
    const form = new FormData();
    form.append('doc_type', docType);
    form.append('file', new Blob([fs.readFileSync(path.join(root, file))], { type: 'application/pdf' }), path.basename(file));
    const res = await json(`/api/vendors/${vendorId}/documents`, { method: 'POST', body: form });
    ok(`upload ${docType}`, res.status === 201, `status=${res.status} ${JSON.stringify(res.body).slice(0, 160)}`);
  }

  const detail = await json(`/api/vendors/${vendorId}`);
  for (const doc of detail.body.documents || []) {
    const fields = Object.entries(doc.extracted?.fields || {}).filter(([, v]) => v);
    ok(`AI extraction ${doc.doc_type}`, fields.length >= 1, `via=${doc.extracted?.source} fields=${fields.map(([k]) => k).join(',')}`);
  }

  // 3. cross-document comparison
  const cmp = await json(`/api/vendors/${vendorId}/compare`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  const mismatch = (cmp.body.comparison?.fields || []).find((f) => f.status === 'mismatch');
  ok('cross-document mismatch detected', Boolean(mismatch), cmp.body.comparison?.summary);

  // 4. registry verification (GLEIF, keyless)
  const v1 = await json(`/api/vendors/${vendorId}/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  ok('verify fictional vendor -> Unable to Verify', v1.body.verification?.outcome === 'Unable to Verify', `provider=${v1.body.verification?.provider}`);

  const v2 = await json(`/api/vendors/${vendorId}/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'HDFC Bank Limited' }),
  });
  ok('verify real company -> found', ['Verified', 'Mismatch'].includes(v2.body.verification?.outcome), `outcome=${v2.body.verification?.outcome} record=${v2.body.verification?.candidate?.name}`);

  // 5. workflow side effects
  const after = await json(`/api/vendors/${vendorId}`);
  const status = after.body.workflow?.status;
  ok('auto workflow rule fired', status === 'Action Required', `status=${status}`);
  ok('follow-up task created', (after.body.tasks || []).length >= 1, `${(after.body.tasks || []).length} task(s)`);
} finally {
  // 6. clean up so the demo starts from the seeded state
  if (vendorCreated) {
    const del = await json(`/api/vendors/${vendorId}`, { method: 'DELETE' });
    ok('temporary vendor removed', del.status === 200 || del.status === 204, `status=${del.status}`);
  }
}

console.log(failures === 0 ? '\nRESULT: all production checks passed' : `\nRESULT: ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
