import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

/* ---------------------------------------------------------------- toasts */
const ToastContext = createContext(() => {});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const push = useCallback((message, kind = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list, { id, message, kind }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 5000);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.kind}`}>
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/* ---------------------------------------------------------------- helpers */
export function Badge({ value, className = '' }) {
  if (value === null || value === undefined || value === '') return null;
  // "Under Review" -> "underReview": CSS class names cannot contain spaces.
  const slug = String(value)
    .replace(/[^A-Za-z0-9]+(.)?/g, (_, next) => (next ? next.toUpperCase() : ''))
    .replace(/^[A-Z]/, (c) => c.toLowerCase());
  return <span className={`badge ${className} ${slug}`}>{String(value)}</span>;
}

export function Card({ title, hint, actions, children }) {
  return (
    <section className="card">
      {(title || actions) && (
        <h3>
          {title}
          {hint && <span className="hint">{hint}</span>}
          <span className="spacer" />
          {actions}
        </h3>
      )}
      {children}
    </section>
  );
}

export function Field({ label, children }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
    </div>
  );
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>;
}

/** Async button with a spinner + automatic error toast. */
export function useAction(fn, { success } = {}) {
  const [busy, setBusy] = useState(false);
  const notify = useToast();

  const run = useCallback(
    async (...args) => {
      setBusy(true);
      try {
        const result = await fn(...args);
        if (success) notify(typeof success === 'function' ? success(result) : success, 'success');
        return result;
      } catch (err) {
        notify(err.message, 'error');
        return null;
      } finally {
        setBusy(false);
      }
    },
    [fn, notify, success],
  );

  return [run, busy];
}

/* -------------------------------------------------------------- constants */
export const DOC_TYPES = ['Registration Certificate', 'GST Certificate', 'Bank Document'];
export const STATUS_TONE = {
  Draft: 'info',
  'Under Review': 'info',
  'Action Required': 'warn',
  Approved: 'ok',
  Rejected: 'bad',
  Available: 'ok',
  Missing: 'warn',
  Verified: 'ok',
  Pending: 'warn',
  Completed: 'ok',
  Mismatch: 'warn',
  Verified_: 'ok',
  'Unable to Verify': 'bad',
  OK: 'ok',
  Incomplete: 'warn',
  Extracted: 'ok',
  Failed: 'bad',
  High: 'bad',
  Medium: 'warn',
  Low: 'info',
};

export function StatusBadge({ value }) {
  if (!value) return null;
  return <Badge value={value} className={STATUS_TONE[value] || ''} />;
}

/** Formats a UTC sqlite timestamp for display. */
export function when(value) {
  if (!value) return '—';
  const date = value.includes('T') ? new Date(value) : new Date(`${value}Z`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
