'use strict';

/**
 * Extraction pipeline (tried in order, first success wins):
 *
 *   1. Gemini   - vision + PDF, needs GEMINI_API_KEY (live)
 *   2. Groq     - LLM parse of the PDF text layer, needs GROQ_API_KEY (live)
 *   3. local    - label/regex miner over the PDF text layer (always available)
 *
 * Images (scanned documents) can only be handled by step 1, because the free
 * Groq tier has no vision model; without a Gemini key they return a clear,
 * actionable error instead of a wrong answer.
 */

const config = require('../../config');
const { extractFromText } = require('./local');
const { extractWithGemini } = require('./gemini');
const { extractWithGroqText } = require('./groq');

const IMAGE_MIME = /^image\//;
const PDF_MIME = /^application\/pdf$/;

/** pdf-parse lazily: requiring it is cheap but keeping it out of cold path helps startup. */
let pdfParsePromise;
function loadPdfParse() {
  if (!pdfParsePromise) pdfParsePromise = Promise.resolve(require('pdf-parse'));
  return pdfParsePromise;
}

async function readPdfText(buffer) {
  try {
    const pdfParse = await loadPdfParse();
    // pdf.js takes ownership of the ArrayBuffer it is given, and Node's
    // readFileSync returns buffers carved out of a shared 64KB pool. Passing
    // the pooled buffer directly corrupts every later read, so hand pdf.js a
    // standalone copy instead.
    const standalone = Uint8Array.from(buffer);
    const parsed = await pdfParse(standalone);
    return { text: (parsed.text || '').trim(), pages: parsed.numpages || 0 };
  } catch (err) {
    return { text: '', pages: 0, error: err.message };
  }
}

/**
 * @param {{buffer: Buffer, mimeType: string, docType: string}} input
 * @returns {Promise<{fields: object, strategy: string, warnings: string[], rawText: string|null}>}
 */
async function extractDocument({ buffer, mimeType, docType }) {
  const warnings = [];
  let rawText = null;

  // 1. Read whatever plain text we can get locally (free, instant).
  if (PDF_MIME.test(mimeType)) {
    const { text, error } = await readPdfText(buffer);
    rawText = text || null;
    if (error) warnings.push(`Text layer read failed: ${error}`);
    if (!text) warnings.push('PDF has no selectable text layer (scanned/image document).');
  } else if (IMAGE_MIME.test(mimeType)) {
    warnings.push('Image document: needs a vision-capable AI model for OCR.');
  } else {
    throw Object.assign(new Error(`Unsupported file type "${mimeType}". Upload a PDF, PNG or JPG.`), {
      status: 415,
    });
  }

  // 2. Gemini (vision + PDF) when a key is available.
  if (config.ai.geminiKey) {
    try {
      const result = await extractWithGemini(buffer, mimeType);
      return { ...result, warnings, rawText };
    } catch (err) {
      warnings.push(`Gemini failed (${err.status || 'error'}): ${err.message}`);
    }
  }

  // 3. Groq: LLM parse of the PDF text layer (no vision on the free tier).
  if (config.ai.groqKey && rawText) {
    try {
      const result = await extractWithGroqText(rawText, docType);
      if (Object.values(result.fields).some(Boolean)) {
        return { ...result, warnings, rawText };
      }
      warnings.push('Groq returned no fields from the text layer.');
    } catch (err) {
      warnings.push(`Groq failed (${err.status || 'error'}): ${err.message}`);
    }
  }

  // 4. Offline fallback: label/regex mining over the text layer.
  if (rawText) {
    const result = extractFromText(rawText, docType);
    if (result.strategy.includes('no fields')) {
      const err = new Error(
        config.ai.geminiKey || config.ai.groqKey
          ? 'No fields could be extracted from this document - check the file, or correct the values manually below.'
          : 'No fields could be extracted offline. Add GEMINI_API_KEY to .env (free at https://aistudio.google.com/apikey).',
      );
      err.status = 422;
      err.details = { warnings };
      throw err;
    }
    return {
      ...result,
      warnings: [
        ...warnings,
        config.ai.geminiKey || config.ai.groqKey
          ? 'Extracted with the offline regex extractor (AI responses unusable).'
          : 'Extracted offline (no AI key configured).',
      ],
      rawText,
    };
  }

  const err = new Error(
    config.ai.geminiKey
      ? 'This image document could not be read - Gemini returned no usable response.'
      : 'This document has no readable text and no AI vision key is configured. Add GEMINI_API_KEY to .env (free at https://aistudio.google.com/apikey).',
  );
  err.status = 422;
  err.details = { warnings };
  throw err;
}

module.exports = { extractDocument, readPdfText };
