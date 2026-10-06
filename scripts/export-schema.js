'use strict';

/** Dumps the live database structure (tables + indexes) to db/schema.exported.sql. */

const fs = require('fs');
const path = require('path');
const { db } = require('../src/db');

const rows = db
  .prepare(
    `SELECT type, name, sql FROM sqlite_master
     WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
     ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, name`,
  )
  .all();

const header = `-- Auto-generated from the live database by scripts/export-schema.js
-- Generated: ${new Date().toISOString()}
-- Database: ${path.basename(process.env.DB_PATH || 'data/app.db')}

PRAGMA foreign_keys = ON;

`;

const body = rows.map((row) => `${row.sql};\n`).join('\n');
const outPath = path.join(__dirname, '..', 'db', 'schema.exported.sql');
fs.writeFileSync(outPath, header + body);
console.log(`wrote ${outPath} (${rows.length} objects)`);
