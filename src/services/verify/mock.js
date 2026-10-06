'use strict';

/**
 * Offline company-registry provider.
 *
 * Used when OPENCORPORATES_API_KEY is not configured so the verification
 * feature (including the company-not-found path) is still demonstrable and
 * testable with zero credentials. Clearly labelled "simulated" in the UI.
 *
 * Add your own entries to extend it.
 */

const fixtures = [
  {
    name: 'ABC Technologies Private Limited',
    company_number: 'U74999KA2016PTC091234',
    jurisdiction_code: 'in',
    company_type: 'private limited company',
    status: 'active',
    incorporation_date: '2016-04-12',
    registered_office_address: '4th Floor, Tech Park, Outer Ring Road, Bengaluru, Karnataka 560103, India',
    aliases: ['ABC Technologies Pvt Ltd', 'ABC Technologies', 'abc technolog pvt ltd'],
  },
  {
    name: 'Zenith Foods LLP',
    company_number: 'AAJ-1234',
    jurisdiction_code: 'in',
    company_type: 'limited liability partnership',
    status: 'active',
    incorporation_date: '2019-01-22',
    registered_office_address: 'Plot 18, MIDC Industrial Area, Pune, Maharashtra 411019, India',
    aliases: ['Zenith Foods LLP', 'Zenith Foods'],
  },
  {
    name: 'Northwind Logistics Limited',
    company_number: '09876543',
    jurisdiction_code: 'gb',
    company_type: 'private limited company',
    status: 'active',
    incorporation_date: '2015-11-02',
    registered_office_address: '12 Harbour Street, Manchester, M1 2AB, United Kingdom',
    aliases: ['Northwind Logistics Ltd', 'Northwind Logistics'],
  },
];

function norm(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\b(pvt|private|limited|ltd|llp|inc|corp|company|co|the|technolog|technologies)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function matches(fixture, query) {
  const q = norm(query);
  const raw = String(query || '').trim();
  if (!q && !raw) return false;
  // Exact registration-number match (case-insensitive) counts as a hit.
  if (raw && fixture.company_number && fixture.company_number.toLowerCase() === raw.toLowerCase()) return true;
  if (norm(fixture.name) === q) return true;
  return fixture.aliases.some((alias) => {
    const a = norm(alias);
    return a === q || (q.length > 3 && (a.includes(q) || q.includes(a)));
  });
}

function search(query) {
  const hits = fixtures.filter((f) => matches(f, query));
  return {
    total_count: hits.length,
    companies: hits.map(({ aliases, ...company }) => company),
  };
}

module.exports = { search, fixtures };
