'use client';

import { FormEvent, useState } from 'react';
import { api, errorDetails, errorMessage, Film, Promotion, PromotionActionKind, tenantPath, Venue, Voucher } from '@/lib/api';
import { useSession, useTenantData } from '@/lib/session';
import { formatDate } from '@/lib/format';
import { ApiErrorNote, ErrorNote, Loading, PageHeader, ReadOnlyNote, SuccessNote } from '@/components/ui';
import { ScopeNote, useCinemaScope } from '@/lib/cinema-scope';
import { Sheet, TileHit } from '@/components/Sheet';
import { OfferBanner } from '@/components/OfferBanner';
import { MAX_UPLOAD_BYTES, readFileBase64 } from '@/lib/files';

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
  imageAssetId: string | null;
  imageUrl: string | null;
}

const EMPTY: Form = { title: '', body: '', ctaLabel: ACTIONS.voucher.cta, action: 'voucher', filmId: '', voucherCode: '', linkUrl: '', venueId: '', validFrom: '', validTo: '', active: true, sortOrder: '0', imageAssetId: null, imageUrl: null };

const startOfDay = (d: string) => (d ? `${d}T00:00:00.000Z` : null);
const endOfDay = (d: string) => (d ? `${d}T23:59:59.000Z` : null);
const dateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : '');

