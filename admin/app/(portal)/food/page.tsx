'use client';

import { FormEvent, useMemo, useState } from 'react';
import { api, Concession, errorDetails, errorMessage, ModifierGroup, StockStatus, tenantPath, Venue } from '@/lib/api';
import { useSession, useTenantData } from '@/lib/session';
import { formatMoney, inputToMinor, minorToInput } from '@/lib/format';
import { ApiErrorNote, ErrorNote, Loading, PageHeader, ReadOnlyNote, SuccessNote } from '@/components/ui';

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

  const grouped = useMemo(() => {
    const m = new Map<string, Concession[]>();
    for (const p of products.data ?? []) m.set(p.category, [...(m.get(p.category) ?? []), p]);
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [products.data]);
  const venueName = (id: string | null) => (id ? venues.data?.find((v) => v.id === id)?.name ?? 'One cinema' : 'All cinemas');
  const cur = 'GBP';

  function startNew() {
    setEditing('new');
    setForm(EMPTY);
    setFormError(null);
    setMsg({});
  }
  function startEdit(p: Concession) {
    setEditing(p);
    setForm(toForm(p));
    setFormError(null);
    setMsg({});
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
      if (editing !== 'new' && editing?.id === p.id) setEditing(null);
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
      {!can.canEditConcessions && <ReadOnlyNote>Your role can view the menu but not change it.</ReadOnlyNote>}
      <ErrorNote message={msg.error ?? products.error} />
      <SuccessNote message={msg.ok} />

      {editing && (
        <section className="card" aria-labelledby="p-form-title">
          <h2 id="p-form-title" className="h3">
            {editing === 'new' ? 'New product' : `Edit ${editing.name}`}
          </h2>
          <form onSubmit={submit} noValidate>
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

            <fieldset className="plain mb-3">
              <legend className="h4">Modifier groups</legend>
              <p className="help mb-2">Choices such as size or flavour. Minimum 0 makes the choice optional.</p>
              {form.groups.map((g, gi) => (
                <div className="group-editor" key={g.key} role="group" aria-label={`Modifier group ${gi + 1}`}>
                  <div className="form-grid cols-4">
                    <div className="field span-2">
                      <label htmlFor={`g-${g.key}-name`}>Group name</label>
                      <input id={`g-${g.key}-name`} maxLength={40} value={g.name} onChange={(e) => updateGroup(g.key, { name: e.target.value, id: g.id && g.id !== slugify(g.name) ? g.id : slugify(e.target.value) })} />
                    </div>
                    <div className="field">
                      <label htmlFor={`g-${g.key}-min`}>Minimum</label>
                      <input id={`g-${g.key}-min`} type="number" min={0} max={10} value={g.min} onChange={(e) => updateGroup(g.key, { min: e.target.value })} />
                    </div>
                    <div className="field">
                      <label htmlFor={`g-${g.key}-max`}>Maximum</label>
                      <input id={`g-${g.key}-max`} type="number" min={1} max={10} value={g.max} onChange={(e) => updateGroup(g.key, { max: e.target.value })} />
                    </div>
                  </div>
                  {g.options.map((o, oi) => (
                    <div className="option-row" key={o.key}>
                      <div className="field">
                        <label htmlFor={`o-${o.key}-name`}>Option {oi + 1}</label>
                        <input id={`o-${o.key}-name`} maxLength={40} value={o.name} onChange={(e) => updateOption(g.key, o.key, { name: e.target.value, id: o.id && o.id !== slugify(o.name) ? o.id : slugify(e.target.value) })} />
                      </div>
                      <div className="field">
                        <label htmlFor={`o-${o.key}-price`}>Extra cost</label>
                        <div className="money-input">
                          <span aria-hidden="true">£</span>
                          <input id={`o-${o.key}-price`} inputMode="decimal" placeholder="0.00" value={o.price} onChange={(e) => updateOption(g.key, o.key, { price: e.target.value })} />
                        </div>
                      </div>
                      <button type="button" className="btn btn-sm btn-ghost" aria-label={`Remove option ${o.name || oi + 1}`} onClick={() => updateGroup(g.key, { options: g.options.filter((x) => x.key !== o.key) })}>
                        Remove
                      </button>
                    </div>
                  ))}
                  <div className="row gap-1 mt-2">
                    <button type="button" className="btn btn-sm" onClick={() => updateGroup(g.key, { options: [...g.options, { key: nextKey(), id: '', name: '', price: '' }] })}>
                      Add option
                    </button>
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => setForm((f) => ({ ...f, groups: f.groups.filter((x) => x.key !== g.key) }))}>
                      Remove group
                    </button>
                  </div>
                </div>
              ))}
              <button
                type="button"
                className="btn btn-sm"
                disabled={form.groups.length >= 6}
                onClick={() => setForm((f) => ({ ...f, groups: [...f.groups, { key: nextKey(), id: '', name: '', min: '1', max: '1', options: [{ key: nextKey(), id: '', name: '', price: '' }] }] }))}
              >
                Add modifier group
              </button>
            </fieldset>

            <ApiErrorNote error={formError} />
            <div className="row gap-1">
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? 'Saving…' : editing === 'new' ? 'Create product' : 'Save changes'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="card" aria-label="Products">
        {products.loading && !products.data && <Loading />}
        {products.data && products.data.length === 0 && <p className="muted">No products yet.</p>}
        {grouped.map(([category, items]) => (
          <div className="product-category" key={category}>
            <h2 className="h4">{category}</h2>
            <div className="table-wrap">
              <table className="table product-table">
                <colgroup>
                  <col />
                  <col className="c-venue" />
                  <col className="c-price" />
                  <col className="c-stock" />
                  <col className="c-avail" />
                  <col className="c-actions" />
                </colgroup>
                <thead>
                  <tr>
                    <th scope="col">Product</th>
                    <th scope="col">Sold at</th>
                    <th scope="col">Price</th>
                    <th scope="col">Stock</th>
                    <th scope="col">Available</th>
                    <th scope="col">
                      <span className="visually-hidden">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <div className="strong">{p.name}</div>
                        <div className="muted small">
                          {p.sku}
                          {p.modifierGroups.length > 0 && ` · ${p.modifierGroups.map((g) => g.name).join(', ')}`}
                          {p.bundleItems.length > 0 && ` · ${p.bundleItems.join(', ')}`}
                        </div>
                        {(p.dietary.length > 0 || p.allergens.length > 0) && (
                          <div className="tags">
                            {p.dietary.map((d) => (
                              <span key={d} className="badge badge-success">
                                {d}
                              </span>
                            ))}
                            {p.allergens.map((a) => (
                              <span key={a} className="badge">
                                Contains {a.toLowerCase()}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="small">{venueName(p.venueId)}</td>
                      <td className="num nowrap">{formatMoney(p.priceMinor, cur)}</td>
                      <td>
                        <span className={`badge ${STOCK_CLASS[p.stockStatus]}`}>{STOCK_LABEL[p.stockStatus]}</span>
                      </td>
                      <td>
                        <label className="switch">
                          <input type="checkbox" checked={p.available} disabled={!can.canEditConcessions} onChange={() => toggleAvailable(p)} aria-label={`${p.name} available to order`} />
                          {p.available ? 'On' : 'Off'}
                        </label>
                      </td>
                      <td className="actions">
                        {can.canEditConcessions && (
                          <>
                            <button className="btn btn-sm" onClick={() => startEdit(p)} aria-label={`Edit ${p.name}`}>
                              Edit
                            </button>
                            <button className="btn btn-sm btn-danger" onClick={() => remove(p)} aria-label={`Delete ${p.name}`}>
                              Delete
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </section>
    </>
  );
}
