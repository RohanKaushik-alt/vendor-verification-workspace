'use strict';

const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const root = path.join(__dirname, '..');

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const config = {
  port: num(process.env.PORT, 4000),
  root,
  dbPath: path.resolve(root, process.env.DB_PATH || 'data/app.db'),
  uploadDir: path.resolve(root, process.env.UPLOAD_DIR || 'data/uploads'),

  ai: {
    geminiKey: (process.env.GEMINI_API_KEY || '').trim(),
    geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    // Groq has no vision-capable model on the free tier, so it is used as a
    // *text* fallback: it parses the PDF text layer when Gemini is unavailable.
    groqKey: (process.env.GROQ_API_KEY || '').trim(),
    groqModel: process.env.GROQ_MODEL || 'qwen/qwen3.8-27b',
  },

  verify: {
    apiKey: (process.env.OPENCORPORATES_API_KEY || '').trim(),
    chApiKey: (process.env.COMPANIES_HOUSE_API_KEY || '').trim(),
    provider: (process.env.VERIFY_PROVIDER || 'auto').toLowerCase(),
    // auto | opencorporates | companies_house | gleif | mock
    jurisdiction: (process.env.OC_JURISDICTION || '').trim(),
    baseUrl: 'https://api.opencorporates.com/v0.4',
    timeoutMs: num(process.env.VERIFY_TIMEOUT_MS, 10000),
  },

  email: {
    provider: (process.env.EMAIL_PROVIDER || 'auto').toLowerCase(), // auto | resend | smtp | log
    resendKey: (process.env.RESEND_API_KEY || '').trim(),
    from: process.env.EMAIL_FROM || 'Vendor Verification <onboarding@resend.dev>',
    smtp: {
      host: process.env.SMTP_HOST || '',
      port: num(process.env.SMTP_PORT, 587),
      secure: process.env.SMTP_SECURE === 'true',
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASS || '',
    },
  },
};

/** Capability report used by GET /api/health and the UI banner. */
config.capabilities = function capabilities() {
  const emailProvider =
    config.email.provider === 'auto'
      ? config.email.resendKey
        ? 'resend'
        : config.email.smtp.host && config.email.smtp.user
          ? 'smtp'
          : 'log'
      : config.email.provider;

  const verifyProvider =
    config.verify.provider === 'auto'
      ? config.verify.apiKey
        ? 'opencorporates'
        : config.verify.chApiKey
          ? 'companies_house'
          : 'gleif'
      : config.verify.provider;

  return {
    ai: {
      provider: config.ai.geminiKey ? 'gemini' : config.ai.groqKey ? 'groq' : 'local-extractor',
      model: config.ai.geminiKey
        ? config.ai.geminiModel
        : config.ai.groqKey
          ? config.ai.groqModel
          : null,
      mode: config.ai.geminiKey ? 'live' : config.ai.groqKey ? 'text-only' : 'offline',
      fallbacks: ['gemini', 'groq', 'local-extractor'].filter((name) => name !== (config.ai.geminiKey ? 'gemini' : config.ai.groqKey ? 'groq' : 'local-extractor')),
    },
    verify: {
      provider: verifyProvider,
      chain: config.verifyChain(),
      mode: verifyProvider === 'mock' ? 'simulated' : 'live',
      hasKey: Boolean(config.verify.apiKey || config.verify.chApiKey),
    },
    email: {
      provider: emailProvider,
      mode: emailProvider === 'log' ? 'simulated' : 'live',
      from: config.email.from,
    },
  };
};

/**
 * Ordered list of company-registry providers for the current configuration.
 * Each entry is tried in turn; the first one that finds a record answers.
 */
config.verifyChain = function verifyChain() {
  const requested = config.verify.provider;
  if (requested && requested !== 'auto') return [requested];
  const chain = [];
  if (config.verify.apiKey) chain.push('opencorporates');
  if (config.verify.chApiKey) chain.push('companies_house');
  chain.push('gleif');
  return chain;
};

module.exports = config;
