import React, { useState } from 'react';
import { api } from '../api.js';
import { Badge, Card, Empty, StatusBadge, useAction, when } from './ui.jsx';

const PRIORITY_OPTIONS = ['Low', 'Medium', 'High'];

/**
 * Workflow tab: status transitions (Draft -> Under Review -> Action Required ->
 * Approved / Rejected), open issues, and the follow-up tasks.
 */
export default function WorkflowPanel({ vendor, workflow, tasks, emails, refresh }) {
  const [note, setNote] = useState('');
  const [task, setTask] = useState({ title: '', priority: 'Medium', due_date: '' });

  const [move, moving] = useAction(
    async (status) => {
      const result = await api.patch(`/api/vendors/${vendor.id}/status`, { status, note: note || null });
      setNote('');
      refresh();
      return result;
    },
    {
      success: (result) => `Status: ${result.transition.from} → ${result.transition.to}`,
    },
  );

  const [createTask, creating] = useAction(
    async () => {
      await api.post(`/api/vendors/${vendor.id}/tasks`, task);
      setTask({ title: '', priority: 'Medium', due_date: '' });
      refresh();
    },
    { success: 'Task created' },
  );

  const [toggleTask] = useAction(
    async (item) => {
      await api.patch(`/api/vendors/${vendor.id}/tasks/${item.id}`, {
        status: item.status === 'Pending' ? 'Completed' : 'Pending',
      });
      refresh();
    },
    { success: 'Task updated' },
  );

  const pending = tasks.filter((t) => t.status === 'Pending');
  const completed = tasks.filter((t) => t.status === 'Completed');

  return (
    <>
      <Card
        title="Workflow status"
        hint="status changes are written to the status history"
        actions={<StatusBadge value={vendor.status} />}
      >
        <p className="row" style={{ gap: 6 }}>
          <span className="muted">Allowed next:</span>
          {(workflow.allowed_transitions || []).length === 0 && <span className="muted">no further transitions</span>}
          {(workflow.allowed_transitions || []).map((status) => (
            <button key={status} className="btn sm" onClick={() => move(status)} disabled={moving}>
              {moving ? <span className="spin" /> : null} → {status}
            </button>
          ))}
        </p>

        <div className="row mt">
          <input
            style={{ flex: 1, minWidth: 220 }}
            placeholder="Optional note recorded in the status history"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        {vendor.status_reason && (
          <p className="issue mt">
            Current reason: {vendor.status_reason}
            {emails.length > 0 && (
              <>
                <br />
                <span className="muted small">
                  Last client email: {emails[0].subject} ({emails[0].provider}/{emails[0].status})
                </span>
              </>
            )}
          </p>
        )}

        {(workflow.issues || []).length > 0 && (
          <div className="stack mt">
            <b>Open issues</b>
            {workflow.issues.map((issue) => (
              <div className="issue" key={issue}>
                {issue}
              </div>
            ))}
          </div>
        )}
        {(workflow.issues || []).length === 0 && vendor.status === 'Approved' && (
          <p className="mt" style={{ color: 'var(--ok)' }}>
            Approved - all checks passed.
          </p>
        )}
      </Card>

      <Card title="Tasks" hint={`${pending.length} pending · ${completed.length} completed`}>
        <div className="row">
          <input
            style={{ flex: 2, minWidth: 220 }}
            placeholder="Task, e.g. Collect GST certificate from vendor"
            value={task.title}
            onChange={(e) => setTask((t) => ({ ...t, title: e.target.value }))}
          />
          <select value={task.priority} onChange={(e) => setTask((t) => ({ ...t, priority: e.target.value }))}>
            {PRIORITY_OPTIONS.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
          <input type="date" value={task.due_date} onChange={(e) => setTask((t) => ({ ...t, due_date: e.target.value }))} />
          <button
            className="btn primary"
            onClick={createTask}
            disabled={creating || task.title.trim().length < 3}
          >
            {creating ? <span className="spin" /> : null} Add task
          </button>
        </div>

        {tasks.length === 0 ? (
          <Empty>No tasks yet. One is created automatically when the status becomes Action Required.</Empty>
        ) : (
          <table className="mt">
            <thead>
              <tr>
                <th>Task</th>
                <th>Priority</th>
                <th>Due date</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {[...pending, ...completed].map((item) => (
                <tr key={item.id} style={item.status === 'Completed' ? { opacity: 0.55 } : undefined}>
                  <td>{item.title}</td>
                  <td>
                    <StatusBadge value={item.priority} />
                  </td>
                  <td className="small">
                    {item.due_date || '—'}
                    {item.due_date && item.status === 'Pending' && new Date(item.due_date) < new Date() && (
                      <Badge value="overdue" className="bad" />
                    )}
                  </td>
                  <td>
                    <StatusBadge value={item.status} />
                  </td>
                  <td>
                    <button className="btn sm" onClick={() => toggleTask(item)}>
                      {item.status === 'Pending' ? 'Mark completed' : 'Reopen'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted small mt">Created {when(vendor.created_at)} · last updated {when(vendor.updated_at)}</p>
      </Card>
    </>
  );
}
