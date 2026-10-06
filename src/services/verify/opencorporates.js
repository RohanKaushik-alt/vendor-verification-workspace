'use strict';

/**
 * OpenCorporates adapter.
 * Docs: https://opencorporates.com/api (a free key is available for
 * non-commercial / evaluation use).
 *
 * Everything that can go wrong is mapped to a typed error so the UI can show
 * "Unable to Verify" instead of a stack trace: invalid key, rate limit,
 * timeout, DNS failure, no match.
 */

const config = require('../../config');

class VerifyError extends Error {
  constructor(message, kind, status) {
    super(message);
    this.kind = kind; // not_found | auth | rate_limit | timeout | network | upstream
    this.status = status || 502;
  }
}

async function search(query, { jurisdiction, extra = {} } = {}) {
  const params = new URLSearchParams({ q: query, per_page: '10' });
  if (config.verify.apiKey) params.set('api_token', config.verify.apiKey);
  const code = jurisdiction || config.verify.jurisdiction;
  if (code) params.set('jurisdiction_code', code);
  for (const [key, value] of Object.entries(extra)) {
    if (value) params.set(key, String(value));
  }

  const url = `${config.verify.baseUrl}/companies/search?${params.toString()}`;
  let response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'VendorVerificationWorkspace/1.0' },
      signal: AbortSignal.timeout(config.verify.timeoutMs),
    });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new VerifyError(`OpenCorporates timed out after ${config.verify.timeoutMs}ms`, 'timeout');
    }
    throw new VerifyError(`Could not reach OpenCorporates: ${err.message}`, 'network');
  }

  if (response.status === 401 || response.status === 403) {
    throw new VerifyError('OpenCorporates rejected the API key (401/403). Check OPENCORPORATES_API_KEY.', 'auth', 401);
  }
  if (response.status === 429) {
    throw new VerifyError('OpenCorporates rate limit reached (429). Try again shortly.', 'rate_limit', 429);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new VerifyError(
      `OpenCorporates error ${response.status}: ${body.slice(0, 200) || response.statusText}`,
      'upstream',
    );
  }

  const payload = await response.json();
  const entries = payload?.companies?.companies || [];
  return {
    total_count: payload?.companies?.total_count ?? entries.length,
    companies: entries.map((entry) => entry.company || entry),
  };
}

module.exports = { search, VerifyError };
