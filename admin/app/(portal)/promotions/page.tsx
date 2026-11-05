'use client';

import { FormEvent, useState } from 'react';
import { api, errorDetails, errorMessage, Film, Promotion, PromotionActionKind, tenantPath, Venue, Voucher } from '@/lib/api';
import { useSession, useTenantData } from '@/lib/session';
import { formatDate } from '@/lib/format';
import { ApiErrorNote, ErrorNote, Loading, PageHeader, ReadOnlyNote, SuccessNote } from '@/components/ui';
import { ScopeNote, useCinemaScope } from '@/lib/cinema-scope';

type ApiErr = { message: string; details: string[] } | null;

const ACTIONS: Record<PromotionActionKind, { label: string; help: string; cta: string }> = {
  voucher: { label: 'Show a voucher code', help: 'Customers see the code and can copy it. Hidden automatically while the voucher cannot be used.', cta: 'Show code' },
  film: { label: 'Open a film', help: 'Opens the film page, where customers can book.', cta: 'Book now' },
  link: { label: 'Open a web page', help: 'Opens in Safari. Must start with https://.', cta: 'Find out more' },
  none: { label: 'No button', help: 'Information only.', cta: '' },
};

interface Form {
  title: string;
  body: string;
  ctaLabel: string;
  action: PromotionActionKind;
  filmId: string;
  voucherCode: string;
  linkUrl: string;
  venueId: string;
  validFrom: string;
  validTo: string;
  active: boolean;
  sortOrder: string;
}

const EMPTY: Form = { title: '', body: '', ctaLabel: ACTIONS.voucher.cta, action: 'voucher', filmId: '', voucherCode: '', linkUrl: '', venueId: '', validFrom: '', validTo: '', active: true, sortOrder: '0' };

const startOfDay = (d: string) => (d ? `${d}T00:00:00.000Z` : null);
const endOfDay = (d: string) => (d ? `${d}T23:59:59.000Z` : null);
const dateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : '');

function toForm(p: Promotion): Form {
  return {
    title: p.title, body: p.body, ctaLabel: p.ctaLabel, action: p.action,
    filmId: p.filmId ?? '', voucherCode: p.voucherCode ?? '', linkUrl: p.linkUrl ?? '', venueId: p.venueId ?? '',
    validFrom: dateInput(p.validFrom), validTo: dateInput(p.validTo), active: p.active, sortOrder: String(p.sortOrder),
  };
}

function schedule(p: Promotion) {
  if (!p.validFrom && !p.validTo) return 'Always';
  if (p.validFrom && p.validTo) return `${formatDate(p.validFrom)} to ${formatDate(p.validTo)}`;
  return p.validTo ? `Until ${formatDate(p.validTo)}` : `From ${formatDate(p.validFrom)}`;
}

/** What customers see right now, in plain words. */
function status(p: Promotion): { label: string; tone: 'success' | 'neutral' | 'warning' } {
  if (!p.active) return { label: 'Off', tone: 'neutral' };
  const now = new Date().toISOString();
  if (p.validFrom && p.validFrom > now) return { label: 'Scheduled', tone: 'neutral' };
  if (p.validTo && p.validTo <= now) return { label: 'Ended', tone: 'neutral' };
  if (p.showing === false) return { label: p.action === 'voucher' ? 'Hidden: voucher not usable' : 'Hidden: film not listed', tone: 'warning' };
  return { label: 'Showing', tone: 'success' };
}

