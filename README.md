# AI-Powered Vendor Verification Workspace

A full-stack application for onboarding a vendor, extracting data from their documents with AI,
cross-checking those documents, verifying the company against an external registry, chasing missing
documents by email, and taking the record through a review workflow — with full version history.

```
Vendor Details → Upload Documents → AI Extraction → AI Comparison → Company API Verification
              → Missing Document → Email Client → Review → Approve / Reject
```

---

## 1. Technologies used

| Layer | Technology | Why |
|---|---|---|
| Frontend | **React 18 + Vite 5** (plain CSS, no UI kit) | fast dev server, proxy to the API |
| Backend | **Node.js 24 + Express 4** | simple REST API, good error-handling middleware |
| Validation | **Zod** | request payload validation |
| Uploads | **Multer 2** (disk storage, 15 MB limit, type filter) | multipart file uploads |
| Database | **SQLite via `better-sqlite3`** | zero-install, file-based, synchronous & transactional |
| Document parsing | **`pdf-parse`** (pdf.js) for the text layer | free, offline |
| **AI API** | **Google Gemini** (`gemini-2.5-flash`) — free tier | reads PDFs *and* images (vision), returns JSON |
| **AI fallback** | **Groq** (`qwen/qwen3.8-27b`) — free tier | LLM parse of the PDF text layer when Gemini is unavailable (no vision on the free tier) |
| **Company verification API** | **OpenCorporates → Companies House → GLEIF** | provider *chain*; GLEIF is official, global and **needs no API key** |
| **Email service** | **Resend** (free tier) → **SMTP / nodemailer** → **log mode** | three interchangeable providers |
| Secrets | **`.env` + `dotenv`** (git-ignored) | no key ever reaches the browser |

**Every integration has a zero-credential fallback**, so the app (and the demo) works with *no API
keys at all*: Gemini → Groq → offline regex extractor; registry chain → keyless **GLEIF** (or bundled
fixtures with `VERIFY_PROVIDER=mock`); stored messages → `log`. Add keys in `.env` and the same code
paths switch to the live services.

---

## 2. How to run the application

```bash
# 1. install dependencies (Node 18+ / tested on Node 24)
npm install

# 2. (optional) configure credentials
copy .env.example .env      # Windows
# cp .env.example .env      # macOS/Linux

# 3. create the demo vendor + sample documents
npm run db:reset
npm run samples

# 4. start API (:4000) and frontend (:5173) together
npm run dev
```

Open **http://localhost:5173**.

Production-style run (single port, serves the built frontend from Express):

```bash
npm run build     # vite -> dist/
npm start         # http://localhost:4000
```

Other scripts:

| Script | Purpose |
|---|---|
| `npm run dev` | API with `--watch` + Vite dev server (proxy on `/api`) |
| `npm start` | API only (also serves `dist/` if it exists) |
| `npm run samples` | generates the 3 sample vendor PDFs in `data/samples/` |
| `npm run db:reset` | drops and recreates `data/app.db` with a demo vendor |
| `npm run db:schema` | dumps the live schema to `db/schema.exported.sql` |
| `npm run smoke` | 32-assertion end-to-end test against a running API |
| `npm run check:deploy` | same style of checks against a *deployed* instance (`CHECK_BASE` overrides the URL) |

---

## 3. Environment variables (`.env`)

| Variable | Required? | Notes |
|---|---|---|
| `GEMINI_API_KEY` | optional | free key from <https://aistudio.google.com/apikey>. Without it the offline extractor is used (text-layer PDFs only; scanned/image files need a vision model). |
| `GEMINI_MODEL` | optional | default `gemini-2.5-flash` |
| `GROQ_API_KEY` | optional | free key from <https://console.groq.com/keys>. Text-layer fallback when Gemini fails; it cannot OCR images. |
| `GROQ_MODEL` | optional | default `qwen/qwen3.8-27b` |
| `OPENCORPORATES_API_KEY` | optional | tried first in the chain when set. |
| `COMPANIES_HOUSE_API_KEY` | optional | free key from <https://developer.company-information.service.gov.uk> (UK registry, ~30 s signup) |
| `VERIFY_PROVIDER` | optional | `auto` (default: **OpenCorporates → Companies House → GLEIF**) \| `opencorporates` \| `companies_house` \| `gleif` \| `mock` |
| `OC_JURISDICTION` | optional | e.g. `in`, `gb`, `us` to bias the OpenCorporates search |
| `EMAIL_PROVIDER` | optional | `auto` (default) \| `resend` \| `smtp` \| `log` |
| `RESEND_API_KEY` | optional | free tier: <https://resend.com>. **Without a verified sending domain, Resend only delivers to the account owner's own address** — the demo seeds that address as the vendor contact so the automated email is genuinely delivered; add SMTP settings to email anyone else. |
| `SMTP_HOST/PORT/USER/PASS/SECURE` | optional | Gmail app-password, Brevo, Mailtrap… |
| `EMAIL_FROM` | optional | default `Vendor Verification <onboarding@resend.dev>` |
| `PORT`, `DB_PATH`, `UPLOAD_DIR` | optional | defaults `4000`, `data/app.db`, `data/uploads` |

