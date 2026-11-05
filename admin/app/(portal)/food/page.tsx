'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { api, Concession, errorDetails, errorMessage, mediaUrl, ModifierGroup, StockStatus, tenantPath, Venue } from '@/lib/api';
import { MAX_UPLOAD_BYTES, readFileBase64 } from '@/lib/files';
import { SafeImage } from '@/components/SafeImage';
import { useSession, useTenantData } from '@/lib/session';
import { formatMoney, inputToMinor, minorToInput } from '@/lib/format';
import { ApiErrorNote, ErrorNote, Loading, PageHeader, ReadOnlyNote, SuccessNote } from '@/components/ui';
import { ScopeNote, useCinemaScope } from '@/lib/cinema-scope';

type ApiErr = { message: string; details: string[] } | null;

interface OptionForm {
  key: number;
  id: string;
  name: string;
  price: string;
}
interface GroupForm {
  key: number;
  id: string;
  name: string;
  min: string;
  max: string;
  options: OptionForm[];
}
interface ProductForm {
  sku: string;
  name: string;
  description: string;
  category: string;
  price: string;
  calories: string;
  stockStatus: StockStatus;
  available: boolean;
  venueId: string;
  allergens: string;
  dietary: string;
  bundleItems: string;
  sortOrder: string;
  groups: GroupForm[];
  imageAssetId: string | null;
  imageUrl: string | null;
}

const EMPTY: ProductForm = {
  sku: '',
  name: '',
  description: '',
  category: '',
  price: '',
  calories: '',
  stockStatus: 'inStock',
  available: true,
  venueId: '',
  allergens: '',
  dietary: '',
  bundleItems: '',
  sortOrder: '0',
  groups: [],
  imageAssetId: null,
  imageUrl: null,
};

const STOCK_LABEL: Record<StockStatus, string> = { inStock: 'In stock', low: 'Low stock', out: 'Out of stock' };
const STOCK_CLASS: Record<StockStatus, string> = { inStock: 'badge-success', low: 'badge-warning', out: 'badge-danger' };

let keySeq = 1;
const nextKey = () => keySeq++;
const slugify = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
const list = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

function toForm(p: Concession): ProductForm {
  return {
    sku: p.sku,
    name: p.name,
    description: p.description ?? '',
    category: p.category,
    price: minorToInput(p.priceMinor),
    calories: p.calories == null ? '' : String(p.calories),
    stockStatus: p.stockStatus,
    available: p.available,
    venueId: p.venueId ?? '',
    allergens: p.allergens.join(', '),
    dietary: p.dietary.join(', '),
    bundleItems: p.bundleItems.join(', '),
    sortOrder: String(p.sortOrder),
    imageAssetId: p.imageAssetId,
    imageUrl: p.image?.url ?? null,
    groups: p.modifierGroups.map((g) => ({
      key: nextKey(),
      id: g.id,
      name: g.name,
      min: String(g.min),
      max: String(g.max),
      options: g.options.map((o) => ({ key: nextKey(), id: o.id, name: o.name, price: minorToInput(o.priceMinor) })),
    })),
  };
}

