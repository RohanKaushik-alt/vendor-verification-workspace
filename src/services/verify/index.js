'use strict';

/**
 * Company verification service - a chain of registry providers.
 *
 *   VERIFY_PROVIDER = auto (default)
 *       -> OpenCorporates   (when OPENCORPORATES_API_KEY is set)
 *       -> Companies House  (when COMPANIES_HOUSE_API_KEY is set)
 *       -> GLEIF            (free, official, no API key)      <- always available
 *   VERIFY_PROVIDER = opencorporates | companies_house | gleif | mock   (force one)
 *
 * Every provider is asked the same two questions in order (most precise first):
 *   1. exact registration number / CIN / LEI
 *   2. company name (exact, then fuzzy)
 * The first provider that actually finds a record answers; if all of them fail
 * the report says "Unable to Verify" and why - never a silent success.
 *
 * Result vocabulary required by the assessment: Verified | Mismatch | Unable to Verify
 */

const config = require('../../config');
const { valuesMatch } = require('../compare');
const oc = require('./opencorporates');
const gleif = require('./gleif');
const companiesHouse = require('./companies_house');
const mock = require('./mock');

const PROVIDER_LABELS = {
  opencorporates: 'OpenCorporates',
  companies_house: 'Companies House',
  gleif: 'GLEIF',
  mock: 'the offline registry',
};

/** Ordered list of providers to try for the current configuration. */
function providerChain() {
  return config.verifyChain();
}

function activeProvider() {
  return providerChain()[0];
}

function searchWith(provider, value) {
  switch (provider) {
    case 'opencorporates':
      return oc.search(value, {});
    case 'companies_house':
      return companiesHouse.search(value, config.verify.chApiKey);
    case 'gleif':
      return gleif.search(value);
    case 'mock':
      return mock.search(value);
    default:
      throw Object.assign(new Error(`Unknown verification provider "${provider}"`), { status: 500 });
  }
}

/**
 * Ranks registry hits. `targetName` is what the *search* asked for (a query
 * override, e.g. "HDFC Bank Limited"), so a user-typed name picks the entity
 * with that name instead of the one that happens to look like the vendor.
 */
