'use client';

import { FormEvent, useState } from 'react';
import { api, errorDetails, errorMessage, tenantPath, Voucher } from '@/lib/api';
import { useSession, useTenantData } from '@/lib/session';
import { formatDate, formatMoney, inputToMinor } from '@/lib/format';
import { ApiErrorNote, ErrorNote, Loading, PageHeader, ReadOnlyNote, SuccessNote } from '@/components/ui';
import { ScopeNote, useCinemaScope } from '@/lib/cinema-scope';

type ApiErr = { message: string; details: string[] } | null;

const APPLIES: Record<Voucher['appliesTo'], string> = { all: 'Tickets and food', tickets: 'Tickets', concessions: 'Food and drink' };

interface CreateForm {
  code: string;
  description: string;
  kind: Voucher['kind'];
  value: string;
  appliesTo: Voucher['appliesTo'];
  minSpend: string;
  validFrom: string;
  validTo: string;
  maxRedemptions: string;
  active: boolean;
  venueId: string;
}
const EMPTY: CreateForm = { code: '', description: '', kind: 'percentOff', value: '', appliesTo: 'all', minSpend: '', validFrom: '', validTo: '', maxRedemptions: '', active: true, venueId: '' };

interface EditForm {
  description: string;
  validTo: string;
  maxRedemptions: string;
}

const startOfDay = (d: string) => (d ? `${d}T00:00:00.000Z` : null);
const endOfDay = (d: string) => (d ? `${d}T23:59:59.000Z` : null);
const dateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : '');

function voucherValue(v: Pick<Voucher, 'kind' | 'value'>) {
  return v.kind === 'percentOff' ? `${v.value}% off` : `${formatMoney(v.value, 'GBP')} off`;
}

function validity(v: Voucher) {
  if (!v.validFrom && !v.validTo) return 'No end date';
  if (v.validFrom && v.validTo) return `${formatDate(v.validFrom)} to ${formatDate(v.validTo)}`;
  if (v.validTo) return `Until ${formatDate(v.validTo)}`;
  return `From ${formatDate(v.validFrom)}`;
}

