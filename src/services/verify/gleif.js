'use strict';

/**
 * GLEIF (Global Legal Entity Identifier Foundation) - the free, official
 * register of Legal Entity Identifiers.
 *
 *   docs:  https://api.gleif.org/api/v1/lei-records  (OpenAPI: gleif.org)
 *   auth:  NONE - completely free, no API key, generous rate limits
 *   covers: global; for Indian companies `entity.registeredAs` is the MCA CIN,
 *           plus jurisdiction, legal address, status and incorporation date.
 *
 * It is used as the default company-verification provider when neither
 * OpenCorporates nor Companies House credentials are configured.
 */

const BASE = 'https://api.gleif.org/api/v1';
const { VerifyError } = require('./opencorporates');

const COUNTRY_NAMES = {
  IN: 'India', GB: 'United Kingdom', US: 'United States', DE: 'Germany',
  FR: 'France', SG: 'Singapore', AE: 'United Arab Emirates', JP: 'Japan',
  AU: 'Australia', CA: 'Canada', NL: 'Netherlands', IE: 'Ireland',
};

function formatAddress(address) {
  if (!address) return null;
  const parts = [
    ...(address.addressLines || []),
    address.city,
    address.region,
    address.postalCode,
    COUNTRY_NAMES[address.country] || address.country,
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

/** Does this query look like an identifier (CIN / company number / LEI) rather than a name? */
function looksLikeIdentifier(query) {
  const value = String(query).replace(/\s+/g, '');
  if (/^[A-Za-z0-9]{18,20}$/.test(value) && /\d/.test(value) && value === value.toUpperCase()) return 'lei';
  if (/^[A-Za-z0-9][A-Za-z0-9/\- ]{5,30}$/.test(value) && /\d/.test(value) && !/ [A-Za-z]{4,} /.test(value)) {
    return 'registered_as';
  }
  return null;
}

function toRecord(item) {
  const entity = item?.attributes?.entity || {};
  const address = entity.legalAddress || {};
  return {
    name: entity.legalName?.name || null,
    company_number: entity.registeredAs || null,
    jurisdiction_code: entity.jurisdiction || address.country || null,
    company_type: entity.legalForm?.id || entity.legalForm?.other || null,
    status: entity.status || null,
    incorporation_date: entity.creationDate || null,
    registered_office_address: formatAddress(address),
    lei: item?.id || null,
    category: entity.category || null,
  };
}

async function query(filters, size = 10) {
  const params = new URLSearchParams({ 'page[size]': String(size) });
  for (const [key, value] of Object.entries(filters)) params.set(`filter[${key}]`, value);

  let response;
  try {
    response = await fetch(`${BASE}/lei-records?${params.toString()}`, {
      headers: { Accept: 'application/vnd.api+json' },
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new VerifyError('GLEIF timed out after 15s', 'timeout');
    }
    throw new VerifyError(`Could not reach GLEIF: ${err.message}`, 'network');
  }

  if (response.status === 429) throw new VerifyError('GLEIF rate limit reached (429).', 'rate_limit', 429);
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new VerifyError(`GLEIF error ${response.status}: ${body.slice(0, 160)}`, 'upstream', 502);
  }

  const payload = await response.json();
  return {
    total_count: payload?.meta?.pagination?.total ?? (payload?.data || []).length,
    companies: (payload?.data || []).map(toRecord).filter((record) => record.name),
  };
}

/**
 * Identifier lookup first (exact), then exact legal name, then full-text - so a
 * CIN hits the right entity and an unknown vendor name still gets a real answer.
 */
async function search(value) {
  const term = String(value || '').trim();
  if (!term) return { total_count: 0, companies: [] };

  const identifier = looksLikeIdentifier(term);
  if (identifier === 'lei') {
    const byLei = await query({ lei: term }, 5);
    if (byLei.companies.length) return byLei;
  } else if (identifier === 'registered_as') {
    const byReg = await query({ 'entity.registeredAs': term }, 5);
    if (byReg.companies.length) return byReg;
  }

  const byName = await query({ 'entity.legalName': term }, 10);
  if (byName.companies.length) return byName;

  return query({ fulltext: term }, 10);
}

module.exports = { search, toRecord, formatAddress, looksLikeIdentifier, VerifyError };
