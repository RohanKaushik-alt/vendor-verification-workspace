'use strict';
/** Ad-hoc live check of the full pipeline against the running dev server. */
const BASE = 'http://localhost:4000';
const fs = await import('node:fs');
const path = await import('node:path');

const ok = (label, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? `  (${extra})` : ''}`);
  if (!cond) process.exitCode = 1;
};

// 1. Upload the three sample documents to vendor 1.
const docs = [
  ['data/samples/ABC-Registration-Certificate.pdf', 'Registration Certificate'],
  ['data/samples/ABC-GST-Certificate.pdf', 'GST Certificate'],
  ['data/samples/ABC-Bank-Document.pdf', 'Bank Document'],
];
const uploaded = [];
for (const [file, docType] of docs) {
  const form = new FormData();
  form.append('doc_type', docType);
  form.append('file', new Blob([fs.readFileSync(file)], { type: 'application/pdf' }), path.basename(file));
  const res = await fetch(`${BASE}/api/vendors/1/documents`, { method: 'POST', body: form });
  const body = await res.json().catch(() => ({}));
  if (res.status !== 409) ok(`upload ${docType}`, res.ok, `status=${res.status} ${JSON.stringify(body).slice(0, 300)}`);
  if (body.document) uploaded.push(body.document);
}

// 2. Extraction results (Gemini live).
const list = await (await fetch(`${BASE}/api/vendors/1`)).json();
for (const doc of list.documents || []) {
  const got = Object.entries(doc.extracted?.fields || {}).filter(([, v]) => v);
  ok(
    `extraction ${doc.doc_type}`,
    got.length >= 1,
    `via=${doc.extracted?.source || '?'} fields=${got.map(([k]) => k).join(',') || 'none'} status=${doc.extraction_status}`,
  );
}

// 3. Cross-document comparison.
const cmp = await (await fetch(`${BASE}/api/vendors/1/compare`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json();
const fields = cmp.comparison?.fields || [];
ok(
  'compare finds name mismatch',
  fields.some((f) => f.field === 'company_name' && f.status === 'mismatch'),
  cmp.comparison?.summary,
);

// 4. Verify fictional vendor -> GLEIF finds nothing.
const v1 = await (await fetch(`${BASE}/api/vendors/1/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json();
ok('verify ABC -> Unable to Verify', v1.verification?.outcome === 'Unable to Verify', `provider=${v1.verification?.provider} reason=${v1.verification?.reason} msg=${v1.verification?.message}`);

// 5. Verify real vendor (HDFC Bank Limited) -> GLEIF record.
const v2 = await (await fetch(`${BASE}/api/vendors/2/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json();
ok('verify HDFC -> Verified', v2.verification?.outcome === 'Verified', `provider=${v2.verification?.provider} outcome=${v2.verification?.outcome} msg=${v2.verification?.message} checks=${JSON.stringify((v2.verification?.checks || []).map((c) => `${c.label}:${c.result}`))}`);

// 6. Query override on vendor 1 with the real company (UI input we added).
const v1override = await (await fetch(`${BASE}/api/vendors/1/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: 'HDFC Bank Limited' }) })).json();
ok('query override works', ['Verified', 'Mismatch', 'Unable to Verify'].includes(v1override.verification?.outcome), `outcome=${v1override.verification?.outcome} q=${v1override.verification?.query}`);

console.log(JSON.stringify({ vendor1: v1.verification?.outcome, vendor2: v2.verification?.outcome, override: v1override.verification?.outcome }));