/** Builds the API body, or returns an error message for the first invalid field. */
function toBody(f: ProductForm): { body?: Record<string, unknown>; error?: string } {
  if (!/^[A-Z0-9-]+$/.test(f.sku)) return { error: 'SKU may contain only capital letters, numbers and hyphens.' };
  if (!f.name.trim()) return { error: 'Enter a product name.' };
  if (!f.category.trim()) return { error: 'Enter a category, such as Snacks or Drinks.' };
  const price = inputToMinor(f.price);
  if (price === null || Number.isNaN(price)) return { error: 'Enter a price in pounds, such as 4.50.' };
  const calories = f.calories.trim() === '' ? null : Number.parseInt(f.calories, 10);
  if (calories !== null && (!Number.isFinite(calories) || calories < 0)) return { error: 'Calories must be a whole number.' };
  const groups: ModifierGroup[] = [];
  for (const g of f.groups) {
    const name = g.name.trim() || 'Untitled group';
    if (!g.name.trim()) return { error: 'Every modifier group needs a name.' };
    if (g.options.length === 0) return { error: `${name} needs at least one option.` };
    const min = Number.parseInt(g.min, 10);
    const max = Number.parseInt(g.max, 10);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max < 1 || min > max || max > g.options.length) {
      return { error: `${name}: minimum must be no more than maximum, and maximum no more than the number of options.` };
    }
    const options = [];
    for (const o of g.options) {
      if (!o.name.trim()) return { error: `${name}: every option needs a name.` };
      const p = o.price.trim() === '' ? 0 : inputToMinor(o.price);
      if (p === null || Number.isNaN(p)) return { error: `${name}: option prices must be amounts such as 0.50.` };
      options.push({ id: o.id || slugify(o.name), name: o.name.trim(), priceMinor: p });
    }
    if (new Set(options.map((o) => o.id)).size !== options.length) return { error: `${name}: option names must be different.` };
    groups.push({ id: g.id || slugify(name), name, min, max, options });
  }
  if (new Set(groups.map((g) => g.id)).size !== groups.length) return { error: 'Modifier group names must be different.' };
  const sortOrder = Number.parseInt(f.sortOrder, 10);
  return {
    body: {
      sku: f.sku,
      name: f.name.trim(),
      description: f.description.trim() || null,
      category: f.category.trim(),
      priceMinor: price,
      allergens: list(f.allergens),
      dietary: list(f.dietary),
      calories,
      stockStatus: f.stockStatus,
      available: f.available,
      venueId: f.venueId || null,
      modifierGroups: groups,
      bundleItems: list(f.bundleItems),
      sortOrder: Number.isFinite(sortOrder) ? sortOrder : 0,
      imageAssetId: f.imageAssetId,
    },
  };
}

