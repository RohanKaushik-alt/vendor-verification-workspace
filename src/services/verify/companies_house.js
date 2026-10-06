'use strict';

/**
 * UK Companies House - the official company registry for England & Wales.
 *
 *   docs:  https://developer.company-information.service.gov.uk
 *   auth:  free API key (register in ~30 seconds) - Basic auth, key as username
 *   covers: UK companies with real company numbers, registered addresses,
 *           incorporation dates and company status.
 *
 * Only used when COMPANIES_HOUSE_API_KEY is present.
 */

const BASE = 'https://api.company-information.service.gov.uk';
const { VerifyError } = require('./opencorporates');

function formatAddress(address) {
  if (!address) return null;
  const parts = [
    ...(address.address_line_1 ? [address.address_line_1] : []),
    ...(address.address_line_2 ? [address.address_line_2] : []),
    address.locality,
    address.region,
    address.postal_code,
    'United Kingdom',
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

async function call(path, apiKey) {
  const auth = Buffer.from(`${apiKey}:`).toString('base64');
  let response;
  try {
    response = await fetch(`${BASE}${path}`, {
      headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new VerifyError('Companies House timed out after 15s', 'timeout');
    }
    throw new VerifyError(`Could not reach Companies House: ${err.message}`, 'network');
  }

  if (response.status === 401 || response.status === 403) {
    throw new VerifyError(
      'Companies House rejected the credentials (401). Check COMPANIES_HOUSE_API_KEY.',
      'auth',
      401,
    );
  }
  if (response.status === 429) {
    throw new VerifyError('Companies House rate limit reached (6/day on some tiers).', 'rate_limit', 429);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new VerifyError(`Companies House error ${response.status}: ${body.slice(0, 160)}`, 'upstream', 502);
  }
  return response.json();
}

function toRecord(item) {
  return {
    name: item.title || null,
    company_number: item.company_number || null,
    jurisdiction_code: 'gb',
    company_type: item.type || null,
    status: item.company_status || null,
    incorporation_date: item.date_of_creation || null,
    registered_office_address: formatAddress(item.address),
  };
}

async function search(value, apiKey) {
  const term = String(value || '').trim();
  if (!term) return { total_count: 0, companies: [] };

  const payload = await call(
    `/search/companies?q=${encodeURIComponent(term)}&items_per_page=10`,
    apiKey,
  );
  const items = payload.items || [];
  return {
    total_count: payload.total_count ?? items.length,
    companies: items.map(toRecord).filter((record) => record.name),
  };
}

module.exports = { search, toRecord, formatAddress };
