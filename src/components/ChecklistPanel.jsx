import React from 'react';
import { api } from '../api.js';
import { Badge, Card, Empty, StatusBadge, useAction, when } from './ui.jsx';

/**
 * Required-document checklist (Available | Missing | Verified), the automated
 * missing-document email, and the email audit trail.
 */
export default function ChecklistPanel({ vendor, checklist, emails, health, refresh }) {
  const missing = checklist.filter((item) => item.status === 'Missing');
  const provider = health?.providers?.email;

  const [notify, notifying] = useAction(
    async () => {
      const result = await api.post(`/api/vendors/${vendor.id}/checklist/notify`, {});
      refresh();
      return result;
    },
    {
      success: (result) =>
        result.message === 'Email sent'
          ? `Email sent to ${vendor.email}`
          : `${result.message} - stored in the email log`,
    },
  );

  const [autoCheck, checking] = useAction(
    async () => {
      // Re-runs the workflow rules: detects missing docs/mismatches, creates the
      // task and sends the client email when needed.
      await api.post(`/api/vendors/${vendor.id}/compare`, {});
      refresh();
    },
    { success: 'Checklist re-evaluated' },
  );

  return (
    <>
      <Card
        title="Document checklist"
        hint={`required: ${checklist.length} document types`}
        actions={
          <button className="btn" onClick={autoCheck} disabled={checking || checklist.length === 0}>
            {checking ? <span className="spin" /> : null} Run automated check
          </button>
        }
      >
        <table>
          <thead>
            <tr>
              <th>Document</th>
              <th>Status</th>
              <th>File</th>
              <th>Extraction</th>
            </tr>
          </thead>
          <tbody>
            {checklist.map((item) => (
              <tr key={item.doc_type}>
                <td>{item.doc_type}</td>
                <td>
                  <StatusBadge value={item.status} />
                </td>
                <td className="mono">{item.file || <span className="muted">—</span>}</td>
                <td>
                  {item.extraction_status ? (
                    <StatusBadge value={item.extraction_status} />
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {missing.length === 0 ? (
          <p className="mt muted small">All required documents are present.</p>
        ) : (
          <p className="issue mt">
            Missing: {missing.map((m) => m.doc_type).join(', ')} - an email to{' '}
            <b>{vendor.email || '(no email on file)'}</b> is sent automatically when the status flips to Action
            Required.
          </p>
        )}
      </Card>

      <Card
        title="Missing-document email"
        hint={`provider ${provider ? `${provider.provider} (${provider.mode})` : 'unknown'}`}
        actions={
          <button
            className="btn primary"
            onClick={notify}
            disabled={notifying || missing.length === 0 || !vendor.email}
            title={!vendor.email ? 'Add an email address to the vendor first' : ''}
          >
            {notifying ? <span className="spin" /> : null} Send email now
          </button>
        }
      >
        {provider?.mode === 'simulated' && (
          <p className="issue">
            No email credentials configured - messages are stored instead of sent. Add{' '}
            <span className="mono">RESEND_API_KEY</span> or SMTP settings to <span className="mono">.env</span> to
            deliver for real.
          </p>
        )}
        {missing.length === 0 ? (
          <Empty>Nothing missing - the client has everything on file.</Empty>
        ) : (
          <p className="small muted">
            Will list {missing.length} missing document(s) for <b>{vendor.company_name}</b> and ask{' '}
            {vendor.contact_person || 'the contact person'} to provide them.
          </p>
        )}
      </Card>

      <Card title="Email log" hint="every outgoing message is persisted for audit">
        {emails.length === 0 ? (
          <Empty>No emails generated yet.</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Sent at</th>
                <th>To</th>
                <th>Subject</th>
                <th>Reason</th>
                <th>Provider</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {emails.map((email) => (
                <tr key={email.id}>
                  <td className="small">{when(email.created_at)}</td>
                  <td className="mono small">{email.to_email}</td>
                  <td>
                    <details>
                      <summary>{email.subject}</summary>
                      <pre className="mono small" style={{ whiteSpace: 'pre-wrap' }}>{email.body}</pre>
                      {email.error && <p className="muted small">{email.error}</p>}
                    </details>
                  </td>
                  <td className="small">{email.reason}</td>
                  <td>
                    <Badge value={email.provider} />
                  </td>
                  <td>
                    <Badge
                      value={email.status}
                      className={email.status === 'sent' ? 'ok' : email.status === 'simulated' ? 'warn' : 'bad'}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
