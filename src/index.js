'use strict';

/**
 * Vendor Verification Workspace - API entry point.
 *
 *   node src/index.js        (or `npm run dev` for API + Vite together)
 */

const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');

const config = require('./config');
require('./db'); // applies db/schema.sql on boot

const { errorHandler } = require('./http');
const vendorsRouter = require('./routes/vendors');
const documentsRouter = require('./routes/documents');
const analysisRouter = require('./routes/analysis');

const app = express();
app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// --- API -------------------------------------------------------------------
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    time: new Date().toISOString(),
    providers: config.capabilities(),
  });
});

app.use('/api/vendors', vendorsRouter);
app.use('/api', analysisRouter);
app.use('/api', documentsRouter);

app.use('/api', (req, res) => res.status(404).json({ error: `Unknown API route ${req.method} ${req.originalUrl}` }));
app.use(errorHandler);

// --- Static frontend (production build) ------------------------------------
const distDir = path.join(config.root, 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

app.listen(config.port, () => {
  const caps = config.capabilities();
  console.log(`\n  Vendor Verification Workspace`);
  console.log(`  API      http://localhost:${config.port}/api/health`);
  console.log(`  AI       ${caps.ai.provider} (${caps.ai.mode})`);
  console.log(`  Verify   ${caps.verify.provider} (${caps.verify.mode})`);
  console.log(`  Email    ${caps.email.provider} (${caps.email.mode})`);
  if (caps.ai.mode === 'offline') {
    console.log(`  -> no GEMINI_API_KEY found: using the offline document extractor.`);
  }
  console.log('');
});

module.exports = app;