function pickBest(vendor, companies, targetName) {
  const rankName = targetName || vendor.company_name;
  const scored = companies.map((company) => {
    const rankCheck = valuesMatch('company_name', rankName, company.name);
    const nameCheck = valuesMatch('company_name', vendor.company_name, company.name);
    const numberCheck = vendor.registration_number
      ? valuesMatch('registration_number', vendor.registration_number, company.company_number)
      : null;
    const score =
      (rankCheck.equal === true ? 3 : 0) +
      (rankCheck.score ?? 0) * 2 +
      (nameCheck.equal === true ? 2 : 0) +
      (nameCheck.score ?? 0) +
      (numberCheck ? (numberCheck.equal === true ? 2 : -1) : 0);
    return { company, score, nameCheck, numberCheck };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0];
}

function buildReport(vendor, provider, searchQuery, result, { tried = [], targetName } = {}) {
  const label = PROVIDER_LABELS[provider] || provider;

  if (!result.companies.length) {
    return {
      outcome: 'Unable to Verify',
      reason: 'not_found',
      message:
        tried.length > 1
          ? `No company found for "${searchQuery}" on ${tried.map((p) => PROVIDER_LABELS[p]).join(', ')}.`
          : `No company found on ${label} for "${searchQuery}".`,
      provider,
      chain_tried: tried.length ? tried : [provider],
      simulated: provider === 'mock',
      query: searchQuery,
      total_count: 0,
      candidate: null,
      checks: [],
    };
  }

  const best = pickBest(vendor, result.companies, targetName);
  const company = best.company;

  const checks = [
    {
      field: 'company_name',
      label: 'Company Name',
      vendor_value: vendor.company_name,
      api_value: company.name,
      result: best.nameCheck.equal === true ? 'match' : best.nameCheck.equal === false ? 'mismatch' : 'unknown',
      score: best.nameCheck.score ?? null,
    },
  ];

  if (vendor.registration_number) {
    checks.push({
      field: 'registration_number',
      label: 'Registration Number',
      vendor_value: vendor.registration_number,
      api_value: company.company_number || null,
      result: !best.numberCheck
        ? 'not_available'
        : best.numberCheck.equal === true
          ? 'match'
          : 'mismatch',
    });
  }

  if (vendor.address && company.registered_office_address) {
    const addressCheck = valuesMatch('address', vendor.address, company.registered_office_address);
    checks.push({
      field: 'address',
      label: 'Address',
      vendor_value: vendor.address,
      api_value: company.registered_office_address,
      result: addressCheck.equal === true ? 'match' : addressCheck.equal === false ? 'mismatch' : 'unknown',
      score: addressCheck.score ?? null,
    });
  }

  const mismatches = checks.filter((c) => c.result === 'mismatch');
  const matches = checks.filter((c) => c.result === 'match');

  let outcome = 'Unable to Verify';
  if (mismatches.length) outcome = 'Mismatch';
  else if (matches.length) outcome = 'Verified';

  return {
    outcome,
    reason: mismatches.length ? 'field_mismatch' : matches.length ? 'matched' : 'insufficient_data',
    message: mismatches.length
      ? `Registry data differs from the vendor record: ${mismatches.map((c) => c.label).join(', ')}.`
      : matches.length
        ? `Matched ${matches.length} field(s) against ${label}.`
        : `Company found on ${label}, but no comparable field was returned.`,
    provider,
    chain_tried: tried.length ? tried : [provider],
    simulated: provider === 'mock',
    query: searchQuery,
    total_count: result.total_count,
    candidate: {
      name: company.name,
      company_number: company.company_number,
      jurisdiction_code: company.jurisdiction_code,
      company_type: company.company_type,
      status: company.status,
      incorporation_date: company.incorporation_date,
      registered_office_address: company.registered_office_address,
      lei: company.lei || null,
    },
    checks,
  };
}

/** Error report used when every provider in the chain failed technically. */
function errorReport(provider, searchQuery, err, tried) {
  return {
    outcome: 'Unable to Verify',
    reason: err.kind || 'upstream',
    message: err.message,
    provider,
    chain_tried: tried,
    simulated: false,
    query: searchQuery,
    total_count: 0,
    candidate: null,
    checks: [],
    error: { kind: err.kind || 'upstream', status: err.status || 502 },
  };
}

/**
 * @param {object} vendor  vendor row
 * @param {string} [query] search term override (defaults to reg. number, then name)
 * @returns {Promise<object>} verification report
 */
async function verifyCompany(vendor, query) {
  if (!vendor.company_name && !vendor.registration_number) {
    const err = new Error('Vendor needs a company name or a registration number before verification.');
    err.status = 400;
    throw err;
  }

  const chain = providerChain();
  const baseQuery = (query || '').trim();
  // When a search term is supplied, registry hits are ranked against *it*;
  // otherwise against the vendor's own name.
  const targetName = baseQuery || vendor.company_name || null;

  // Most precise identifier first (registration number), then the name, so a
  // registry that indexes by name still returns the right entity.
  const candidates = baseQuery
    ? [baseQuery]
    : [vendor.registration_number, vendor.company_name].filter(
        (value, index, all) => value && all.indexOf(value) === index,
      );

  const errors = [];
  let lastQuery = candidates[0];
  let lastResult = { total_count: 0, companies: [] };
  let lastProvider = chain[0];

  for (const provider of chain) {
    for (const candidate of candidates) {
      try {
        const result = await searchWith(provider, candidate);
        lastQuery = candidate;
        lastResult = result;
        lastProvider = provider;
        if (result.companies.length) {
          return buildReport(vendor, provider, candidate, result, { tried: [provider], targetName });
        }
      } catch (err) {
        if (err instanceof oc.VerifyError) {
          errors.push({ provider, message: err.message, kind: err.kind });
        } else {
          throw err;
        }
      }
    }
  }

  if (errors.length === chain.length) {
    // Every provider failed technically (auth / rate limit / network).
    const worst = errors[errors.length - 1];
    return errorReport(lastProvider, lastQuery, new oc.VerifyError(worst.message, worst.kind), errors.map((e) => e.provider));
  }

  // Providers answered, they simply have no such company.
  return buildReport(vendor, lastProvider, lastQuery, lastResult, { tried: chain, targetName });
}

module.exports = { verifyCompany, activeProvider, providerChain, pickBest, buildReport };
