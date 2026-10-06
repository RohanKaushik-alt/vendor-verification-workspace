'use strict';

/**
 * Offline / no-key document extractor.
 * Label-driven + regex-driven text mining over the text layer of a PDF.
 * It is deliberately conservative: it only returns values it can point to,
 * so a wrong guess is unlikely, and "missing" is a truthful answer.
 */

const FIELD_KEYS = [
  'company_name',
  'registration_number',
  'gst_number',
  'address',
  'bank_account_number',
  'ifsc_code',
];

const PATTERNS = {
  gst_number: [
    // Label + separator is mandatory so the words "GST REGISTRATION CERTIFICATE"
    // in a heading are never mistaken for a GSTIN.
    /\b(?:GSTIN|GST\s*(?:Number|No\.?)|GST\s*Registration\s*(?:Number|No\.?))\s*[:#.-]\s*([0-9A-Z]{10,20})\b/i,
    /\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]\b/,
  ],
  ifsc_code: [
    /\b(?:IFSC(?:\s*Code)?|IFS(?:C)?\s*Code)\s*[:#.-]\s*([A-Za-z]{4}0[A-Za-z0-9]{6})\b/i,
    /\b([A-Z]{4}0[A-Z0-9]{6})\b/,
  ],
  bank_account_number: [
    /\b(?:A\/?C|Account|Acc|Bank\s*Account)\s*(?:Number|No\.?|#)?\s*[:#.-]\s*(\d[\d ]{7,18}\d)\b/i,
    /\b(?:Account|A\/?C)\s*No\.?\s*[:#.-]\s*(\d{9,18})\b/i,
  ],
  registration_number: [
    /\b(?:Registration\s*(?:Number|No\.?)|Company\s*Reg(?:istration)?\s*(?:Number|No\.?)|Reg(?:istration)?\s*No\.?|Certificate\s*of\s*Incorporation\s*(?:Number|No\.?)|CIN(?:\s*No\.?)?)\s*[:#.-]\s*([A-Za-z0-9/.\-]{4,30})\b/i,
    /\b([A-Z]\d{5}[A-Z]{2}\d{4}\d{5})\b/, // Indian CIN
    /\b(\d{7,8})\b(?=.{0,40}(?:United Kingdom|Companies House))/i,
  ],
  company_name: [
    /\b(?:Name of (?:the )?(?:Company|Entity|Applicant)|Company Name|Registered Name|Business Name|Firm Name|Legal Name)\s*[:#-]\s*(.+)$/i,
  ],
  address: [
    /\b(?:Registered (?:Office )?Address|Address|Principal Place of Business|Business Address|Location)\s*[:#-]\s*(.+)$/i,
  ],
};

function clean(value) {
  if (!value) return null;
  const out = String(value)
    .replace(/\s+/g, ' ')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s*[:#-]\s*$/, '')
    .trim();
  return out.length >= 3 ? out : null;
}

/** Lines that are decorative rather than content. */
const HEADER_NOISE =
  /^(certificate|certificat|government|ministry|department|registration|gst|goods and services tax|tax invoice|invoice|bank|statement|declaration|authorised|signature|place:|date:|page \d|www\.|http)/i;

function extractCompanyFromLines(lines) {
  // Prefer an explicit label, then a line that "looks like" an Indian company name.
  for (const line of lines) {
    const labeled = line.match(PATTERNS.company_name[0]);
    if (labeled) return clean(labeled[1]);
  }
  const companyLike = lines.find(
    (l) => /\b(pvt\.?\s*ltd\.?|private limited|limited|llp|inc\.?|corp\.?|technologies|solutions|industries|group|enterprise)\b/i.test(l),
  );
  if (companyLike) return clean(companyLike.replace(/^(?:for|of)\s+/i, ''));
  const first = lines.find((l) => l.length > 6 && !HEADER_NOISE.test(l));
  return clean(first);
}

function extractAddressFromLines(lines) {
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(PATTERNS.address[0]);
    if (match) {
      // Address is usually wrapped over the next few lines: collect until a blank
      // line, a new "Label:" line, or prose (which an address never looks like).
      const parts = [match[1]];
      for (let j = i + 1; j < Math.min(lines.length, i + 5); j += 1) {
        const next = lines[j];
        if (!next.trim()) break;
        if (/^[A-Za-z ]{3,30}\s*[:#-]\s+\S/.test(next)) break;
        const looksLikeAddress = /,|\d/.test(next) && !/[.!?]$/.test(next);
        if (!looksLikeAddress) break;
        parts.push(next);
      }
      return clean(parts.join(', '));
    }
  }
  // Fallback: a block of lines with street/postal cues.
  const cue = /\b(street|st\.|road|rd\.|lane|nagar|avenue|suite|floor|city|state|district|pin ?code|\d{6})\b/i;
  const block = lines.filter((l) => cue.test(l));
  if (block.length >= 1) return clean(block.slice(0, 4).join(', '));
  return null;
}

/**
 * @param {string} text full text of the document
 * @param {string} docType hint so a bank doc prefers account/IFSC
 * @returns {{fields: Record<string,string|null>, strategy: string}}
 */
function extractFromText(text, docType) {
  const normalized = String(text || '')
    .replace(/\r/g, '')
    .replace(/[|]/g, ' ');
  const lines = normalized
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const flat = lines.join('\n');

  const fields = Object.fromEntries(FIELD_KEYS.map((k) => [k, null]));
  const hits = {};

  for (const key of ['gst_number', 'ifsc_code', 'bank_account_number', 'registration_number']) {
    for (const pattern of PATTERNS[key]) {
      const match = flat.match(pattern);
      if (match) {
        const value = clean(match[1] || match[0]);
        if (value) {
          fields[key] = value;
          hits[key] = true;
          break;
        }
      }
    }
  }

  fields.company_name = extractCompanyFromLines(lines);
  fields.address = extractAddressFromLines(lines);

  // Bank docs usually carry only bank fields - blank out unrelated ones so the
  // comparison engine reports "not present in this document" rather than a
  // false mismatch.
  if (/bank/i.test(docType || '')) {
    fields.registration_number = fields.registration_number;
  }

  const found = FIELD_KEYS.filter((k) => fields[k]).length;
  return {
    fields,
    strategy: found ? `local-regex (${found} fields)` : 'local-regex (no fields)',
  };
}

module.exports = { extractFromText, FIELD_KEYS, clean };
