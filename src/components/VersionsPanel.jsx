import React from 'react';
import { api } from '../api.js';
import { Card, Empty, useAction, when } from './ui.jsx';

const LABELS = {
  company_name: 'Company Name',
  contact_person: 'Contact Person',
  email: 'Email',
  phone: 'Phone',
  address: 'Address',
  registration_number: 'Registration Number',
  gst_number: 'GST / Tax Number',
  bank_account_number: 'Bank Account Number',
  ifsc_code: 'IFSC Code',
};

function DiffRow({ field, change }) {
  return (
    <tr>
      <td className="muted">{LABELS[field] || field}</td>
      <td className="mono">
        <span className="diff-old">{change.from || '—'}</span>
      </td>
      <td className="mono">
        <span className="diff-new">{change.to || '—'}</span>
      </td>
    </tr>
  );
}

/** Version history: previous value, new value, date/time, and restore. */
export default function VersionsPanel({ vendor, versions, refresh }) {
  const [restore, restoring] = useAction(
    async (versionNumber) => {
      const result = await api.post(`/api/vendors/${vendor.id}/versions/${versionNumber}/restore`, {});
      refresh();
      return result;
    },
    { success: (result) => result.message },
  );

  const current = versions[0];

  return (
    <Card
      title="Version history"
      hint="every field change (and every restore) creates a new version - restoring never deletes history"
      actions={<span className="muted small">{versions.length} version(s)</span>}
    >
      {versions.length === 0 ? (
        <Empty>No versions recorded yet.</Empty>
      ) : (
        <div className="stack">
          {versions.map((version, index) => {
            const changes = Object.entries(version.changed_fields || {});
            const isCurrent = index === 0;
            return (
              <div className="card" key={version.id} style={{ background: 'var(--panel-2)' }}>
                <div className="row">
                  <b>Version {version.version_number}</b>
                  {isCurrent && <span className="badge ok">current</span>}
                  <span className="muted small">{when(version.created_at)}</span>
                  {version.note && <span className="badge">{version.note}</span>}
                  <span className="spacer" />
                  {!isCurrent && (
                    <button className="btn sm" onClick={() => restore(version.version_number)} disabled={restoring}>
                      {restoring ? <span className="spin" /> : null} Restore this version
                    </button>
                  )}
                </div>

                {changes.length > 0 ? (
                  <table className="mt">
                    <thead>
                      <tr>
                        <th>Field</th>
                        <th>Previous value</th>
                        <th>New value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {changes.map(([field, change]) => (
                        <DiffRow key={field} field={field} change={change} />
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="muted small mt">Version 1 - initial values as entered.</p>
                )}

                {isCurrent && (
                  <details className="mt">
                    <summary className="muted small">Full snapshot</summary>
                    <table>
                      <tbody>
                        {Object.entries(version.snapshot).map(([field, value]) => (
                          <tr key={field}>
                            <td className="muted" style={{ width: '35%' }}>
                              {LABELS[field] || field}
                            </td>
                            <td className="mono">{value || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      )}
      <p className="muted small mt">
        Current values: <span className="mono">{current?.snapshot?.company_name}</span>
      </p>
    </Card>
  );
}
