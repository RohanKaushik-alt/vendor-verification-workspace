import React, { useState } from 'react';
import { api } from '../api.js';
import { Badge, Card, Empty, StatusBadge, useAction } from './ui.jsx';

const RESULT_TONE = { match: 'ok', mismatch: 'warn', conflict: 'warn', not_available: 'info', unknown: 'info' };

/**
 * Tab 1: AI cross-document comparison.
 * Tab 2: external company-verification API (OpenCorporates or the offline mock).
 */
export function ComparePanel({ vendor, runs, documents, refresh }) {
  const lastRun = runs.find((r) => r.kind === 'ai_compare');
  const comparison = lastRun?.payload;

  const [run, running] = useAction(
    async () => {
      const result = await api.post(`/api/vendors/${vendor.id}/compare`);
      refresh();
      return result;
    },
    { success: 'AI comparison finished' },
  );

  const extracted = documents.filter((d) => d.extraction_status === 'Extracted').length;

  return (
    <Card
      title="AI comparison"
      hint="Compares every extracted document against the others and against the vendor form"
      actions={
        <button className="btn primary" onClick={run} disabled={running || extracted === 0}>
          {running ? <span className="spin" /> : null} Run comparison
        </button>
      }
    >
      {extracted === 0 && <Empty>Extract at least one document first (Documents tab).</Empty>}

      {comparison && (
        <>
          <div className="row" style={{ marginBottom: 10 }}>
            <StatusBadge value={comparison.outcome} />
            <span className="muted small">run at {lastRun?.created_at} UTC</span>
          </div>
          <p className={comparison.outcome === 'Mismatch' ? 'issue' : undefined}>{comparison.summary}</p>

          <table>
            <thead>
              <tr>
                <th>Field</th>
                <th>Vendor form</th>
                <th>What the documents say</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {comparison.fields.map((row) => (
                <tr key={row.field}>
                  <td>{row.label}</td>
                  <td className="mono">{row.vendor_value || <span className="muted">empty</span>}</td>
                  <td>
                    {row.sources.length === 0 ? (
                      <span className="muted">not present in any document</span>
                    ) : (
                      <div className="stack">
                        {row.sources.map((source) => (
                          <span key={source.docId} className="mono small">
                            {source.value} <span className="muted">— {source.label}</span>
                          </span>
                        ))}
                        {row.missing_in.length > 0 && (
                          <span className="muted small">missing in: {row.missing_in.join(', ')}</span>
                        )}
                      </div>
                    )}
                  </td>
                  <td>
                    <Badge
                      value={
                        row.status === 'mismatch'
                          ? 'Mismatch'
                          : row.status === 'conflict'
                            ? 'Mismatch vs form'
                            : row.status === 'absent'
                              ? 'Not in documents'
                              : row.status === 'incomplete'
                                ? 'Incomplete'
                                : 'Match'
                      }
                      className={RESULT_TONE[row.status] || 'info'}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {(comparison.counts?.mismatches || 0) > 0 && (
            <div className="stack mt">
              {comparison.fields
                .filter((f) => f.mismatches.length > 0)
                .map((field) =>
                  field.mismatches.map((mismatch, index) => (
                    <div className="issue" key={`${field.field}-${index}`}>
                      <b>{field.label}</b>: {mismatch.left.label} says “{mismatch.left.value}” but {mismatch.right.label} says “{mismatch.right.value}”
                    </div>
                  )),
                )}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

export function VerifyPanel({ vendor, runs, refresh, health }) {
  const lastRun = runs.find((r) => r.kind === 'company_verify');
  const verification = lastRun?.payload;
  const provider = health?.providers?.verify;
  const [override, setOverride] = useState('');

  const [verify, running] = useAction(
    async () => {
      const result = await api.post(`/api/vendors/${vendor.id}/verify`, {
        query: override.trim() ? override.trim() : null,
      });
      refresh();
      return result;
    },
    { success: 'Verification finished' },
  );

  return (
    <Card
      title="Company verification"
      hint={
        provider
          ? provider.chain?.length > 1
            ? `chain: ${provider.chain.join(' → ')} (${provider.mode})`
            : `${provider.provider} (${provider.mode})`
          : ''
      }
      actions={
        <button className="btn primary" onClick={verify} disabled={running}>
          {running ? <span className="spin" /> : null} Verify company
        </button>
      }
    >
      <div className="row" style={{ marginBottom: 12 }}>
        <input
          style={{ flex: 1, minWidth: 240 }}
          placeholder="Optional: search another name / CIN / LEI, e.g. HDFC Bank Limited"
          value={override}
          onChange={(e) => setOverride(e.target.value)}
        />
        <span className="muted small">empty = use the vendor's own name &amp; registration number</span>
      </div>

      {provider?.mode === 'simulated' && (
        <p className="issue">
          Running against the bundled offline registry. Configure{' '}
          <span className="mono">OPENCORPORATES_API_KEY</span> or{' '}
          <span className="mono">COMPANIES_HOUSE_API_KEY</span> in <span className="mono">.env</span>, or leave{' '}
          <span className="mono">VERIFY_PROVIDER=auto</span> to use the keyless GLEIF registry.
        </p>
      )}

      {!verification ? (
        <Empty>Not verified yet. The system searches by registration number first, then by company name.</Empty>
      ) : (
        <>
          <div className="row" style={{ marginBottom: 10 }}>
            <StatusBadge value={verification.outcome} />
            <span className="muted small">
              provider {verification.provider} · query “{verification.query}” · {verification.total_count} result(s)
            </span>
          </div>
          <p className={verification.outcome === 'Verified' ? undefined : 'issue'}>{verification.message}</p>

          {verification.candidate && (
            <table>
              <thead>
                <tr>
                  <th>Check</th>
                  <th>Vendor value</th>
                  <th>Registry value</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {verification.checks.map((check) => (
                  <tr key={check.field}>
                    <td>{check.label}</td>
                    <td className="mono">{check.vendor_value}</td>
                    <td className="mono">{check.api_value || <span className="muted">not provided</span>}</td>
                    <td>
                      <Badge value={check.result} className={RESULT_TONE[check.result] || 'info'} />
                      {check.score !== null && check.score !== undefined && (
                        <span className="muted small"> {(check.score * 100).toFixed(0)}%</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {verification.candidate && (
            <p className="muted small mt">
              Registry record: <b>{verification.candidate.name}</b> · {verification.candidate.company_number} ·{' '}
              {verification.candidate.jurisdiction_code} · status {verification.candidate.status} · incorporated{' '}
              {verification.candidate.incorporation_date}
              {verification.candidate.lei && (
                <>
                  {' '}
                  · LEI <span className="mono">{verification.candidate.lei}</span>
                </>
              )}
              {verification.candidate.registered_office_address && (
                <>
                  <br />
                  {verification.candidate.registered_office_address}
                </>
              )}
            </p>
          )}
        </>
      )}
    </Card>
  );
}
