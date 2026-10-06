import React, { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { Badge, Empty, StatusBadge, ToastProvider, when } from './components/ui.jsx';
import VendorForm from './components/VendorForm.jsx';
import DocumentsPanel from './components/DocumentsPanel.jsx';
import { ComparePanel, VerifyPanel } from './components/AnalysisPanel.jsx';
import ChecklistPanel from './components/ChecklistPanel.jsx';
import WorkflowPanel from './components/WorkflowPanel.jsx';
import VersionsPanel from './components/VersionsPanel.jsx';

const TABS = ['Vendor Details', 'Documents', 'Analysis', 'Checklist & Email', 'Workflow & Tasks', 'Version History'];

function App() {
  const [health, setHealth] = useState(null);
  const [vendors, setVendors] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [workspace, setWorkspace] = useState(null);
  const [tab, setTab] = useState(TABS[0]);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadVendors = useCallback(async () => {
    const data = await api.get('/api/vendors');
    setVendors(data.vendors);
    return data.vendors;
  }, []);

  const loadWorkspace = useCallback(async (id) => {
    if (!id) {
      setWorkspace(null);
      return null;
    }
    const data = await api.get(`/api/vendors/${id}`);
    setWorkspace(data);
    return data;
  }, []);

  const refresh = useCallback(() => loadWorkspace(selectedId), [loadWorkspace, selectedId]);

  const boot = useCallback(async () => {
    setLoading(true);
    try {
      const [healthData, list] = await Promise.all([api.get('/api/health'), loadVendors()]);
      setHealth(healthData);
      if (list.length) {
        setSelectedId(list[0].id);
        await loadWorkspace(list[0].id);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [loadVendors, loadWorkspace]);

  useEffect(() => {
    boot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectVendor = async (id) => {
    setSelectedId(id);
    setCreating(false);
    setEditing(false);
    await loadWorkspace(id);
  };

  const onCreated = async (vendor) => {
    setCreating(false);
    await loadVendors();
    await selectVendor(vendor.id);
  };

  const onSaved = async () => {
    setEditing(false);
    await loadVendors();
    await refresh();
  };

  const providers = health?.providers;
  const vendor = workspace?.vendor;

  return (
    <div className="app">
      <aside className="sidebar">
        <header>
          <h1>Vendor Verification</h1>
          <div className="sub">AI-powered onboarding & verification workspace</div>
        </header>

        <div className="vendor-list">
          {vendors.length === 0 && !loading && <p className="muted small">No vendors yet.</p>}
          {vendors.map((item) => (
            <button
              key={item.id}
              className={`vendor-item ${item.id === selectedId && !creating ? 'active' : ''}`}
              onClick={() => selectVendor(item.id)}
            >
              <div className="name">{item.company_name}</div>
              <div className="meta">
                <StatusBadge value={item.status} />
                <span>{item.document_count} doc(s)</span>
                {item.pending_tasks > 0 && <span>{item.pending_tasks} task(s)</span>}
              </div>
            </button>
          ))}
        </div>

        <footer>
          <button
            className="btn primary"
            style={{ width: '100%' }}
            onClick={() => {
              setCreating(true);
              setEditing(false);
            }}
          >
            + New vendor
          </button>
        </footer>
      </aside>

      <main className="main">
        <div className="provider-bar">
          {providers ? (
            <>
              <span>
                AI: <b>{providers.ai.provider}</b> {providers.ai.mode === 'offline' ? '(offline fallback)' : ''}
              </span>
              <span>
                Company API: <b>{providers.verify.provider}</b> {providers.verify.mode === 'simulated' ? '(simulated)' : ''}
              </span>
              <span>
                Email: <b>{providers.email.provider}</b> {providers.email.mode === 'simulated' ? '(simulated)' : ''}
              </span>
              <span className="spacer" />
              <a href="/api/health" target="_blank" rel="noreferrer">
                /api/health
              </a>
            </>
          ) : (
            <span>loading providers…</span>
          )}
        </div>

        <div className="topbar">
          <h2>{creating ? 'New vendor' : vendor ? vendor.company_name : 'Vendor workspace'}</h2>
          {vendor && (
            <>
              <StatusBadge value={workspace.workflow.status} />
              <span className="muted small">{workspace.documents.length} document(s)</span>
              <button
                className="btn sm"
                onClick={() => {
                  setEditing((value) => !value);
                  setTab(TABS[0]);
                  setCreating(false);
                }}
              >
                {editing ? 'Close editor' : 'Edit details'}
              </button>
            </>
          )}
        </div>

        {!creating && vendor && (
          <div className="tabs">
            {TABS.map((name) => (
              <button key={name} className={`tab ${tab === name ? 'active' : ''}`} onClick={() => setTab(name)}>
                {name}
                {name === 'Checklist & Email' && workspace.workflow.missing.length > 0 && (
                  <Badge value={workspace.workflow.missing.length} className="warn" />
                )}
                {name === 'Workflow & Tasks' && workspace.workflow.open_tasks > 0 && (
                  <Badge value={workspace.workflow.open_tasks} className="info" />
                )}
              </button>
            ))}
          </div>
        )}

        <div className="content">
          {loading && <Empty>Loading workspace…</Empty>}

          {creating && <VendorForm vendor={null} onSaved={onCreated} onCancel={() => setCreating(false)} />}

          {!creating && !vendor && !loading && (
            <Empty>Select a vendor on the left, or create the first one.</Empty>
          )}

          {!creating && vendor && (
            <>
              {tab === TABS[0] && (
                editing ? (
                  <VendorForm vendor={vendor} onSaved={onSaved} onCancel={() => setEditing(false)} />
                ) : (
                  <Details vendor={vendor} workflow={workspace.workflow} />
                )
              )}

              {tab === TABS[1] && (
                <DocumentsPanel vendor={vendor} documents={workspace.documents} refresh={refresh} />
              )}

              {tab === TABS[2] && (
                <>
                  <ComparePanel
                    vendor={vendor}
                    runs={workspace.runs}
                    documents={workspace.documents}
                    refresh={refresh}
                  />
                  <VerifyPanel vendor={vendor} runs={workspace.runs} refresh={refresh} health={health} />
                </>
              )}

              {tab === TABS[3] && (
                <ChecklistPanel
                  vendor={vendor}
                  checklist={workspace.checklist}
                  emails={workspace.emails}
                  health={health}
                  refresh={refresh}
                />
              )}

              {tab === TABS[4] && (
                <WorkflowPanel
                  vendor={vendor}
                  workflow={workspace.workflow}
                  tasks={workspace.tasks}
                  emails={workspace.emails}
                  refresh={refresh}
                />
              )}

              {tab === TABS[5] && (
                <VersionsPanel vendor={vendor} versions={workspace.versions} refresh={refresh} />
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

const FIELD_ROWS = [
  ['company_name', 'Company Name'],
  ['contact_person', 'Contact Person'],
  ['email', 'Email'],
  ['phone', 'Phone'],
  ['address', 'Address'],
  ['registration_number', 'Registration Number'],
  ['gst_number', 'GST / Tax Number'],
  ['bank_account_number', 'Bank Account Number'],
  ['ifsc_code', 'IFSC Code'],
];

function Details({ vendor, workflow }) {
  return (
    <>
      <section className="card">
        <h3>
          Vendor details <span className="hint">id #{vendor.id}</span>
        </h3>
        <table>
          <tbody>
            {FIELD_ROWS.map(([key, label]) => (
              <tr key={key}>
                <td className="muted" style={{ width: '30%' }}>
                  {label}
                </td>
                <td className="mono">{vendor[key] || <span className="muted">not provided</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small mt">Last updated {when(vendor.updated_at)}</p>
      </section>

      {workflow.issues.length > 0 && (
        <section className="card">
          <h3>Open issues</h3>
          <div className="stack">
            {workflow.issues.map((issue) => (
              <div className="issue" key={issue}>
                {issue}
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

export default function Root() {
  return (
    <ToastProvider>
      <App />
    </ToastProvider>
  );
}
