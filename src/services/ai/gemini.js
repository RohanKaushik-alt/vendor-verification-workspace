'use strict';

/**
 * Google Gemini document extraction (free-tier API key from AI Studio).
 * Handles images AND PDFs via inline_data, asks for strict JSON back.
 */

const config = require('../../config');
const { FIELD_KEYS } = require('./local');

const SYSTEM_PROMPT = `You extract vendor onboarding fields from a business document.
Return ONLY a JSON object with exactly these keys:
${FIELD_KEYS.join(', ')}
Rules:
- Use null for any field that is genuinely absent from the document.
- Never invent or complete a value; copy it exactly as printed (preserve case for codes).
- company_name: full registered legal name.
- address: the registered / principal address as a single string.
- bank_account_number: digits only, no spaces.
- Respond with valid JSON only, no markdown fences and no commentary.`;

async function callGemini(buffer, mimeType) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    config.ai.geminiModel,
  )}:generateContent?key=${encodeURIComponent(config.ai.geminiKey)}`;

  const body = {
    contents: [
      {
        role: 'user',
        parts: [{ text: SYSTEM_PROMPT }, { inline_data: { mime_type: mimeType, data: buffer.toString('base64') } }],
      },
    ],
    generationConfig: { temperature: 0, responseMimeType: 'application/json' },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45000),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const error = new Error(
      `Gemini API error ${response.status}: ${detail.slice(0, 300) || response.statusText}`,
    );
    error.status = response.status;
    throw error;
  }

  const payload = await response.json();
  const text = payload?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || '')
    .join('')
    .trim();
  if (!text) throw new Error('Gemini returned an empty response (no candidates).');

  try {
    return JSON.parse(text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim());
  } catch {
    throw new Error(`Gemini returned non-JSON output: ${text.slice(0, 200)}`);
  }
}

/** Normalise whatever the model returned into a strict, safe shape. */
function normalise(raw) {
  const fields = {};
  for (const key of FIELD_KEYS) {
    const value = raw?.[key];
    if (value === null || value === undefined || String(value).trim() === '' || String(value).toLowerCase() === 'null') {
      fields[key] = null;
    } else {
      fields[key] = String(value).trim();
    }
  }
  if (fields.bank_account_number) {
    fields.bank_account_number = fields.bank_account_number.replace(/\D/g, '');
  }
  if (fields.ifsc_code) fields.ifsc_code = fields.ifsc_code.toUpperCase();
  return fields;
}

async function extractWithGemini(buffer, mimeType) {
  const raw = await callGemini(buffer, mimeType);
  return { fields: normalise(raw), strategy: `gemini:${config.ai.geminiModel}` };
}

module.exports = { extractWithGemini };
