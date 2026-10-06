'use strict';

/**
 * Groq (free tier) - *text* extraction fallback.
 *
 * Groq's free tier currently exposes no vision-capable model, so instead of
 * pretending to OCR images, it is used for what it does well: turning the PDF
 * text layer into structured JSON when Gemini is unavailable or fails.
 * (Images still need Gemini.)
 */

const config = require('../../config');
const { FIELD_KEYS } = require('./local');

const PROMPT = `You extract vendor onboarding fields from the text of a business document.
Return ONLY a JSON object with exactly these keys:
${FIELD_KEYS.join(', ')}
Rules:
- Use null for any field that is genuinely absent from the text.
- Never invent or complete a value; copy it exactly as printed (preserve case for codes).
- bank_account_number: digits only, no spaces. ifsc_code: uppercase.
- Respond with valid JSON only: no markdown fences and no commentary.`;

async function extractWithGroqText(rawText, docType) {
  if (!rawText || !rawText.trim()) {
    throw Object.assign(new Error('Groq text fallback needs a document text layer'), { status: 422 });
  }

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.ai.groqKey}`,
    },
    body: JSON.stringify({
      model: config.ai.groqModel,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: `${PROMPT}\n\nDocument type hint: ${docType || 'vendor document'}\n\n--- DOCUMENT TEXT ---\n${rawText.slice(0, 12000)}`,
        },
      ],
    }),
    signal: AbortSignal.timeout(45000),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const error = new Error(`Groq API error ${response.status}: ${detail.slice(0, 300)}`);
    error.status = response.status;
    throw error;
  }

  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content || '{}';
  const raw = JSON.parse(content.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim());

  const fields = {};
  for (const key of FIELD_KEYS) {
    const value = raw?.[key];
    fields[key] =
      value === null || value === undefined || String(value).trim() === '' || String(value).toLowerCase() === 'null'
        ? null
        : String(value).trim();
  }
  if (fields.bank_account_number) fields.bank_account_number = fields.bank_account_number.replace(/\D/g, '');
  if (fields.ifsc_code) fields.ifsc_code = fields.ifsc_code.toUpperCase();

  return { fields, strategy: `groq:${config.ai.groqModel}` };
}

module.exports = { extractWithGroqText };
