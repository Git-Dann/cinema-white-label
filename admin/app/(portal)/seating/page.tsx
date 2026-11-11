'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api, errorDetails, errorMessage, PricingResponse, SeatCategoriesResponse, SeatCategoryColours, SeatCategoryDto, tenantPath } from '@/lib/api';
import { useSession, useTenantData } from '@/lib/session';
import { formatMoney, inputToMinor, minorToInput } from '@/lib/format';
import { ApiErrorNote, ErrorNote, Loading, PageHeader, ReadOnlyNote, SuccessNote } from '@/components/ui';

type ApiErr = { message: string; details: string[] } | null;
const toErr = (e: unknown): ApiErr => ({ message: errorMessage(e), details: errorDetails(e) });

interface CategoryForm {
  id: string;
  label: string;
  description: string;
  shape: string;
  icon: string;
  customColours: boolean;
  colours: SeatCategoryColours;
  sortOrder: string;
}

const DEFAULT_COLOURS: SeatCategoryColours = {
  light: { fill: '#E8D9F7', accent: '#6B3FA0' },
  dark: { fill: '#3B2A55', accent: '#C9A8F0' },
};

const EMPTY: CategoryForm = { id: '', label: '', description: '', shape: 'seat', icon: '', customColours: false, colours: DEFAULT_COLOURS, sortOrder: '0' };

const HEX = /^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/;

const COLOUR_FIELDS: { mode: 'light' | 'dark'; key: 'fill' | 'accent'; label: string }[] = [
  { mode: 'light', key: 'fill', label: 'Light appearance fill' },
  { mode: 'light', key: 'accent', label: 'Light appearance accent' },
  { mode: 'dark', key: 'fill', label: 'Dark appearance fill' },
  { mode: 'dark', key: 'accent', label: 'Dark appearance accent' },
];

const slugify = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

function Swatches({ colours }: { colours: SeatCategoryColours | null }) {
  if (!colours) return <span className="muted small">Theme default</span>;
  return (
    <>
      {(['light', 'dark'] as const).map((mode) => (
        <span key={mode} className="swatch-pair" title={`${mode}: fill ${colours[mode].fill}, accent ${colours[mode].accent}`}>
          <span className="swatches inline" aria-hidden="true">
            <span style={{ background: colours[mode].fill }} />
            <span style={{ background: colours[mode].accent }} />
          </span>
          {mode === 'light' ? 'Light' : 'Dark'}
        </span>
      ))}
    </>
  );
}