export default function PromotionsPage() {
  const { tenant, can } = useSession();
  const canEdit = can.canEditContent;
  const promotions = useTenantData<Promotion[]>(tenantPath(tenant, '/promotions'));
  const scope = useCinemaScope();
  const shown = (promotions.data ?? []).filter((p) => scope.includes(p.venueId));
  const films = useTenantData<Film[]>(tenantPath(tenant, '/films'));
  const venues = useTenantData<Venue[]>(tenantPath(tenant, '/venues'));
  const vouchers = useTenantData<Voucher[]>(tenantPath(tenant, '/vouchers'));
  const [editing, setEditing] = useState<Promotion | 'new' | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<ApiErr>(null);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});

  const fail = (message: string) => setFormError({ message, details: [] });
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const filmTitle = (id: string | null) => films.data?.find((f) => f.id === id)?.title ?? 'Unknown film';
  const venueName = (id: string | null) => (id ? venues.data?.find((v) => v.id === id)?.name ?? 'Unknown cinema' : 'All cinemas');

  function open(p: Promotion | 'new') {
    setEditing(p);
    setForm(p === 'new' ? { ...EMPTY, venueId: scope.venueId ?? '' } : toForm(p));
    setFormError(null);
    setMsg({});
  }

  function setAction(action: PromotionActionKind) {
    // Swap the suggested button label only if the operator has not written their own.
    setForm((f) => ({ ...f, action, ctaLabel: !f.ctaLabel || f.ctaLabel === ACTIONS[f.action].cta ? ACTIONS[action].cta : f.ctaLabel }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return fail('Enter a title.');
    if (!form.body.trim()) return fail('Enter the promotion text.');
    if (form.action !== 'none' && !form.ctaLabel.trim()) return fail('Enter a button label, such as "Book now".');
    if (form.action === 'film' && !form.filmId) return fail('Choose a film.');
    if (form.action === 'voucher' && !form.voucherCode) return fail('Choose a voucher.');
    if (form.action === 'link' && !/^https:\/\/\S+$/.test(form.linkUrl.trim())) return fail('Enter a web address starting with https://');
    if (form.validFrom && form.validTo && form.validFrom > form.validTo) return fail('The end date must be on or after the start date.');
    const sortOrder = Number.parseInt(form.sortOrder || '0', 10);
    if (!Number.isFinite(sortOrder) || sortOrder < 0) return fail('Order must be 0 or more.');
    const body = {
      title: form.title.trim(), body: form.body.trim(), ctaLabel: form.action === 'none' ? '' : form.ctaLabel.trim(), action: form.action,
      filmId: form.filmId || null, voucherCode: form.voucherCode || null, linkUrl: form.linkUrl.trim() || null, venueId: form.venueId || null,
      validFrom: startOfDay(form.validFrom), validTo: endOfDay(form.validTo), active: form.active, sortOrder,
    };
    setBusy(true);
    setFormError(null);
    try {
      if (editing === 'new') await api(tenantPath(tenant, '/promotions'), { method: 'POST', body });
      else if (editing) await api(tenantPath(tenant, `/promotions/${editing.id}`), { method: 'PUT', body });
      setMsg({ ok: `“${body.title}” ${editing === 'new' ? 'created' : 'saved'}.` });
      setEditing(null);
      promotions.reload();
    } catch (err) {
      setFormError({ message: errorMessage(err), details: errorDetails(err) });
    } finally {
      setBusy(false);
    }
  }

  async function toggle(p: Promotion) {
    setMsg({});
    try {
      await api(tenantPath(tenant, `/promotions/${p.id}`), { method: 'PUT', body: { active: !p.active } });
      setMsg({ ok: `“${p.title}” turned ${p.active ? 'off' : 'on'}.` });
      promotions.reload();
    } catch (err) {
      setMsg({ error: errorMessage(err) });
    }
  }

  async function remove(p: Promotion) {
    if (!window.confirm(`Delete “${p.title}”? This cannot be undone. Turn it off instead to keep it for later.`)) return;
    setMsg({});
    try {
      await api(tenantPath(tenant, `/promotions/${p.id}`), { method: 'DELETE' });
      setMsg({ ok: `“${p.title}” deleted.` });
      if (editing !== 'new' && editing?.id === p.id) setEditing(null);
      promotions.reload();
    } catch (err) {
      setMsg({ error: errorMessage(err) });
    }
  }

  const usableVouchers = (vouchers.data ?? []).filter((v) => v.active || v.code === form.voucherCode);

  return (
    <>
      <PageHeader
        title="Promotions"
        description="Offers on the app home screen, in the Offers section. Changes show in the app straight away; no release needed."
        actions={canEdit && <button className="btn btn-primary" onClick={() => open('new')}>Create promotion</button>}
      />
      {!canEdit && <ReadOnlyNote>Only operator admins and content editors can change promotions.</ReadOnlyNote>}
      <ErrorNote message={msg.error ?? promotions.error} />
      <SuccessNote message={msg.ok} />

      <ScopeNote what="promotions" />
      {editing && canEdit && (
        <section className="card" aria-labelledby="pr-title">
          <h2 id="pr-title" className="h3">
            {editing === 'new' ? 'New promotion' : `Edit “${editing.title}”`}
          </h2>
          <form onSubmit={submit} noValidate>
            <div className="form-grid cols-3">
              <div className="field span-all">
                <label htmlFor="pr-t">Title</label>
                <input id="pr-t" maxLength={60} value={form.title} onChange={set('title')} placeholder="New here? 10% off" />
              </div>
              <div className="field span-all">
                <label htmlFor="pr-b">Text</label>
                <textarea id="pr-b" maxLength={200} rows={2} value={form.body} onChange={set('body')} aria-describedby="pr-b-help" />
                <p id="pr-b-help" className="help">
                  {form.body.length}/200 characters. Keep it to a sentence or two.
                </p>
              </div>
              <div className="field">
                <label htmlFor="pr-a">Button</label>
                <select id="pr-a" value={form.action} onChange={(e) => setAction(e.target.value as PromotionActionKind)} aria-describedby="pr-a-help">
                  {(Object.keys(ACTIONS) as PromotionActionKind[]).map((k) => (
                    <option key={k} value={k}>
                      {ACTIONS[k].label}
                    </option>
                  ))}
                </select>
                <p id="pr-a-help" className="help">
                  {ACTIONS[form.action].help}
                </p>
              </div>
              {form.action === 'voucher' && (
                <div className="field">
                  <label htmlFor="pr-v">Voucher</label>
                  <select id="pr-v" value={form.voucherCode} onChange={set('voucherCode')}>
                    <option value="">Choose a voucher</option>
                    {usableVouchers.map((v) => (
                      <option key={v.id} value={v.code}>
                        {v.code} · {v.description}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {form.action === 'film' && (
                <div className="field">
                  <label htmlFor="pr-f">Film</label>
                  <select id="pr-f" value={form.filmId} onChange={set('filmId')}>
                    <option value="">Choose a film</option>
                    {(films.data ?? []).map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.title}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {form.action === 'link' && (
                <div className="field">
                  <label htmlFor="pr-l">Web address</label>
                  <input id="pr-l" type="url" inputMode="url" maxLength={500} value={form.linkUrl} onChange={set('linkUrl')} placeholder="https://" />
                </div>
              )}
              {form.action !== 'none' && (
                <div className="field">
                  <label htmlFor="pr-c">Button label</label>
                  <input id="pr-c" maxLength={24} value={form.ctaLabel} onChange={set('ctaLabel')} />
                </div>
              )}
              <div className="field">
                <label htmlFor="pr-venue">Where</label>
                <select id="pr-venue" value={form.venueId} onChange={set('venueId')}>
                  <option value="">All cinemas</option>
                  {(venues.data ?? []).map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="pr-from">Starts (optional)</label>
                <input id="pr-from" type="date" value={form.validFrom} onChange={set('validFrom')} />
              </div>
              <div className="field">
                <label htmlFor="pr-to">Ends (optional)</label>
                <input id="pr-to" type="date" value={form.validTo} onChange={set('validTo')} />
              </div>
              <div className="field">
                <label htmlFor="pr-order">Order</label>
                <input id="pr-order" type="number" min={0} max={999} step={1} value={form.sortOrder} onChange={set('sortOrder')} aria-describedby="pr-order-help" />
                <p id="pr-order-help" className="help">
                  Lower numbers show first.
                </p>
              </div>
              <div className="field span-2">
                <span className="label">Status</span>
                <label className="switch">
                  <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
                  On
                </label>
              </div>
            </div>
            <ApiErrorNote error={formError} />
            <div className="row gap-1">
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? 'Saving…' : editing === 'new' ? 'Create promotion' : 'Save changes'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="card" aria-label="Promotions list">
        {promotions.loading && !promotions.data && <Loading />}
        {promotions.data && shown.length === 0 && <p className="muted">{scope.venue ? `No promotions for ${scope.venue.name} yet.` : 'No promotions yet. The Offers section stays hidden in the app until there is one.'}</p>}
        {shown.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Promotion</th>
                  <th scope="col">Button</th>
                  <th scope="col">Where</th>
                  <th scope="col">When</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => {
                  const s = status(p);
                  return (
                    <tr key={p.id}>
                      <td>
                        <span className="strong">{p.title}</span>
                        <div className="muted small">{p.body}</div>
                      </td>
                      <td className="small">
                        {p.action === 'none' ? (
                          <span className="muted">None</span>
                        ) : (
                          <>
                            {p.ctaLabel}
                            <div className="muted">
                              {p.action === 'voucher' && <code>{p.voucherCode}</code>}
                              {p.action === 'film' && filmTitle(p.filmId)}
                              {p.action === 'link' && <span className="break">{p.linkUrl}</span>}
                            </div>
                          </>
                        )}
                      </td>
                      <td className="small">{venueName(p.venueId)}</td>
                      <td className="small nowrap">{schedule(p)}</td>
                      <td>
                        <span className={`badge badge-${s.tone}`}>{s.label}</span>
                      </td>
                      <td className="actions">
                        {canEdit && (
                          <>
                            <button className="btn btn-sm" onClick={() => open(p)} aria-label={`Edit ${p.title}`}>
                              Edit
                            </button>
                            <button className="btn btn-sm" onClick={() => toggle(p)} aria-label={`Turn ${p.active ? 'off' : 'on'} ${p.title}`}>
                              {p.active ? 'Turn off' : 'Turn on'}
                            </button>
                            <button className="btn btn-sm btn-danger" onClick={() => remove(p)} aria-label={`Delete ${p.title}`}>
                              Delete
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
