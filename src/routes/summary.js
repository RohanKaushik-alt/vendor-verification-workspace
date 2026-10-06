'use strict';

/** Maps a workflow report (services/workflow.js) to the shape the UI consumes. */

const { TRANSITIONS, addDays } = require('../services/workflow');

function summarize(report) {
  const openTasks = report.tasks.filter((t) => t.status === 'Pending').length;
  return {
    status: report.vendor.status,
    status_reason: report.vendor.status_reason,
    allowed_transitions: TRANSITIONS[report.vendor.status] || [],
    next_due: report.tasks.find((t) => t.status === 'Pending')?.due_date || addDays(3),
    missing: report.missing,
    issues: report.issues,
    verify_outcome: report.verify_outcome,
    checklist: report.checklist,
    open_tasks: openTasks,
    tasks: report.tasks,
  };
}

module.exports = { summarize };