`GET /api/health` reports which provider is live vs simulated.

---

## 4. Architecture

```
┌──────────────────────────────┐         ┌──────────────────────────────────────────────┐
│ React SPA (Vite)             │  /api   │ Express API (src/index.js)                  │
│  Vendor Details   Documents  ├────────►│  routes/vendors    CRUD + versions + status  │
│  Analysis         Checklist  │  proxy  │  routes/documents  upload → extract → rules  │
│  Workflow         History    │         │  routes/analysis   compare · verify · email  │
└──────────────────────────────┘         │                                            │
                                         │  services/ai        Gemini → Groq → local   │
                                         │  services/compare   normalise + diff engine  │
                                         │  services/verify    OC → Companies House →   │
                                         │                     GLEIF (no key) → mock    │
                                         │  services/email     resend → smtp → log      │
                                         │  services/workflow  transitions + auto rules │
                                         └───────────────┬──────────────────────────────┘
                                                         │ better-sqlite3 (synchronous)
                                         ┌───────────────▼──────────────────────────────┐
                                         │ data/app.db  ·  data/uploads/  (SQLite WAL)  │
                                         └──────────────────────────────────────────────┘

External services:  Google Gemini + Groq (AI)   ·   OpenCorporates / Companies House / GLEIF (registry)   ·   Resend / SMTP (email)
```

### Request flow for the core workflow

1. `POST /api/vendors` → row + **version 1** snapshot.
2. `POST /api/vendors/:id/documents` (multipart) → file stored → `extractDocument()`:
   Gemini (key) → Groq LLM over the PDF text layer (key) → **offline regex/label extractor**
   → result persisted as JSON.
3. `POST /api/vendors/:id/compare` → `compareDocuments()` normalises values (legal-entity tokens,
   code formatting, Levenshtein similarity) and reports `match | mismatch | incomplete` per field,
   including document-vs-form conflicts → stored in `analysis_runs`.
4. `POST /api/vendors/:id/verify` (optional `{query}` override) → walks the registry chain
   (registration number first, then company name) → field-by-field checks →
   **`Verified` / `Mismatch` / `Unable to Verify`** → stored in `analysis_runs`.
5. `applySystemRules()` runs after every mutation:
   * missing document **or** compare mismatch **or** verify mismatch
     → status **`Action Required`** + a **task** (High, due +3 days) + an **email** to the vendor
       listing exactly the documents still missing (never twice for the same document).
   * issues resolved → status returns to **`Under Review`** for the reviewer.
6. Reviewer moves the status (`Draft → Under Review → Approved / Rejected`) — transitions are
   validated against a transition map and written to `status_history`.
7. Every vendor field change writes a `vendor_versions` snapshot with `{from,to}` per field;
   restore appends a new version instead of deleting history.

### Folder structure

```
├── index.html, vite.config.js
├── db/
│   ├── schema.sql              # source of truth, applied idempotently at boot
│   └── schema.exported.sql     # generated from the live database (npm run db:schema)
├── scripts/
│   ├── make-samples.js         # builds the 3 sample vendor PDFs
│   ├── reset-db.js / export-schema.js
│   ├── live-check.mjs          # ad-hoc end-to-end probe of a running server
│   └── smoke-test.js           # 32 end-to-end assertions
├── src/
│   ├── index.js                # express app + static hosting + health
│   ├── config.js               # env + capability detection
│   ├── db.js                   # sqlite, version snapshots, restore
│   ├── queries.js              # shared read models
│   ├── http.js                 # async wrapper + JSON error handler
│   ├── routes/                 # vendors · documents · analysis · summary
│   └── services/
│       ├── ai/                 # index · gemini · groq (text) · local
│       ├── compare.js
│       ├── verify/             # index · opencorporates · companies_house · gleif · mock
│       ├── email/              # index (resend / smtp / log)
│       └── workflow.js         # statuses, checklist, tasks, auto-rules
└── src/ (frontend)             # App.jsx · api.js · styles.css · components/*
```

---

## 5. Database / schema

Seven tables (see `db/schema.sql`):