export default function FoodPage() {
  const { tenant, can } = useSession();
  const products = useTenantData<Concession[]>(tenantPath(tenant, '/concessions'));
  const venues = useTenantData<Venue[]>(tenantPath(tenant, '/venues'));
  const [editing, setEditing] = useState<Concession | 'new' | null>(null);
  const [form, setForm] = useState<ProductForm>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<ApiErr>(null);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const [uploading, setUploading] = useState(false);
  const [category, setCategory] = useState<string>('all');
  const [query, setQuery] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);

  const scope = useCinemaScope();
  const grouped = useMemo(() => {
    const m = new Map<string, Concession[]>();
    for (const p of products.data ?? []) if (scope.includes(p.venueId)) m.set(p.category, [...(m.get(p.category) ?? []), p]);
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [products.data, scope]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return grouped
      .filter(([c]) => category === 'all' || c === category)
      .map(([c, items]) => [c, q ? items.filter((p) => `${p.name} ${p.sku}`.toLowerCase().includes(q)) : items] as const)
      .filter(([, items]) => items.length > 0);
  }, [grouped, category, query]);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (editing && !d.open) d.showModal();
    if (!editing && d.open) d.close();
  }, [editing]);
  const venueName = (id: string | null) => (id ? venues.data?.find((v) => v.id === id)?.name ?? 'One cinema' : 'All cinemas');
  const cur = 'GBP';

  function startNew() {
    setEditing('new');
    setForm({ ...EMPTY, venueId: scope.venueId ?? '' });
    setFormError(null);
    setMsg({});
  }
  function startEdit(p: Concession) {
    setEditing(p);
    setForm(toForm(p));
    setFormError(null);
    setMsg({});
  }

  async function uploadImage(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/')) return setFormError({ message: 'Choose a JPEG, PNG or WebP image.', details: [] });
    if (file.size > MAX_UPLOAD_BYTES) return setFormError({ message: 'That image is over 10 MB. Choose a smaller one.', details: [] });
    setUploading(true);
    setFormError(null);
    try {
      const res = await api<{ id: string; url: string }>(tenantPath(tenant, '/media'), { method: 'POST', body: { kind: 'PRODUCT', dataBase64: await readFileBase64(file) } });
      setForm((f) => ({ ...f, imageAssetId: res.id, imageUrl: res.url }));
    } catch (err) {
      setFormError({ message: errorMessage(err), details: errorDetails(err) });
    } finally {
      setUploading(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const { body, error } = toBody(form);
    if (error || !body) return setFormError({ message: error ?? 'Check the form.', details: [] });
    setBusy(true);
    setFormError(null);
    try {
      if (editing === 'new') {
        await api(tenantPath(tenant, '/concessions'), { method: 'POST', body });
        setMsg({ ok: `${body.name} created.` });
      } else if (editing) {
        await api(tenantPath(tenant, `/concessions/${editing.id}`), { method: 'PUT', body });
        setMsg({ ok: `${body.name} updated.` });
      }
      setEditing(null);
      products.reload();
    } catch (err) {
      setFormError({ message: errorMessage(err), details: errorDetails(err) });
    } finally {
      setBusy(false);
    }
  }

  async function toggleAvailable(p: Concession) {
    setMsg({});
    try {
      const row = await api<Concession>(tenantPath(tenant, `/concessions/${p.id}`), { method: 'PUT', body: { available: !p.available } });
      products.setData((list) => list?.map((x) => (x.id === p.id ? row : x)) ?? null);
      setMsg({ ok: `${p.name} is now ${row.available ? 'available' : 'hidden from the menu'}.` });
    } catch (err) {
      setMsg({ error: errorMessage(err) });
    }
  }

  async function remove(p: Concession) {
    if (!window.confirm(`Delete ${p.name}? Past orders keep their item names and prices.`)) return;
    setMsg({});
    try {
      await api(tenantPath(tenant, `/concessions/${p.id}`), { method: 'DELETE' });
      setMsg({ ok: `${p.name} deleted.` });
      setEditing(null);
      products.reload();
    } catch (err) {
      setMsg({ error: errorMessage(err) });
    }
  }

  const set = (k: keyof ProductForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const updateGroup = (key: number, patch: Partial<GroupForm>) => setForm((f) => ({ ...f, groups: f.groups.map((g) => (g.key === key ? { ...g, ...patch } : g)) }));
  const updateOption = (gk: number, ok: number, patch: Partial<OptionForm>) =>
    setForm((f) => ({ ...f, groups: f.groups.map((g) => (g.key === gk ? { ...g, options: g.options.map((o) => (o.key === ok ? { ...o, ...patch } : o)) } : g)) }));

  return (
    <>
      <PageHeader
        title="Food & drink"
        description="Products customers can add to a booking or order to their seat. Prices are in pounds and include VAT."
        actions={
          can.canEditConcessions && (
            <button className="btn btn-primary" onClick={startNew}>
              Add product
            </button>
          )
        }
      />
      <ScopeNote what="the menu" />
      {!can.canEditConcessions && <ReadOnlyNote>Your role can view the menu but not change it.</ReadOnlyNote>}
      <ErrorNote message={msg.error ?? products.error} />
      <SuccessNote message={msg.ok} />

      <dialog ref={dialog} className="sheet" aria-labelledby="p-form-title" onClose={() => setEditing(null)} onCancel={() => setEditing(null)}>
        {editing && (
          <form onSubmit={submit} noValidate>
            <div className="sheet-head">
              <h2 id="p-form-title" className="h3">
                {editing === 'new' ? 'New product' : `Edit ${editing.name}`}
              </h2>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(null)} aria-label="Close">
                Close
              </button>
            </div>

            <div className="image-field">
              <div className="image-field-preview">
                <SafeImage src={mediaUrl(form.imageUrl, 780)} alt="" fallback={<ProductPlaceholder name={form.name || 'New product'} />} />
              </div>
              <div className="image-field-side">
                <div className="label">Photo</div>
                <p className="help">Shown on the menu in the app. Landscape works best, around 1200 × 900. JPEG, PNG or WebP up to 10 MB.</p>
                <div className="row gap-1 mt-2">
                  <label className={`btn btn-sm file-btn${uploading ? ' disabled' : ''}`}>
                    {uploading ? 'Uploading…' : form.imageAssetId ? 'Replace photo' : 'Upload photo'}
                    <input type="file" accept="image/jpeg,image/png,image/webp" className="visually-hidden" disabled={uploading} onChange={(e) => uploadImage(e.target.files?.[0])} />
                  </label>
                  {form.imageAssetId && (
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => setForm({ ...form, imageAssetId: null, imageUrl: null })}>
                      Remove
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="form-grid cols-3">
              <div className="field">
                <label htmlFor="p-name">Name</label>
                <input id="p-name" maxLength={60} value={form.name} onChange={set('name')} />
              </div>
              <div className="field">
                <label htmlFor="p-sku">SKU</label>
                <input id="p-sku" maxLength={30} value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value.toUpperCase() })} aria-describedby="p-sku-help" />
                <p id="p-sku-help" className="help">
                  Capital letters, numbers and hyphens.
                </p>
              </div>
              <div className="field">
                <label htmlFor="p-cat">Category</label>
                <input id="p-cat" list="p-cat-list" maxLength={30} value={form.category} onChange={set('category')} />
                <datalist id="p-cat-list">
                  {grouped.map(([c]) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>
              <div className="field span-all">
                <label htmlFor="p-desc">Description (optional)</label>
                <input id="p-desc" maxLength={200} value={form.description} onChange={set('description')} />
              </div>
              <div className="field">
                <label htmlFor="p-price">Price</label>
                <div className="money-input">
                  <span aria-hidden="true">£</span>
                  <input id="p-price" inputMode="decimal" value={form.price} onChange={set('price')} placeholder="0.00" />
                </div>
              </div>
              <div className="field">
                <label htmlFor="p-stock">Stock</label>
                <select id="p-stock" value={form.stockStatus} onChange={set('stockStatus')}>
                  {(Object.keys(STOCK_LABEL) as StockStatus[]).map((s) => (
                    <option key={s} value={s}>
                      {STOCK_LABEL[s]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="p-venue">Sold at</label>
                <select id="p-venue" value={form.venueId} onChange={set('venueId')}>
                  <option value="">All cinemas</option>
                  {(venues.data ?? []).map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="p-allergens">Allergens</label>
                <input id="p-allergens" value={form.allergens} onChange={set('allergens')} placeholder="Milk, Soya" aria-describedby="p-comma-help" />
              </div>
              <div className="field">
                <label htmlFor="p-dietary">Dietary</label>
                <input id="p-dietary" value={form.dietary} onChange={set('dietary')} placeholder="Vegan, Gluten free" aria-describedby="p-comma-help" />
              </div>
              <div className="field">
                <label htmlFor="p-cal">Calories (optional)</label>
                <input id="p-cal" type="number" min={0} step={1} value={form.calories} onChange={set('calories')} />
              </div>
              <div className="field span-2">
                <label htmlFor="p-bundle">Bundle items</label>
                <input id="p-bundle" value={form.bundleItems} onChange={set('bundleItems')} placeholder="Large popcorn, 2 × regular drinks" aria-describedby="p-comma-help" />
                <p id="p-comma-help" className="help">
                  Separate items with commas.
                </p>
              </div>
              <div className="field">
                <label htmlFor="p-sort">Sort order</label>
                <input id="p-sort" type="number" step={1} value={form.sortOrder} onChange={set('sortOrder')} />
              </div>
              <div className="field span-all">
                <label className="switch">
                  <input type="checkbox" checked={form.available} onChange={(e) => setForm({ ...form, available: e.target.checked })} />
                  Available to order
                </label>
              </div>
            </div>

            <fieldset className="plain choices">
              <legend className="choices-title">Choices</legend>
              <p className="help">Options customers pick when they add this item, such as size or flavour.</p>
              {form.groups.map((g, gi) => (
                <div className="choice-group" key={g.key} role="group" aria-label={`Choice ${gi + 1}`}>
                  <div className="choice-head">
                    <div className="field compact choice-name">
                      <label htmlFor={`g-${g.key}-name`}>Choice name</label>
                      <input id={`g-${g.key}-name`} maxLength={40} placeholder="Size" value={g.name} onChange={(e) => updateGroup(g.key, { name: e.target.value, id: g.id && g.id !== slugify(g.name) ? g.id : slugify(e.target.value) })} />
                    </div>
                    <div className="field compact choice-rule">
                      <span className="label" id={`g-${g.key}-rule`}>Customers pick</span>
                      <div className="choice-rule-inputs" role="group" aria-labelledby={`g-${g.key}-rule`}>
                        <input aria-label="At least" type="number" min={0} max={10} value={g.min} onChange={(e) => updateGroup(g.key, { min: e.target.value })} />
                        <span className="muted">to</span>
                        <input aria-label="At most" type="number" min={1} max={10} value={g.max} onChange={(e) => updateGroup(g.key, { max: e.target.value })} />
                      </div>
                    </div>
                  </div>
                  <p className="help choice-summary">{ruleSummary(g)}</p>

                  <div className="choice-options" role="table" aria-label={`${g.name || 'Choice'} options`}>
                    <div className="choice-option choice-option-head" role="row">
                      <span role="columnheader">Option</span>
                      <span role="columnheader">Extra cost</span>
                      <span role="columnheader" className="visually-hidden">Remove</span>
                    </div>
                    {g.options.map((o, oi) => (
                      <div className="choice-option" role="row" key={o.key}>
                        <input aria-label={`Option ${oi + 1} name`} maxLength={40} placeholder={oi === 0 ? 'Regular' : 'Large'} value={o.name} onChange={(e) => updateOption(g.key, o.key, { name: e.target.value, id: o.id && o.id !== slugify(o.name) ? o.id : slugify(e.target.value) })} />
                        <div className="money-input">
                          <span aria-hidden="true">£</span>
                          <input aria-label={`Option ${oi + 1} extra cost`} inputMode="decimal" placeholder="0.00" value={o.price} onChange={(e) => updateOption(g.key, o.key, { price: e.target.value })} />
                        </div>
                        <button type="button" className="icon-btn" aria-label={`Remove option ${o.name || oi + 1}`} onClick={() => updateGroup(g.key, { options: g.options.filter((x) => x.key !== o.key) })}>
                          ×
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="choice-foot">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => updateGroup(g.key, { options: [...g.options, { key: nextKey(), id: '', name: '', price: '' }] })}>
                      + Add option
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm btn-danger" onClick={() => setForm((f) => ({ ...f, groups: f.groups.filter((x) => x.key !== g.key) }))}>
                      Remove choice
                    </button>
                  </div>
                </div>
              ))}
              <button
                type="button"
                className="add-choice"
                disabled={form.groups.length >= 6}
                onClick={() => setForm((f) => ({ ...f, groups: [...f.groups, { key: nextKey(), id: '', name: '', min: '1', max: '1', options: [{ key: nextKey(), id: '', name: '', price: '' }] }] }))}
              >
                + Add a choice
                <span className="muted">e.g. size, flavour or toppings</span>
              </button>
            </fieldset>

            <ApiErrorNote error={formError} />
            <div className="sheet-foot">
              {editing !== 'new' && (
                <button type="button" className="btn btn-ghost btn-danger" onClick={() => remove(editing)}>
                  Delete product
                </button>
              )}
              <span className="grow" />
              <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={busy || uploading}>
                {busy ? 'Saving…' : editing === 'new' ? 'Create product' : 'Save changes'}
              </button>
            </div>
          </form>
        )}
      </dialog>

      {products.loading && !products.data && <Loading />}
      {products.data && products.data.length === 0 && <p className="muted">No products yet. Add your first one to start selling food and drink in the app.</p>}

      {grouped.length > 0 && (
        <div className="menu-toolbar">
          <div className="chips" role="group" aria-label="Category">
            {[['all', 'All'] as const, ...grouped.map(([c]) => [c, c] as const)].map(([value, label]) => (
              <button key={value} className={`chip${category === value ? ' selected' : ''}`} aria-pressed={category === value} onClick={() => setCategory(value)}>
                {label}
                <span className="chip-count">{value === 'all' ? grouped.reduce((n, [, items]) => n + items.length, 0) : grouped.find(([c]) => c === value)?.[1].length}</span>
              </button>
            ))}
          </div>
          <input type="search" className="menu-search" placeholder="Search products" aria-label="Search products" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      )}

      {shown.map(([cat, items]) => (
        <section className="menu-section" key={cat} aria-labelledby={`cat-${slugify(cat)}`}>
          <h2 id={`cat-${slugify(cat)}`} className="menu-section-title">
            {cat} <span className="muted">{items.length}</span>
          </h2>
          <ul className="product-grid">
            {items.map((p) => (
              <li key={p.id} className={`product-card${p.available ? '' : ' is-off'}`}>
                <button className="product-media" onClick={() => can.canEditConcessions && startEdit(p)} disabled={!can.canEditConcessions} aria-label={`Edit ${p.name}`}>
                  <SafeImage src={mediaUrl(p.image?.url, 500)} alt="" loading="lazy" style={{ background: p.image?.dominantColor ?? undefined }} fallback={<ProductPlaceholder name={p.name} />} />
                  {p.stockStatus !== 'inStock' && <span className={`badge product-flag ${STOCK_CLASS[p.stockStatus]}`}>{STOCK_LABEL[p.stockStatus]}</span>}
                  {!p.available && <span className="badge product-flag product-flag-right">Hidden</span>}
                </button>
                <div className="product-body">
                  <div className="product-title-row">
                    <h3 className="product-name">{p.name}</h3>
                    <span className="product-price num">{formatMoney(p.priceMinor, cur)}</span>
                  </div>
                  <p className="product-meta">
                    {[p.bundleItems.join(', '), p.modifierGroups.length ? `Choose ${p.modifierGroups.map((g) => g.name.toLowerCase()).join(', ')}` : '']
                      .filter(Boolean)
                      .join(' · ') || p.sku}
                  </p>
                  {(p.venueId || p.dietary.length > 0 || p.allergens.length > 0) && (
                    <div className="tags">
                      {p.venueId && <span className="badge badge-scope">{scope.label(p.venueId)} only</span>}
                      {p.dietary.map((d) => (
                        <span key={d} className="badge badge-success">
                          {d}
                        </span>
                      ))}
                      {p.allergens.map((a) => (
                        <span key={a} className="badge">
                          {a}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="product-foot">
                    <label className="switch">
                      <input type="checkbox" checked={p.available} disabled={!can.canEditConcessions} onChange={() => toggleAvailable(p)} aria-label={`${p.name} on the menu`} />
                      {p.available ? 'On menu' : 'Hidden'}
                    </label>
                    {can.canEditConcessions && (
                      <button className="btn btn-sm" onClick={() => startEdit(p)} aria-label={`Edit ${p.name}`}>
                        Edit
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {grouped.length > 0 && shown.length === 0 && <p className="muted">No products match “{query}”.</p>}
    </>
  );
}

/** Plain-English reading of a choice's minimum and maximum. */
function ruleSummary(g: GroupForm): string {
  const min = Number.parseInt(g.min, 10);
  const max = Number.parseInt(g.max, 10);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return 'Enter how many options customers pick.';
  if (min > max) return 'The first number must not be more than the second.';
  if (max > g.options.length) return `Add more options: customers can pick up to ${max} but there are only ${g.options.length}.`;
  if (min === 0) return max === 1 ? 'Optional. Customers can pick one.' : `Optional. Customers can pick up to ${max}.`;
  if (min === max) return min === 1 ? 'Required. Customers pick exactly one.' : `Required. Customers pick exactly ${min}.`;
  return `Required. Customers pick between ${min} and ${max}.`;
}

/** Shown when a product has no photo (or it fails to load): the name on a soft tile, never a broken image. */
function ProductPlaceholder({ name }: { name: string }) {
  return (
    <span className="product-placeholder" aria-hidden="true">
      <span>{name.charAt(0).toUpperCase()}</span>
    </span>
  );
}