function toForm(p: Promotion): Form {
  return {
    title: p.title, body: p.body, ctaLabel: p.ctaLabel, action: p.action,
    filmId: p.filmId ?? '', voucherCode: p.voucherCode ?? '', linkUrl: p.linkUrl ?? '', venueId: p.venueId ?? '',
    validFrom: dateInput(p.validFrom), validTo: dateInput(p.validTo), active: p.active, sortOrder: String(p.sortOrder),
    imageAssetId: p.imageAssetId, imageUrl: p.imageAssetId ? p.image?.url ?? null : null,
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
  const [uploading, setUploading] = useState(false);

  async function uploadPhoto(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/')) return fail('Choose a JPEG, PNG or WebP image.');
    if (file.size > MAX_UPLOAD_BYTES) return fail('That image is over 10 MB. Choose a smaller one.');
    setUploading(true);
    setFormError(null);
    try {
      const res = await api<{ id: string; url: string }>(tenantPath(tenant, '/media'), { method: 'POST', body: { kind: 'BANNER', dataBase64: await readFileBase64(file) } });
      setForm((f) => ({ ...f, imageAssetId: res.id, imageUrl: res.url }));
    } catch (err) {
      setFormError({ message: errorMessage(err), details: errorDetails(err) });
    } finally {
      setUploading(false);
    }
  }
  /** Film offers without their own photo use the film's backdrop, as the app does. */
  const backdropOf = (filmId: string) => films.data?.find((f) => f.id === filmId)?.backdrop?.url ?? null;

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
      imageAssetId: form.imageAssetId,
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
        title="Offers"
        description="Offers on the app home screen, in the Offers section. Changes show in the app straight away; no release needed."
        actions={canEdit && <button className="btn btn-primary" onClick={() => open('new')}>Create offer</button>}
      />
      {!canEdit && <ReadOnlyNote>Only operator admins and content editors can change offers.</ReadOnlyNote>}
      <ErrorNote message={msg.error ?? promotions.error} />
      <SuccessNote message={msg.ok} />

      <ScopeNote what="promotions" />
      <Sheet
        open={!!editing && canEdit}
        title={editing === 'new' ? 'New offer' : editing ? `Edit “${editing.title}”` : 'Offer'}
        subtitle="Shows on the app home screen straight away. No release needed."
        onClose={() => setEditing(null)}
        onSubmit={submit}
        footer={
          <>
            <button type="submit" className="btn btn-primary" disabled={busy || uploading}>
              {busy ? 'Saving…' : editing === 'new' ? 'Create offer' : 'Save changes'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>
              Cancel
            </button>
            {editing && editing !== 'new' && (
              <button type="button" className="btn btn-danger sheet-foot-end" onClick={() => remove(editing)} disabled={busy}>
                Delete
              </button>
            )}
          </>
        }
      >
        <div className="offer-sheet-preview" aria-label="Preview">
          <OfferBanner
            title={form.title}
            body={form.body}
            cta={form.action === 'none' ? null : form.ctaLabel}
            code={form.action === 'voucher' ? form.voucherCode || null : null}
            imageUrl={form.imageUrl ?? (form.action === 'film' ? backdropOf(form.filmId) : null)}
            filmTitle={form.action === 'film' && form.filmId ? filmTitle(form.filmId) : null}
          />
        </div>
        <div className="row gap-1 offer-photo-row">
          <label className={`btn btn-sm file-btn${uploading ? ' disabled' : ''}`}>
            {uploading ? 'Uploading…' : form.imageAssetId ? 'Replace photo' : 'Add a photo'}
            <input type="file" accept="image/jpeg,image/png,image/webp" className="visually-hidden" disabled={uploading} onChange={(e) => uploadPhoto(e.target.files?.[0])} />
          </label>
          {form.imageAssetId && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setForm({ ...form, imageAssetId: null, imageUrl: null })}>
              Remove photo
            </button>
          )}
          <span className="help">{form.action === 'film' && !form.imageAssetId ? 'Film offers use the film’s backdrop unless you add a photo.' : 'Wide photos work best, around 1600 × 800.'}</span>
        </div>
        <div className="form-grid">
          <div className="field span-2">
            <label htmlFor="pr-t">Title</label>
            <input id="pr-t" maxLength={60} value={form.title} onChange={set('title')} placeholder="New here? 10% off" aria-describedby="pr-t-help" />
            <p id="pr-t-help" className="help">A saving such as “10% off” becomes the big line; otherwise the last word does, or the film’s name for a film offer.</p>
          </div>
          <div className="field span-2">
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
              Showing in the app
            </label>
          </div>
        </div>
        <ApiErrorNote error={formError} />
      </Sheet>

      <section aria-label="Offers">
        {promotions.loading && !promotions.data && <Loading />}
        {promotions.data && shown.length === 0 && <p className="muted">{scope.venue ? `No offers for ${scope.venue.name} yet.` : 'No offers yet. The Offers section stays hidden in the app until there is one.'}</p>}
        {shown.length > 0 && (
          <ul className="tile-grid wide">
            {shown.map((p) => {
              const s = status(p);
              return (
                <li key={p.id} className={`card tile offer-tile${p.active ? '' : ' is-off'}${canEdit ? ' tile-click' : ''}`}>
                  {canEdit && <TileHit label={`Edit ${p.title}`} onClick={() => open(p)} />}
                  <OfferBanner
                    title={p.title}
                    body={p.body}
                    cta={p.action === 'none' ? null : p.ctaLabel}
                    code={p.action === 'voucher' ? p.voucherCode : null}
                    imageUrl={p.image?.url}
                    filmTitle={p.action === 'film' ? filmTitle(p.filmId) : null}
                  />
                  <div className="offer-meta">
                  <div className="tile-head">
                    <span className={`badge badge-${s.tone}`}>{s.label}</span>
                  </div>
                  <dl className="tile-meta">
                    <dt>Button</dt>
                    <dd>
                      {p.action === 'none' && <span className="muted">None</span>}
                      {p.action === 'voucher' && <>Shows code <code>{p.voucherCode}</code></>}
                      {p.action === 'film' && <>Opens {filmTitle(p.filmId)}</>}
                      {p.action === 'link' && <span className="break">{p.linkUrl}</span>}
                    </dd>
                    <dt>Where</dt>
                    <dd>{venueName(p.venueId)}</dd>
                    <dt>When</dt>
                    <dd>{schedule(p)}</dd>
                  </dl>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