| Table | Purpose |
|---|---|
| `vendors` | master record + `status` (Draft/Under Review/Action Required/Approved/Rejected) |
| `vendor_versions` | full JSON snapshot per change + `changed_fields` diff + timestamp |
| `documents` | uploaded file metadata, `status` (Available/Missing/Verified), AI `extracted` JSON, `edited` flag |
| `analysis_runs` | audit of each `ai_compare` and `company_verify` run (outcome + payload) |
| `tasks` | follow-up tasks: title, priority, due date, Pending/Completed |
| `status_history` | from → to transitions with note and time |
| `emails` | every outgoing message: recipient, body, reason, provider, sent/simulated/failed |

Foreign keys cascade from `vendors`; WAL mode and `foreign_keys=ON` are set at boot.

---

## 6. Key behaviours & error handling

* **Extraction failures** are stored per document (`extraction_status`, `extraction_error`) and shown
  inline — the rest of the workflow keeps working.
* **Unsupported file type / oversized file** → `415`/`400` before anything is written.
* **Registry errors** (invalid key, rate limit, timeout, DNS, not-found) are converted into an
  `Unable to Verify` report with a `reason` — never a silent success, never a stack trace.
* **Email failures** are persisted with `status='failed'` and the provider error text.
* **Invalid workflow transitions** are rejected (`400`) with the list of allowed next states.
* **Missing/unknown routes and records** return `404` with a JSON envelope;
  all errors go through one middleware: `{ error, details? }`.
* API keys are read only in `src/config.js` (server side); the browser only ever sees `/api/*`.

---

## 7. Five-minute demo script

1. **Vendor details** – create *ABC Technologies Pvt Ltd* (`npm run db:reset` seeds it) → edit the
   company name → Version 2 diff appears → restore Version 1.
2. **Documents** – upload `data/samples/ABC-Registration-Certificate.pdf`, `ABC-GST-Certificate.pdf`,
   `ABC-Bank-Document.pdf` (select the matching document type) → fields are extracted on upload.
3. **Analysis → Run comparison** – `ABC Technologies Pvt Ltd` vs `ABC Technology Pvt Ltd` →
   **Mismatch**, field-by-field table → status flips to **Action Required** + task + email.
4. **Analysis → Verify company** – the fictional vendor is searched against the registry chain and
   honestly reported as **Unable to Verify**. Switch to the second seeded vendor
   (*HDFC Bank Limited*, a real company with its real CIN) → **Verified** with per-field checks
   (name + registration number + address). The search box overrides the query: type the vendor's
   name with a wrong CIN to see **Mismatch**.
5. **Checklist & Email** – delete the bank document → checklist shows **Missing** → status flips to
   **Action Required**, a task is created and a missing-document email is actually sent
   (Resend) / logged, with the provider and status stored per message.
6. **Workflow & Tasks** – resolve the mismatch (Documents → *Edit extracted values* on the GST
   certificate → fix the name → re-run comparison) → status returns to **Under Review** →
   **Approved**.
7. **Version History** – previous value / new value / timestamp, restore any version.

---

## 8. Known limitations

* No authentication/authorisation — the brief did not require it.
* Single-node file storage (`data/uploads`); on serverless hosts swap storage for S3-compatible blobs
  and SQLite for a managed database.
* The offline extractor reads the PDF text layer only; scanned/image documents need a vision key.
* SQLite and `data/uploads` sit on the instance's **ephemeral disk** in the deployed app: a
  redeploy/restart re-seeds the two demo vendors and clears uploaded files (fine for a demo,
  swap for a managed database + object storage for production).

---

## 9. Deploying (Render, free tier)

The repo ships a **`render.yaml` blueprint** — one Node service runs the API *and* serves the built
SPA from `dist/`, so there is no separate frontend deploy.

```bash
# 1. put the code on GitHub (once)
git init
git add -A
git commit -m "AI-powered vendor verification workspace"
git remote add origin git@github.com:<you>/vendor-verification-workspace.git
git push -u origin main
```

2. Render dashboard → **New + → Blueprint** → pick that repo → Render reads `render.yaml`.
3. After the first deploy, open **Environment** and paste the secrets marked `sync: false`:
   `GEMINI_API_KEY`, `GROQ_API_KEY`, `RESEND_API_KEY`, `DEMO_CONTACT_EMAIL`
   (GLEIF needs no key, so verification already works without any of them).
4. Open the service URL (`https://<name>.onrender.com`) — `GET /api/health` shows what is live:

```json
{ "providers": { "ai": {"mode":"live"}, "verify": {"provider":"gleif","mode":"live"}, "email": {"mode":"live"} } }
```

An empty database is seeded automatically at boot with the two demo vendors
(`SEED_DEMO=false` to start empty, `DEMO_CONTACT_EMAIL` decides where their emails go).

Any other Node host works the same way: `npm ci --include=dev && npm run build`, start with
`npm start`, and `PORT` is read from the environment.
