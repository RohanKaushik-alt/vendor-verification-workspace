-- Auto-generated from the live database by scripts/export-schema.js
-- Generated: 2026-10-06T03:51:36.847Z
-- Database: app.db

PRAGMA foreign_keys = ON;

CREATE TABLE analysis_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id   INTEGER NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('ai_compare','company_verify')),
  outcome     TEXT,                               -- OK | Mismatch | Unable to Verify | Error
  summary     TEXT,
  payload     TEXT NOT NULL,                      -- JSON result
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE documents (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id          INTEGER NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  doc_type           TEXT NOT NULL,               -- Registration Certificate | GST Certificate | Bank Document
  original_name      TEXT NOT NULL,
  stored_name        TEXT NOT NULL,
  mime_type          TEXT NOT NULL,
  size_bytes         INTEGER NOT NULL,
  file_path          TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'Available'
                     CHECK (status IN ('Available','Missing','Verified')),
  extraction_status  TEXT NOT NULL DEFAULT 'Pending'
                     CHECK (extraction_status IN ('Pending','Extracted','Failed','Not Required')),
  extracted          TEXT,                        -- JSON of extracted fields
  edited             INTEGER NOT NULL DEFAULT 0,  -- 1 when a human corrected the AI output
  extracted_at       TEXT,
  extraction_error   TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE emails (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id  INTEGER NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  to_email   TEXT NOT NULL,
  subject    TEXT NOT NULL,
  body       TEXT NOT NULL,
  reason     TEXT,                                -- e.g. "Missing document: GST Certificate"
  provider   TEXT NOT NULL,                       -- resend | smtp | log
  status     TEXT NOT NULL,                       -- sent | simulated | failed
  error      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE status_history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id  INTEGER NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status  TEXT NOT NULL,
  note       TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE tasks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id  INTEGER NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  priority   TEXT NOT NULL DEFAULT 'Medium' CHECK (priority IN ('Low','Medium','High')),
  due_date   TEXT,
  status     TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Completed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE vendor_versions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id       INTEGER NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  version_number  INTEGER NOT NULL,
  snapshot        TEXT NOT NULL,                  -- JSON of every tracked field
  changed_fields  TEXT NOT NULL DEFAULT '{}',     -- JSON {field:{from,to}}
  note            TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (vendor_id, version_number)
);

CREATE TABLE vendors (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  company_name          TEXT NOT NULL,
  contact_person        TEXT,
  email                 TEXT,
  phone                 TEXT,
  address               TEXT,
  registration_number   TEXT,
  gst_number            TEXT,
  bank_account_number   TEXT,
  ifsc_code             TEXT,
  status                TEXT NOT NULL DEFAULT 'Draft'
                        CHECK (status IN ('Draft','Under Review','Action Required','Approved','Rejected')),
  status_reason         TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_documents_vendor  ON documents(vendor_id);

CREATE INDEX idx_emails_vendor      ON emails(vendor_id);

CREATE INDEX idx_runs_vendor         ON analysis_runs(vendor_id);

CREATE INDEX idx_status_vendor       ON status_history(vendor_id);

CREATE INDEX idx_tasks_vendor       ON tasks(vendor_id);

CREATE INDEX idx_versions_vendor   ON vendor_versions(vendor_id);