export default function VouchersPage() {
  const { tenant, can } = useSession();
  const vouchers = useTenantData<Voucher[]>(tenantPath(tenant, '/vouchers'));
  const scope = useCinemaScope();
  const shown = (vouchers.data ?? []).filter((v) => scope.includes(v.venueId));
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<CreateForm>(EMPTY);
  const [editing, setEditing] = useState<Voucher | null>(null);
  const [edit, setEdit] = useState<EditForm>({ description: '', validTo: '', maxRedemptions: '' });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<ApiErr>(null);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});

  const fail = (message: string) => setFormError({ message, details: [] });

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!/^[A-Za-z0-9-]{3,20}$/.test(form.code)) return fail('Code must be 3 to 20 letters, numbers or hyphens.');
    if (!form.description.trim()) return fail('Enter a description customers will see.');
    let value: number;
    if (form.kind === 'percentOff') {
      value = Number.parseInt(form.value, 10);
      if (!Number.isFinite(value) || value < 1 || value > 100) return fail('Percentage must be a whole number from 1 to 100.');
    } else {
      const v = inputToMinor(form.value);
      if (v === null || Number.isNaN(v) || v < 1) return fail('Enter the amount off in pounds, such as 2.00.');
      value = v;
    }
    const minSpend = form.minSpend.trim() === '' ? 0 : inputToMinor(form.minSpend);
    if (minSpend === null || Number.isNaN(minSpend)) return fail('Minimum spend must be an amount in pounds.');
    const max = form.maxRedemptions.trim() === '' ? null : Number.parseInt(form.maxRedemptions, 10);
    if (max !== null && (!Number.isFinite(max) || max < 1)) return fail('Maximum redemptions must be 1 or more, or empty for unlimited.');
    if (form.validFrom && form.validTo && form.validFrom > form.validTo) return fail('The end date must be on or after the start date.');
    const body = {
      code: form.code.toUpperCase(),
      description: form.description.trim(),
      kind: form.kind,
      value,
      appliesTo: form.appliesTo,
      minSpendMinor: minSpend,
      validFrom: startOfDay(form.validFrom),
      validTo: endOfDay(form.validTo),
      maxRedemptions: max,
      active: form.active,
      venueId: form.venueId || null,
    };
    setBusy(true);
    setFormError(null);
    try {
      await api(tenantPath(tenant, '/vouchers'), { method: 'POST', body });
      setMsg({ ok: `Voucher ${body.code} created.` });
      setCreating(false);
      setForm(EMPTY);
      vouchers.reload();
    } catch (err) {
      setFormError({ message: errorMessage(err), details: errorDetails(err) });
    } finally {
      setBusy(false);
    }
  }

  async function update(v: Voucher, body: Record<string, unknown>, ok: string) {
    setMsg({});
    try {
      const row = await api<Voucher>(tenantPath(tenant, `/vouchers/${v.id}`), { method: 'PUT', body });
      vouchers.setData((list) => list?.map((x) => (x.id === v.id ? row : x)) ?? null);
      setMsg({ ok });
      return true;
    } catch (err) {
      setMsg({ error: errorMessage(err) });
      return false;
    }
  }

  function startEdit(v: Voucher) {
    setEditing(v);
    setCreating(false);
    setEdit({ description: v.description, validTo: dateInput(v.validTo), maxRedemptions: v.maxRedemptions == null ? '' : String(v.maxRedemptions) });
    setFormError(null);
    setMsg({});
  }

  async function saveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    if (!edit.description.trim()) return fail('Enter a description.');
    const max = edit.maxRedemptions.trim() === '' ? null : Number.parseInt(edit.maxRedemptions, 10);
    if (max !== null && (!Number.isFinite(max) || max < 1)) return fail('Maximum redemptions must be 1 or more, or empty for unlimited.');
    setBusy(true);
    setFormError(null);
    try {
      const row = await api<Voucher>(tenantPath(tenant, `/vouchers/${editing.id}`), {
        method: 'PUT',
        body: { description: edit.description.trim(), validTo: endOfDay(edit.validTo), maxRedemptions: max },
      });
      vouchers.setData((list) => list?.map((x) => (x.id === row.id ? row : x)) ?? null);
      setMsg({ ok: `Voucher ${row.code} updated.` });
      setEditing(null);
    } catch (err) {
      setFormError({ message: errorMessage(err), details: errorDetails(err) });
    } finally {
      setBusy(false);
    }
  }

  const set = (k: keyof CreateForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <>
      <PageHeader
        title="Vouchers"
        description="Discount codes customers enter at checkout. Codes and discount type are fixed once created; deactivate a code to stop it being used."
        actions={
          can.canEditVouchers && (
            <button
              className="btn btn-primary"
              onClick={() => {
                setCreating(true);
                setEditing(null);
                setForm({ ...EMPTY, venueId: scope.venueId ?? '' });
                setFormError(null);
                setMsg({});
              }}
            >
              Create voucher
            </button>
          )
        }
      />
      <ScopeNote what="vouchers" />
      {!can.canEditVouchers && <ReadOnlyNote>Only operator admins can create or change vouchers. Vouchers are shown read-only.</ReadOnlyNote>}
      <ErrorNote message={msg.error ?? vouchers.error} />
      <SuccessNote message={msg.ok} />

      {creating && can.canEditVouchers && (
        <section className="card" aria-labelledby="vc-title">
          <h2 id="vc-title" className="h3">
            New voucher
          </h2>
          <form onSubmit={create} noValidate>
            <div className="form-grid cols-3">
              <div className="field">
                <label htmlFor="vc-code">Code</label>
                <input id="vc-code" maxLength={20} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} aria-describedby="vc-code-help" />
                <p id="vc-code-help" className="help">
                  3 to 20 letters, numbers or hyphens.
                </p>
              </div>
              <div className="field span-2">
                <label htmlFor="vc-desc">Description</label>
                <input id="vc-desc" maxLength={100} value={form.description} onChange={set('description')} placeholder="10% off your first booking" />
              </div>
              <div className="field">
                <label htmlFor="vc-kind">Discount type</label>
                <select id="vc-kind" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as Voucher['kind'], value: '' })}>
                  <option value="percentOff">Percentage off</option>
                  <option value="amountOff">Amount off</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="vc-value">{form.kind === 'percentOff' ? 'Percentage' : 'Amount'}</label>
                {form.kind === 'percentOff' ? (
                  <input id="vc-value" type="number" min={1} max={100} step={1} value={form.value} onChange={set('value')} placeholder="10" />
                ) : (
                  <div className="money-input">
                    <span aria-hidden="true">£</span>
                    <input id="vc-value" inputMode="decimal" value={form.value} onChange={set('value')} placeholder="2.00" />
                  </div>
                )}
              </div>
              <div className="field">
                <label htmlFor="vc-applies">Applies to</label>
                <select id="vc-applies" value={form.appliesTo} onChange={set('appliesTo')}>
                  {(Object.keys(APPLIES) as Voucher['appliesTo'][]).map((k) => (
                    <option key={k} value={k}>
                      {APPLIES[k]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="vc-min">Minimum spend (optional)</label>
                <div className="money-input">
                  <span aria-hidden="true">£</span>
                  <input id="vc-min" inputMode="decimal" value={form.minSpend} onChange={set('minSpend')} placeholder="0.00" />
                </div>
              </div>
              <div className="field">
                <label htmlFor="vc-from">Valid from (optional)</label>
                <input id="vc-from" type="date" value={form.validFrom} onChange={set('validFrom')} />
              </div>
              <div className="field">
                <label htmlFor="vc-to">Valid until (optional)</label>
                <input id="vc-to" type="date" value={form.validTo} onChange={set('validTo')} />
              </div>
              <div className="field">
                <label htmlFor="vc-max">Maximum redemptions (optional)</label>
                <input id="vc-max" type="number" min={1} step={1} value={form.maxRedemptions} onChange={set('maxRedemptions')} placeholder="Unlimited" />
              </div>
              <div className="field">
                <label htmlFor="vc-venue">Valid at</label>
                <select id="vc-venue" value={form.venueId} onChange={(e) => setForm({ ...form, venueId: e.target.value })}>
                  <option value="">All cinemas</option>
                  {scope.venues.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field span-2">
                <span className="label">Status</span>
                <label className="switch">
                  <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
                  Active immediately
                </label>
              </div>
            </div>
            <ApiErrorNote error={formError} />
            <div className="row gap-1">
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? 'Creating…' : 'Create voucher'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setCreating(false)}>
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}

      {editing && can.canEditVouchers && (
        <section className="card" aria-labelledby="ve-title">
          <h2 id="ve-title" className="h3">
            Edit {editing.code}
          </h2>
          <p className="muted small mb-2">
            {voucherValue(editing)} · {APPLIES[editing.appliesTo]}. The code and discount cannot change.
          </p>
          <form onSubmit={saveEdit} noValidate>
            <div className="form-grid cols-3">
              <div className="field">
                <label htmlFor="ve-desc">Description</label>
                <input id="ve-desc" maxLength={100} value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="ve-to">Valid until</label>
                <input id="ve-to" type="date" value={edit.validTo} onChange={(e) => setEdit({ ...edit, validTo: e.target.value })} aria-describedby="ve-to-help" />
                <p id="ve-to-help" className="help">
                  Leave empty for no end date.
                </p>
              </div>
              <div className="field">
                <label htmlFor="ve-max">Maximum redemptions</label>
                <input id="ve-max" type="number" min={Math.max(1, editing.redemptions)} step={1} value={edit.maxRedemptions} onChange={(e) => setEdit({ ...edit, maxRedemptions: e.target.value })} placeholder="Unlimited" />
                <p className="help">Redeemed {editing.redemptions} times so far.</p>
              </div>
            </div>
            <ApiErrorNote error={formError} />
            <div className="row gap-1">
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? 'Saving…' : 'Save changes'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}

      <section aria-label="Vouchers">
        {vouchers.loading && !vouchers.data && <Loading />}
        {vouchers.data && shown.length === 0 && <p className="muted">{scope.venue ? `No vouchers for ${scope.venue.name} yet.` : 'No vouchers yet.'}</p>}
        {shown.length > 0 && (
          <ul className="tile-grid">
            {shown.map((v) => {
              const used = v.maxRedemptions ? Math.min(100, Math.round((v.redemptions / v.maxRedemptions) * 100)) : null;
              return (
                <li key={v.id} className={`card tile voucher-tile${v.active ? '' : ' is-off'}`}>
                  <div className="tile-head">
                    <div>
                      <div className="voucher-value">{voucherValue(v)}</div>
                      <code className="voucher-code">{v.code}</code>
                    </div>
                    <span className={`badge ${v.active ? 'badge-success' : 'badge-neutral'}`}>{v.active ? 'Active' : 'Off'}</span>
                  </div>
                  {v.description && <div className="small">{v.description}</div>}
                  <dl className="tile-meta">
                    <dt>On</dt>
                    <dd>{APPLIES[v.appliesTo]}{v.minSpendMinor > 0 ? ` · min ${formatMoney(v.minSpendMinor, 'GBP')}` : ''}</dd>
                    <dt>Where</dt>
                    <dd>{v.venueId ? <span className="badge badge-scope">{scope.label(v.venueId)}</span> : 'All cinemas'}</dd>
                    <dt>When</dt>
                    <dd>{validity(v)}</dd>
                    <dt>Used</dt>
                    <dd className="num">
                      {v.redemptions} {v.maxRedemptions ? `of ${v.maxRedemptions}` : 'times, no limit'}
                    </dd>
                  </dl>
                  {used !== null && (
                    <div className="meter" role="img" aria-label={`${used}% of uses taken`}>
                      <span style={{ width: `${used}%` }} />
                    </div>
                  )}
                  {can.canEditVouchers && (
                    <div className="tile-actions">
                      <button className="btn btn-sm" onClick={() => startEdit(v)} aria-label={`Edit ${v.code}`}>
                        Edit
                      </button>
                      <button
                        className={`btn btn-sm${v.active ? ' btn-danger' : ''}`}
                        onClick={() => update(v, { active: !v.active }, `${v.code} ${v.active ? 'deactivated' : 'activated'}.`)}
                        aria-label={`${v.active ? 'Deactivate' : 'Activate'} ${v.code}`}
                      >
                        {v.active ? 'Deactivate' : 'Activate'}
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
