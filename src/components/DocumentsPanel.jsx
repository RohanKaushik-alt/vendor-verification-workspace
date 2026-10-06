import React, { useRef, useState } from 'react';
import { api } from '../api.js';
import { Badge, Card, DOC_TYPES, Empty, StatusBadge, useAction, useToast, when } from './ui.jsx';

const FIELD_LABELS = {
  company_name: 'Company Name',
  registration_number: 'Registration Number',
  gst_number: 'GST / Tax Number',
  address: 'Address',
  bank_account_number: 'Bank Account Number',
  ifsc_code: 'IFSC Code',
};
const FIELDS = Object.keys(FIELD_LABELS);

/**
 * Upload 2-3 vendor documents, run the AI extraction, review and correct what
 * the AI returned, then mark the document Verified (or delete it -> Missing).
 */
export default function DocumentsPanel({ vendor, documents, refresh }) {
  const [docType, setDocType] = useState(DOC_TYPES[0]);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef(null);
  const notify = useToast();

  const [upload, uploading] = useAction(
    async (file) => {
      const form = new FormData();
      form.append('doc_type', docType);
      form.append('file', file);
      const result = await api.upload(`/api/vendors/${vendor.id}/documents`, form);
      const fields = result.extraction?.ok
        ? Object.entries(result.extraction.fields)
            .filter(([, value]) => value)
            .map(([key]) => FIELD_LABELS[key])
            .join(', ')
        : null;
      notify(
        result.extraction.ok
          ? `Extracted from ${docType}: ${fields || 'no fields'}`
          : `Uploaded, but extraction failed: ${result.extraction.error}`,
        result.extraction.ok ? 'success' : 'error',
      );
      refresh();
      return result;
    },
    { success: 'Document uploaded' },
  );

  const [reextract, busyExtract] = useAction(
    async (doc) => {
      const result = await api.post(`/api/documents/${doc.id}/extract`);
      notify(
        result.extraction.ok
          ? `Re-extracted ${doc.doc_type} using ${result.extraction.source}`
          : `Extraction failed: ${result.extraction.error}`,
        result.extraction.ok ? 'success' : 'error',
      );
      refresh();
    },
    { success: 'Extraction complete' },
  );

  const [removeDoc] = useAction(
    async (doc) => {
      if (!window.confirm(`Delete "${doc.original_name}"? The checklist will show this document as Missing.`)) return;
      await api.del(`/api/documents/${doc.id}`);
      notify(`${doc.doc_type} deleted - now Missing`, 'info');
      refresh();
    },
    { success: 'Document deleted' },
  );

  const [markVerified] = useAction(
    async (doc) => {
      await api.patch(`/api/documents/${doc.id}`, { status: 'Verified' });
      refresh();
    },
    { success: 'Document marked Verified' },
  );

  return (
    <>
      <Card title="Upload document" hint="PDF, PNG or JPG up to 15 MB - 2 to 3 documents are expected">
        <div
          className={`dropzone ${drag ? 'drag' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const file = e.dataTransfer.files?.[0];
            if (file) upload(file);
          }}
        >
          <p>Drag & drop a file here, or pick one below</p>
          <div className="row" style={{ justifyContent: 'center' }}>
            <select value={docType} onChange={(e) => setDocType(e.target.value)}>
              {DOC_TYPES.map((type) => (
                <option key={type}>{type}</option>
              ))}
            </select>
            <button className="btn" type="button" onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? <span className="spin" /> : null} Choose file
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.webp"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) upload(file);
              e.target.value = '';
            }}
          />
          <p className="muted small" style={{ marginBottom: 0 }}>
            Sample files live in <span className="mono">data/samples/</span> (<span className="mono">npm run samples</span>)
          </p>
        </div>
      </Card>

      <Card title="Uploaded documents" hint="AI output is editable - correct anything wrong">
        {documents.length === 0 ? (
          <Empty>No documents uploaded yet. Start with the Registration Certificate.</Empty>
        ) : (
          <div className="stack">
            {documents.map((doc) => (
              <DocumentCard
                key={doc.id}
                doc={doc}
                busyExtract={busyExtract}
                onExtract={() => reextract(doc)}
                onDelete={() => removeDoc(doc)}
                onVerify={() => markVerified(doc)}
                refresh={refresh}
              />
            ))}
          </div>
        )}
      </Card>
    </>
  );
}

function DocumentCard({ doc, busyExtract, onExtract, onDelete, onVerify, refresh }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({});
  const notify = useToast();

  const fields = doc.extracted?.fields || {};
  const warnings = doc.extracted?.warnings || [];

  const startEdit = () => {
    setDraft({ ...fields });
    setEditing(true);
  };

  const [save, saving] = useAction(
    async () => {
      await api.patch(`/api/documents/${doc.id}`, { fields: draft });
      setEditing(false);
      refresh();
    },
    { success: 'Corrections saved (marked as manually edited)' },
  );

  return (
    <div className="card" style={{ background: 'var(--panel-2)' }}>
      <div className="row">
        <b>{doc.doc_type}</b>
        <StatusBadge value={doc.status} />
        <StatusBadge value={doc.extraction_status === 'Extracted' ? 'Extracted' : doc.extraction_status} />
        {doc.edited && <Badge value="Edited by reviewer" className="info" />}
        <span className="spacer" />
        <a className="btn sm" href={doc.url} target="_blank" rel="noreferrer">
          View file
        </a>
        <button className="btn sm" onClick={onExtract} disabled={busyExtract}>
          {busyExtract ? <span className="spin" /> : null} Re-extract
        </button>
        {doc.status !== 'Verified' && (
          <button className="btn sm" onClick={onVerify}>
            Mark verified
          </button>
        )}
        <button className="btn sm danger" onClick={onDelete}>
          Delete
        </button>
      </div>

      <p className="muted small" style={{ margin: '8px 0' }}>
        {doc.original_name} · {(doc.size_bytes / 1024).toFixed(1)} KB · uploaded {when(doc.created_at)}
        {doc.extracted_at && <> · extracted {when(doc.extracted_at)}</>}
        {doc.extracted?.source && (
          <>
            {' '}
            · source <b>{doc.extracted.source}</b>
          </>
        )}
      </p>

      {doc.extraction_status === 'Failed' && (
        <p className="issue">
          Extraction failed: {doc.extraction_error}
          <br />
          <span className="muted small">Fix the file, or re-run extraction after configuring the AI key.</span>
        </p>
      )}

      {warnings.length > 0 && (
        <p className="muted small">
          {warnings.map((w) => (
            <span key={w} className="issue" style={{ display: 'block' }}>
              {w}
            </span>
          ))}
        </p>
      )}

      {doc.extracted && (
        <>
          {!editing ? (
            <table>
              <tbody>
                {FIELDS.map((key) => (
                  <tr key={key}>
                    <td className="muted" style={{ width: '35%' }}>
                      {FIELD_LABELS[key]}
                    </td>
                    <td className="mono">{fields[key] || <span className="muted">not present in this document</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="grid">
              {FIELDS.map((key) => (
                <div className="field" key={key}>
                  <label>{FIELD_LABELS[key]}</label>
                  <input
                    value={draft[key] ?? ''}
                    placeholder="leave empty if absent"
                    onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
          )}

          <div className="row mt">
            <span className="spacer" />
            {editing ? (
              <>
                <button className="btn ghost" onClick={() => setEditing(false)} disabled={saving}>
                  Cancel
                </button>
                <button className="btn primary" onClick={save} disabled={saving}>
                  {saving ? 'Saving…' : 'Save corrections'}
                </button>
              </>
            ) : (
              <button className="btn" onClick={startEdit}>
                Edit extracted values
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