export default function SeatingPage() {
  const { tenant, can } = useSession();
  const cats = useTenantData<SeatCategoriesResponse>(tenantPath(tenant, '/seat-categories'));
  const pricing = useTenantData<PricingResponse>(tenantPath(tenant, '/pricing'));
  const [editing, setEditing] = useState<SeatCategoryDto | 'new' | null>(null);
  const [form, setForm] = useState<CategoryForm>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<ApiErr>(null);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});

  function startNew() {
    setEditing('new');
    setForm({ ...EMPTY, sortOrder: String((cats.data?.categories.length ?? 0) + 0) });
    setFormError(null);
    setMsg({});
  }
  function startEdit(c: SeatCategoryDto) {
    setEditing(c);
    setForm({
      id: c.id,
      label: c.label,
      description: c.description ?? '',
      shape: c.shape,
      icon: c.icon ?? '',
      customColours: !!c.colours,
      colours: c.colours ?? DEFAULT_COLOURS,
      sortOrder: String(c.sortOrder),
    });
    setFormError(null);
    setMsg({});
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (editing === 'new' && !/^[a-z0-9-]+$/.test(form.id)) return setFormError({ message: 'Id may contain only lowercase letters, numbers and hyphens.', details: [] });
    if (!form.label.trim()) return setFormError({ message: 'Enter a label.', details: [] });
    if (form.customColours) {
      const bad = COLOUR_FIELDS.find((f) => !HEX.test(form.colours[f.mode][f.key]));
      if (bad) return setFormError({ message: `${bad.label} must be a hex colour such as #6B3FA0.`, details: [] });
    }
    const sortOrder = Number.parseInt(form.sortOrder, 10);
    const body = {
      label: form.label.trim(),
      description: form.description.trim() || null,
      shape: form.shape,
      icon: form.icon || null,
      colours: form.customColours
        ? {
            light: { fill: form.colours.light.fill.toUpperCase(), accent: form.colours.light.accent.toUpperCase() },
            dark: { fill: form.colours.dark.fill.toUpperCase(), accent: form.colours.dark.accent.toUpperCase() },
          }
        : null,
      sortOrder: Number.isFinite(sortOrder) ? sortOrder : 0,
    };
    setBusy(true);
    setFormError(null);
    try {
      if (editing === 'new') {
        await api(tenantPath(tenant, '/seat-categories'), { method: 'POST', body: { id: form.id, ...body } });
        setMsg({ ok: `${body.label} created. Add prices below so seats in this category can be sold.` });
      } else if (editing) {
        await api(tenantPath(tenant, `/seat-categories/${encodeURIComponent(editing.id)}`), { method: 'PUT', body });
        setMsg({ ok: `${body.label} updated.` });
      }
      setEditing(null);
      cats.reload();
      pricing.reload();
    } catch (err) {
      setFormError(toErr(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(c: SeatCategoryDto) {
    if (!window.confirm(`Delete the ${c.label} category? Its ticket prices are removed too.`)) return;
    setMsg({});
    try {
      await api(tenantPath(tenant, `/seat-categories/${encodeURIComponent(c.id)}`), { method: 'DELETE' });
      setMsg({ ok: `${c.label} deleted.` });
      if (editing !== 'new' && editing?.id === c.id) setEditing(null);
      cats.reload();
      pricing.reload();
    } catch (err) {
      setMsg({ error: `Could not delete ${c.label}: ${errorMessage(err)}` });
    }
  }

  const setColour = (mode: 'light' | 'dark', key: 'fill' | 'accent', value: string) =>
    setForm((f) => ({ ...f, colours: { ...f.colours, [mode]: { ...f.colours[mode], [key]: value } } }));

  return (
    <>
      <PageHeader
        title="Seat categories & pricing"
        description="Categories give seats their label, icon, shape and colours in the app. Each category needs a price for every ticket type it is sold with."
        actions={
          can.canEditSeatCategories && (
            <button className="btn btn-primary" onClick={startNew}>
              Add category
            </button>
          )
        }
      />
      <ErrorNote message={msg.error ?? cats.error} />
      <SuccessNote message={msg.ok} />

      {editing && (
        <section className="card" aria-labelledby="cat-form-title">
          <h2 id="cat-form-title" className="h3">
            {editing === 'new' ? 'New seat category' : `Edit ${editing.label}`}
          </h2>
          <form onSubmit={submit} noValidate>
            <div className="form-grid cols-3">
              <div className="field">
                <label htmlFor="c-label">Label</label>
                <input
                  id="c-label"
                  maxLength={30}
                  value={form.label}
                  onChange={(e) => {
                    const label = e.target.value;
                    setForm((f) => ({ ...f, label, id: editing === 'new' && (f.id === '' || f.id === slugify(f.label)) ? slugify(label) : f.id }));
                  }}
                />
              </div>
              <div className="field">
                <label htmlFor="c-id">Id</label>
                {editing === 'new' ? (
                  <input id="c-id" value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} aria-describedby="c-id-help" />
                ) : (
                  <input id="c-id" value={form.id} readOnly disabled aria-describedby="c-id-help" />
                )}
                <p id="c-id-help" className="help">
                  {editing === 'new' ? 'Used by layouts and prices. Lowercase letters, numbers and hyphens.' : 'The id cannot change after creation.'}
                </p>
              </div>
              <div className="field">
                <label htmlFor="c-sort">Sort order</label>
                <input id="c-sort" type="number" step={1} value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} />
              </div>
              <div className="field span-all">
                <label htmlFor="c-desc">Description (optional)</label>
                <input id="c-desc" maxLength={140} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="c-shape">Shape</label>
                <select id="c-shape" value={form.shape} onChange={(e) => setForm({ ...form, shape: e.target.value })}>
                  {(cats.data?.shapes ?? []).map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="c-icon">Icon</label>
                <select id="c-icon" value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })} aria-describedby="c-icon-help">
                  <option value="">None</option>
                  {(cats.data?.icons ?? []).map((i) => (
                    <option key={i} value={i}>
                      {i}
                    </option>
                  ))}
                </select>
                <p id="c-icon-help" className="help">
                  SF Symbol name shown in the apps.
                </p>
              </div>
              <div className="field">
                <span className="label">Colours</span>
                <label className="check">
                  <input type="checkbox" checked={form.customColours} onChange={(e) => setForm({ ...form, customColours: e.target.checked })} />
                  Use custom colours
                </label>
                <p className="help">Otherwise the theme’s seat colours are used.</p>
              </div>
            </div>
            {form.customColours && (
              <fieldset className="plain mb-2">
                <legend>Custom colours</legend>
                <p className="help mb-2">Accents must reach 3:1 contrast against the seat map background on every theme you offer.</p>
                <div className="form-grid cols-4">
                  {COLOUR_FIELDS.map(({ mode, key, label }) => {
                    const val = form.colours[mode][key];
                    const valid = HEX.test(val);
                    const id = `c-${mode}-${key}`;
                    return (
                      <div className="field" key={id}>
                        <label htmlFor={id}>{label}</label>
                        <div className="colour-input">
                          <input type="color" aria-label={`${label} colour picker`} value={valid ? val.slice(0, 7) : '#000000'} onChange={(e) => setColour(mode, key, e.target.value.toUpperCase())} />
                          <input id={id} value={val} aria-invalid={!valid} maxLength={9} onChange={(e) => setColour(mode, key, e.target.value)} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </fieldset>
            )}
            <ApiErrorNote error={formError} />
            <div className="row gap-1">
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? 'Saving…' : editing === 'new' ? 'Create category' : 'Save changes'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="venue-block" aria-labelledby="cat-list-title">
        <h2 id="cat-list-title" className="h3 section-title">
          Seat categories
        </h2>
        {cats.loading && !cats.data && <Loading />}
        {cats.data && cats.data.categories.length === 0 && <p className="muted">No seat categories yet.</p>}
        {cats.data && cats.data.categories.length > 0 && (
          <ul className="tile-grid">
            {cats.data.categories.map((c) => (
              <li key={c.id} className="card tile cat-tile">
                <div className="tile-head">
                  <div>
                    <div className="tile-title">{c.label}</div>
                    <div className="muted small"><code>{c.id}</code> · {c.shape}{c.icon ? ` · ${c.icon}` : ''}</div>
                  </div>
                  <Swatches colours={c.colours} />
                </div>
                {c.description && <div className="small">{c.description}</div>}
                <div className="muted small">Order in the app: {c.sortOrder}</div>
                {(can.canEditSeatCategories || can.canDeleteSeatCategories) && (
                  <div className="tile-actions">
                    {can.canEditSeatCategories && (
                      <button className="btn btn-sm" onClick={() => startEdit(c)} aria-label={`Edit ${c.label}`}>
                        Edit
                      </button>
                    )}
                    {can.canDeleteSeatCategories && (
                      <button className="btn btn-sm btn-danger" onClick={() => remove(c)} aria-label={`Delete ${c.label}`}>
                        Delete
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <PricingGrid pricing={pricing.data} loading={pricing.loading} error={pricing.error} onSaved={(p) => pricing.setData(p)} />
      {pricing.data && <FeesEditor pricing={pricing.data} onSaved={(p) => pricing.setData(p)} />}
    </>
  );
}

function PricingGrid({ pricing, loading, error, onSaved }: { pricing: PricingResponse | null; loading: boolean; error: string | null; onSaved: (p: PricingResponse) => void }) {
  const { tenant, can } = useSession();
  const readOnly = !can.canEditPricing;
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; error?: ApiErr }>({});

  const original = useMemo(() => {
    const out: Record<string, string> = {};
    for (const tt of pricing?.ticketTypes ?? []) for (const c of pricing?.categories ?? []) out[`${tt.id}|${c.id}`] = minorToInput(tt.prices[c.id]);
    return out;
  }, [pricing]);

  useEffect(() => setValues(original), [original]);

  const changed = Object.keys(values).filter((k) => values[k].trim() !== original[k]);
  const invalid = Object.keys(values).filter((k) => Number.isNaN(inputToMinor(values[k])));

  async function save() {
    if (invalid.length) return setMsg({ error: { message: 'Prices must be amounts in pounds, such as 12.50. Leave a cell empty if the ticket is not sold.', details: [] } });
    setBusy(true);
    setMsg({});
    try {
      const prices = changed.map((k) => {
        const [ticketTypeId, priceCategory] = k.split('|');
        return { ticketTypeId, priceCategory, amountMinor: inputToMinor(values[k]) };
      });
      const res = await api<PricingResponse>(tenantPath(tenant, '/pricing'), { method: 'PUT', body: { prices } });
      onSaved(res);
      setMsg({ ok: `${prices.length} price${prices.length === 1 ? '' : 's'} saved.` });
    } catch (e) {
      setMsg({ error: toErr(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-labelledby="pricing-title">
      <div className="section-title">
        <h2 id="pricing-title" className="h3">
          Ticket prices
        </h2>
        {!readOnly && pricing && (
          <div className="row gap-1">
            {changed.length > 0 && <span className="muted small">{changed.length} unsaved change{changed.length === 1 ? '' : 's'}</span>}
            <button className="btn btn-ghost btn-sm" onClick={() => setValues(original)} disabled={busy || changed.length === 0}>
              Discard
            </button>
            <button className="btn btn-primary" onClick={save} disabled={busy || changed.length === 0}>
              {busy ? 'Saving…' : 'Save prices'}
            </button>
          </div>
        )}
      </div>
      {readOnly && <ReadOnlyNote>Only operator admins can change ticket prices. Prices are shown read-only.</ReadOnlyNote>}
      <ErrorNote message={error} />
      <ApiErrorNote error={msg.error ?? null} />
      <SuccessNote message={msg.ok} />
      {loading && !pricing && <Loading />}
      {pricing && (
        <>
          <div className="table-wrap">
            <table className="table pricing-table">
              <thead>
                <tr>
                  <th scope="col">Ticket type</th>
                  {pricing.categories.map((c) => (
                    <th scope="col" key={c.id}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pricing.ticketTypes.map((tt) => (
                  <tr key={tt.id}>
                    <th scope="row" className="row-head">
                      {tt.name}
                      <div className="muted small">{tt.code}</div>
                    </th>
                    {pricing.categories.map((c) => {
                      const k = `${tt.id}|${c.id}`;
                      const v = values[k] ?? '';
                      const bad = Number.isNaN(inputToMinor(v));
                      return (
                        <td key={c.id} className="tight">
                          {readOnly ? (
                            <span className="num">{tt.prices[c.id] == null ? <span className="muted">Not sold</span> : formatMoney(tt.prices[c.id] as number, pricing.currency)}</span>
                          ) : (
                            <div className="money-input">
                              <span aria-hidden="true">£</span>
                              <input
                                inputMode="decimal"
                                aria-label={`${tt.name} price for ${c.label}`}
                                placeholder="Not sold"
                                value={v}
                                aria-invalid={bad}
                                onChange={(e) => setValues((s) => ({ ...s, [k]: e.target.value }))}
                              />
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="help mt-2">
            Empty means the ticket type is not sold for that category. Prices exclude the booking fee and format supplements, which are set below.
            Changes apply to new quotes straight away; confirmed bookings keep what they were charged.
          </p>
        </>
      )}
    </section>
  );
}

interface SupplementRow {
  key: number;
  format: string;
  amount: string;
}

/** Per-ticket booking fee and format supplements (IMAX, 3D…), saved together. */
function FeesEditor({ pricing, onSaved }: { pricing: PricingResponse; onSaved: (p: PricingResponse) => void }) {
  const { tenant, can } = useSession();
  const readOnly = !can.canEditPricing;
  const [fee, setFee] = useState('');
  const [rows, setRows] = useState<SupplementRow[]>([]);
  const [nextKey, setNextKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; error?: ApiErr }>({});

  const original = useMemo(
    () => ({
      fee: minorToInput(pricing.bookingFeeMinor),
      rows: pricing.supplements.map((s, i) => ({ key: i, format: s.format, amount: minorToInput(s.amountMinor) })),
    }),
    [pricing],
  );

  function reset() {
    setFee(original.fee);
    setRows(original.rows);
    setNextKey(original.rows.length);
  }
  useEffect(reset, [original]);

  const serialise = (f: string, r: SupplementRow[]) => JSON.stringify([f.trim(), r.map((x) => [x.format.trim(), x.amount.trim()])]);
  const dirty = serialise(fee, rows) !== serialise(original.fee, original.rows);
  const known = new Set(pricing.knownFormats);
  const formatsLower = rows.map((r) => r.format.trim().toLowerCase());

  function problems(): string[] {
    const out: string[] = [];
    const feeMinor = inputToMinor(fee);
    if (feeMinor === null || Number.isNaN(feeMinor)) out.push('Enter a booking fee, such as 0.95 (use 0 for no fee).');
    rows.forEach((r, i) => {
      const name = r.format.trim() || `Row ${i + 1}`;
      if (!r.format.trim()) out.push(`Row ${i + 1}: enter a format name.`);
      const a = inputToMinor(r.amount);
      if (a === null || Number.isNaN(a)) out.push(`${name}: enter an amount, such as 4.00.`);
      if (r.format.trim() && formatsLower.indexOf(r.format.trim().toLowerCase()) !== i) out.push(`${name} is listed twice.`);
    });
    return out;
  }

  async function save() {
    const issues = problems();
    if (issues.length) return setMsg({ error: { message: 'Check the fees before saving.', details: issues } });
    setBusy(true);
    setMsg({});
    try {
      const res = await api<PricingResponse>(tenantPath(tenant, '/pricing/fees'), {
        method: 'PUT',
        body: { bookingFeePerTicketMinor: inputToMinor(fee), supplements: rows.map((r) => ({ format: r.format.trim(), amountMinor: inputToMinor(r.amount) })) },
      });
      onSaved(res);
      setMsg({ ok: 'Booking fee and supplements saved.' });
    } catch (e) {
      setMsg({ error: toErr(e) });
    } finally {
      setBusy(false);
    }
  }

  const update = (key: number, patch: Partial<SupplementRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <section className="card" aria-labelledby="fees-title">
      <div className="section-title">
        <h2 id="fees-title" className="h3">
          Booking fee &amp; format supplements
        </h2>
        {!readOnly && (
          <div className="row gap-1">
            <button className="btn btn-ghost btn-sm" onClick={reset} disabled={busy || !dirty}>
              Discard
            </button>
            <button className="btn btn-primary" onClick={save} disabled={busy || !dirty}>
              {busy ? 'Saving…' : 'Save fees'}
            </button>
          </div>
        )}
      </div>
      {readOnly && <ReadOnlyNote>Only operator admins can change fees and supplements.</ReadOnlyNote>}
      <ApiErrorNote error={msg.error ?? null} />
      <SuccessNote message={msg.ok} />

      <div className="field">
        <label htmlFor="booking-fee">Booking fee per ticket</label>
        {readOnly ? (
          <p className="num">{formatMoney(pricing.bookingFeeMinor, pricing.currency)}</p>
        ) : (
          <div className="money-input" style={{ maxWidth: 160 }}>
            <span aria-hidden="true">£</span>
            <input id="booking-fee" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} aria-describedby="booking-fee-help" />
          </div>
        )}
        <p id="booking-fee-help" className="help">
          Added once per ticket and shown to customers as a separate line before they pay.
        </p>
      </div>

      <h3 className="h4 mt-2">Format supplements</h3>
      <p className="help">Added to every ticket price for screenings in that format. A screening with several formats pays each supplement.</p>
      <datalist id="known-formats">
        {pricing.knownFormats.map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>
      {rows.length === 0 && <p className="muted">No supplements. Every format is charged at the standard ticket price.</p>}
      {rows.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Format</th>
                <th scope="col">Supplement per ticket</th>
                {!readOnly && <th scope="col"><span className="visually-hidden">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const unused = r.format.trim() !== '' && !known.has(r.format.trim());
                return (
                  <tr key={r.key}>
                    <td>
                      {readOnly ? (
                        r.format
                      ) : (
                        <input
                          list="known-formats"
                          aria-label={`Format name, row ${i + 1}`}
                          value={r.format}
                          maxLength={20}
                          onChange={(e) => update(r.key, { format: e.target.value })}
                          aria-describedby={unused ? `unused-${r.key}` : undefined}
                        />
                      )}
                      {unused && (
                        <div id={`unused-${r.key}`} className="help help-warning">
                          No screenings use “{r.format.trim()}”. Names must match exactly, including capitals.
                        </div>
                      )}
                    </td>
                    <td className="tight">
                      {readOnly ? (
                        <span className="num">{formatMoney(inputToMinor(r.amount) ?? 0, pricing.currency)}</span>
                      ) : (
                        <div className="money-input">
                          <span aria-hidden="true">£</span>
                          <input inputMode="decimal" aria-label={`Supplement for ${r.format || `row ${i + 1}`}`} value={r.amount} onChange={(e) => update(r.key, { amount: e.target.value })} />
                        </div>
                      )}
                    </td>
                    {!readOnly && (
                      <td className="tight">
                        <button className="btn btn-ghost btn-sm" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} aria-label={`Remove ${r.format || `row ${i + 1}`}`}>
                          Remove
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {!readOnly && (
        <button
          className="btn btn-ghost btn-sm mt-2"
          onClick={() => {
            setRows((rs) => [...rs, { key: nextKey, format: '', amount: '' }]);
            setNextKey((k) => k + 1);
          }}
          disabled={rows.length >= 20}
        >
          Add supplement
        </button>
      )}
    </section>
  );
}
