import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Card, Field, useAction } from './ui.jsx';

const EMPTY = {
  company_name: '',
  contact_person: '',
  email: '',
  phone: '',
  address: '',
  registration_number: '',
  gst_number: '',
  bank_account_number: '',
  ifsc_code: '',
};

/**
 * Create / edit form for the vendor master record.
 * - vendor = null   -> create (POST)
 * - vendor = {...}  -> edit   (PATCH, writes a new version only when a field changed)
 */
export default function VendorForm({ vendor, onSaved, onCancel }) {
  const [form, setForm] = useState(EMPTY);

  useEffect(() => {
    setForm(vendor ? { ...EMPTY, ...vendor } : EMPTY);
  }, [vendor]);

  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));

  const [save, saving] = useAction(
    async () => (vendor ? api.patch(`/api/vendors/${vendor.id}`, form) : api.post('/api/vendors', form)),
    {
      success: (result) =>
        vendor
          ? `Saved (now version ${result.version ?? 'unchanged'})`
          : `Vendor created as version 1`,
    },
  );

  const submit = async (event) => {
    event.preventDefault();
    const result = await save();
    if (result) onSaved(result.vendor);
  };

  return (
    <form onSubmit={submit}>
      <Card
        title={vendor ? `Edit vendor #${vendor.id}` : 'New vendor'}
        hint="Save creates a new entry in the version history when a tracked field changes"
        actions={
          <div className="row">
            {onCancel && (
              <button type="button" className="btn ghost" onClick={onCancel}>
                Cancel
              </button>
            )}
            <button type="submit" className="btn primary" disabled={saving}>
              {saving ? 'Saving…' : vendor ? 'Save changes' : 'Create vendor'}
            </button>
          </div>
        }
      >
        <div className="grid">
          <Field label="Company Name *">
            <input required minLength={2} value={form.company_name} onChange={set('company_name')} placeholder="ABC Technologies Pvt Ltd" />
          </Field>
          <Field label="Contact Person">
            <input value={form.contact_person || ''} onChange={set('contact_person')} placeholder="Ravi Kumar" />
          </Field>
          <Field label="Email">
            <input type="email" value={form.email || ''} onChange={set('email')} placeholder="vendor@example.com" />
          </Field>
          <Field label="Phone">
            <input value={form.phone || ''} onChange={set('phone')} placeholder="+91 98765 43210" />
          </Field>
          <Field label="Company Registration Number">
            <input value={form.registration_number || ''} onChange={set('registration_number')} placeholder="U74999KA2016PTC091234" />
          </Field>
          <Field label="GST / Tax Number">
            <input value={form.gst_number || ''} onChange={set('gst_number')} placeholder="29AABCA1234A1Z5" />
          </Field>
          <Field label="Bank Account Number">
            <input value={form.bank_account_number || ''} onChange={set('bank_account_number')} placeholder="50100234567890" />
          </Field>
          <Field label="IFSC Code">
            <input value={form.ifsc_code || ''} onChange={set('ifsc_code')} placeholder="HDFC0001234" />
          </Field>
          <div style={{ gridColumn: '1 / -1' }}>
            <Field label="Address">
              <textarea rows={3} value={form.address || ''} onChange={set('address')} placeholder="4th Floor, Tech Park, Outer Ring Road, Bengaluru, Karnataka 560103" />
            </Field>
          </div>
        </div>
        <p className="muted small mt">
          Values marked <b>*</b> are required. Everything else can be completed later from the documents.
        </p>
        {vendor && (
          <p className="muted small">
            Created {vendor.created_at} · Last updated {vendor.updated_at}
          </p>
        )}
      </Card>
    </form>
  );
}
