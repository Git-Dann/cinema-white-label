'use client';

import { FormEvent, useState } from 'react';
import { Sheet, TileHit } from '@/components/Sheet';
import { api, errorDetails, errorMessage, LoyaltyProgram, LoyaltyResponse, MembershipEntitlements, MembershipPlan, tenantPath } from '@/lib/api';
import { useSession, useTenantData } from '@/lib/session';
import { formatMoney, inputToMinor, minorToInput } from '@/lib/format';
import { ApiErrorNote, ErrorNote, Loading, PageHeader, ReadOnlyNote, SuccessNote } from '@/components/ui';

type ApiErr = { message: string; details: string[] } | null;

const count = (n: number) => n.toLocaleString('en-GB');
const percent = (n: number) => n.toLocaleString('en-GB', { maximumFractionDigits: 1 });

/** Whole number in [min, max], or null. */
function wholeNumber(value: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const n = Number.parseInt(value, 10);
  return n >= min && n <= max ? n : null;
}

// ---------------------------------------------------------------------------
// Points scheme
// ---------------------------------------------------------------------------

interface ProgramForm {
  name: string;
  enabled: boolean;
  earn: string;
  redeem: string;
  min: string;
}

const NEW_PROGRAM: ProgramForm = { name: '', enabled: true, earn: '10', redeem: '200', min: '0' };

function toProgramForm(p: LoyaltyProgram): ProgramForm {
  return { name: p.name, enabled: p.enabled, earn: String(p.earnPointsPerPound), redeem: String(p.redeemPointsPerPound), min: String(p.minRedeemPoints) };
}

/** Plain-English description of a scheme, for the live preview and the read-only view. */
function schemeSummary(earn: number, redeem: number, min: number, enabled: boolean): string {
  const parts = [`Customers earn ${count(earn)} point${earn === 1 ? '' : 's'} per £1 and get £1 off for every ${count(redeem)} points: about ${percent((earn / redeem) * 100)}% back.`];
  if (min > redeem) parts.push(`They need at least ${count(min)} points before they can use them.`);
  if (!enabled) parts.push('The scheme is off, so customers cannot earn or use points until you turn it on.');
  return parts.join(' ');
}

/** Mirrors the server rules so most mistakes are caught before saving. Returns an error message or the request body. */
function validateProgram(f: ProgramForm): string | LoyaltyProgram {
  const name = f.name.trim();
  if (!name) return 'Enter a name for the scheme, such as "Rewards".';
  if (name.length > 40) return 'The name must be 40 characters or fewer.';
  const earn = wholeNumber(f.earn, 1, 100);
  if (earn === null) return 'Points earned per £1 must be a whole number from 1 to 100.';
  const redeem = wholeNumber(f.redeem, 1, 10_000);
  if (redeem === null) return 'Points needed for £1 off must be a whole number from 1 to 10,000.';
  const min = wholeNumber(f.min || '0', 0, 100_000);
  if (min === null) return 'Minimum points per use must be a whole number from 0 to 100,000.';
  if (earn >= redeem) return 'Customers would get £1 or more back for every £1 spent. Earn fewer points per £1, or need more points per £1 off.';
  return { name, enabled: f.enabled, earnPointsPerPound: earn, redeemPointsPerPound: redeem, minRedeemPoints: min };
}

function PointsSchemeCard({ tenant, canEdit }: { tenant: string; canEdit: boolean }) {
  const loyalty = useTenantData<LoyaltyResponse>(tenantPath(tenant, '/loyalty'));
  // null means "showing the saved values"; set once the operator starts setting up or editing.
  const [form, setForm] = useState<ProgramForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<ApiErr>(null);
  const [ok, setOk] = useState<string | null>(null);

  const program = loyalty.data?.program ?? null;
  const stats = loyalty.data?.stats;
  const shown: ProgramForm | null = form ?? (program ? toProgramForm(program) : null);

  const edit = (patch: Partial<ProgramForm>) => {
    if (!shown) return;
    setForm({ ...shown, ...patch });
    setOk(null);
  };
  const set = (k: 'name' | 'earn' | 'redeem' | 'min') => (e: React.ChangeEvent<HTMLInputElement>) => edit({ [k]: e.target.value });

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!shown) return;
    const body = validateProgram(shown);
    if (typeof body === 'string') return setFormError({ message: body, details: [] });
    setBusy(true);
    setFormError(null);
    try {
      const res = await api<LoyaltyResponse>(tenantPath(tenant, '/loyalty'), { method: 'PUT', body });
      loyalty.setData(res);
      setForm(null);
      setOk(program ? `“${body.name}” saved. Changes apply to purchases from now on.` : `“${body.name}” set up.`);
    } catch (err) {
      setFormError({ message: errorMessage(err), details: errorDetails(err) });
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    setForm(null);
    setFormError(null);
  }

  // Live preview from whatever is typed, as long as the numbers make sense.
  const preview = shown ? validateProgram(shown) : null;
  const previewText =
    preview && typeof preview !== 'string'
      ? schemeSummary(preview.earnPointsPerPound, preview.redeemPointsPerPound, preview.minRedeemPoints, preview.enabled)
      : 'Enter the numbers above to see what customers get.';

  return (
    <section className="card" aria-labelledby="ls-title">
      <h2 id="ls-title" className="h3">
        Points scheme
      </h2>
      <ErrorNote message={loyalty.error} />
      <SuccessNote message={ok} />
      {loyalty.loading && !loyalty.data && <Loading />}

      {loyalty.data && !program && !form && (
        <>
          <p className="muted">
            No points scheme yet. With a scheme, customers earn points on what they pay for tickets and food, then use them for money off later bookings. Points are not shown in the app until you set one up.
          </p>
          {canEdit && (
            <button className="btn btn-primary" onClick={() => setForm(NEW_PROGRAM)}>
              Set up a scheme
            </button>
          )}
        </>
      )}

      {loyalty.data && program && stats && (
        <p className="muted">
          Customers with points: <span className="strong">{count(stats.accounts)}</span>
          {' · '}
          Points outstanding: <span className="strong">{count(stats.pointsOutstanding)}</span>
          {stats.pointsOutstanding > 0 && `, worth about ${formatMoney(Math.round((stats.pointsOutstanding * 100) / program.redeemPointsPerPound), 'GBP')} in discounts`}
        </p>
      )}

      {loyalty.data && program && (
        <dl className="kv">
          <dt>Name</dt>
          <dd>{program.name}</dd>
          <dt>Status</dt>
          <dd>
            <span className={`badge ${program.enabled ? 'badge-success' : 'badge-neutral'}`}>{program.enabled ? 'On' : 'Off'}</span>
          </dd>
          <dt>How it works</dt>
          <dd>{schemeSummary(program.earnPointsPerPound, program.redeemPointsPerPound, program.minRedeemPoints, program.enabled)}</dd>
        </dl>
      )}
      {loyalty.data && program && canEdit && (
        <div className="row gap-1 mt-2">
          <button
            className="btn btn-sm"
            onClick={() => {
              setForm(toProgramForm(program));
              setOk(null);
              setFormError(null);
            }}
          >
            Edit scheme
          </button>
        </div>
      )}

      <Sheet
        open={!!form && canEdit}
        title={program ? `Edit “${program.name}”` : 'Set up a points scheme'}
        subtitle={program ? 'Changes apply to purchases from now on.' : 'Customers earn points on what they pay, then use them for money off.'}
        onClose={cancel}
        onSubmit={save}
        footer={
          <>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Saving…' : program ? 'Save scheme' : 'Set up scheme'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={cancel}>
              Cancel
            </button>
          </>
        }
      >
        {shown && (
          <>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="ls-name">Scheme name</label>
                <input id="ls-name" maxLength={40} value={shown.name} onChange={set('name')} placeholder="Rewards" aria-describedby="ls-name-help" />
                <p id="ls-name-help" className="help">
                  Shown to customers in the app.
                </p>
              </div>
              <div className="field">
                <span className="label">Status</span>
                <label className="switch">
                  <input type="checkbox" checked={shown.enabled} onChange={(e) => edit({ enabled: e.target.checked })} />
                  On
                </label>
              </div>
              <div className="field">
                <label htmlFor="ls-earn">Points earned per £1</label>
                <input id="ls-earn" type="number" min={1} max={100} step={1} value={shown.earn} onChange={set('earn')} aria-describedby="ls-earn-help" />
                <p id="ls-earn-help" className="help">
                  On what customers pay, not counting booking fees.
                </p>
              </div>
              <div className="field">
                <label htmlFor="ls-redeem">Points needed for £1 off</label>
                <input id="ls-redeem" type="number" min={1} max={10000} step={1} value={shown.redeem} onChange={set('redeem')} aria-describedby="ls-redeem-help" />
                <p id="ls-redeem-help" className="help">
                  Points are used in steps of this size.
                </p>
              </div>
              <div className="field">
                <label htmlFor="ls-min">Minimum points per use</label>
                <input id="ls-min" type="number" min={0} max={100000} step={1} value={shown.min} onChange={set('min')} aria-describedby="ls-min-help" />
                <p id="ls-min-help" className="help">
                  0 means no minimum beyond one step.
                </p>
              </div>
              <p className="note span-2" aria-live="polite">
                {previewText}
              </p>
            </div>
            <ApiErrorNote error={formError} />
          </>
        )}
      </Sheet>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Membership plans
// ---------------------------------------------------------------------------

const MULTIPLIERS = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];
const INTERVALS: Record<MembershipPlan['interval'], string> = { month: 'month', year: 'year' };

interface PlanForm {
  name: string;
  description: string;
  price: string;
  interval: MembershipPlan['interval'];
  ticketDiscount: string;
  foodDiscount: string;
  bookingFeeWaived: boolean;
  multiplier: string;
  active: boolean;
  sortOrder: string;
}

const EMPTY_PLAN: PlanForm = { name: '', description: '', price: '', interval: 'month', ticketDiscount: '0', foodDiscount: '0', bookingFeeWaived: false, multiplier: '1', active: true, sortOrder: '0' };

function toPlanForm(p: MembershipPlan): PlanForm {
  return {
    name: p.name, description: p.description, price: minorToInput(p.priceMinor), interval: p.interval,
    ticketDiscount: String(p.entitlements.ticketDiscountPercent), foodDiscount: String(p.entitlements.foodDiscountPercent),
    bookingFeeWaived: p.entitlements.bookingFeeWaived, multiplier: String(p.entitlements.pointsMultiplier), active: p.active, sortOrder: String(p.sortOrder),
  };
}

/** Benefits as separate lines, e.g. ["10% off tickets", "No booking fee", "1.5× points"]. */
function benefitList(e: MembershipEntitlements): string[] {
  const parts: string[] = [];
  if (e.ticketDiscountPercent && e.ticketDiscountPercent === e.foodDiscountPercent) parts.push(`${e.ticketDiscountPercent}% off tickets and food`);
  else {
    if (e.ticketDiscountPercent) parts.push(`${e.ticketDiscountPercent}% off tickets`);
    if (e.foodDiscountPercent) parts.push(`${e.foodDiscountPercent}% off food and drink`);
  }
  if (e.bookingFeeWaived) parts.push('No booking fee');
  if (e.pointsMultiplier > 1) parts.push(`${e.pointsMultiplier}× points on everything`);
  return parts.map((t) => t.charAt(0).toUpperCase() + t.slice(1));
}

function MembershipPlansCard({ tenant, canEdit }: { tenant: string; canEdit: boolean }) {
  const plans = useTenantData<MembershipPlan[]>(tenantPath(tenant, '/membership-plans'));
  const [editing, setEditing] = useState<MembershipPlan | 'new' | null>(null);
  const [form, setForm] = useState<PlanForm>(EMPTY_PLAN);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<ApiErr>(null);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});

  const fail = (message: string) => setFormError({ message, details: [] });
  const set = (k: keyof PlanForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function open(p: MembershipPlan | 'new') {
    setEditing(p);
    setForm(p === 'new' ? EMPTY_PLAN : toPlanForm(p));
    setFormError(null);
    setMsg({});
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const name = form.name.trim();
    if (!name) return fail('Enter a plan name.');
    const priceMinor = inputToMinor(form.price);
    if (priceMinor === null || Number.isNaN(priceMinor)) return fail('Enter the price in pounds, such as 6.99.');
    if (priceMinor < 100 || priceMinor > 100_000) return fail('The price must be from £1.00 to £1,000.00.');
    const ticketDiscountPercent = wholeNumber(form.ticketDiscount || '0', 0, 100);
    if (ticketDiscountPercent === null) return fail('Ticket discount must be a whole number from 0 to 100.');
    const foodDiscountPercent = wholeNumber(form.foodDiscount || '0', 0, 100);
    if (foodDiscountPercent === null) return fail('Food and drink discount must be a whole number from 0 to 100.');
    const sortOrder = wholeNumber(form.sortOrder || '0', 0, 999);
    if (sortOrder === null) return fail('Order must be a whole number from 0 to 999.');
    const body = {
      name, description: form.description.trim(), priceMinor, interval: form.interval,
      entitlements: { ticketDiscountPercent, foodDiscountPercent, bookingFeeWaived: form.bookingFeeWaived, pointsMultiplier: Number(form.multiplier) },
      active: form.active, sortOrder,
    };
    setBusy(true);
    setFormError(null);
    try {
      if (editing === 'new') await api(tenantPath(tenant, '/membership-plans'), { method: 'POST', body });
      else if (editing) await api(tenantPath(tenant, `/membership-plans/${editing.id}`), { method: 'PUT', body });
      setMsg({ ok: `“${name}” ${editing === 'new' ? 'created' : 'saved'}.` });
      setEditing(null);
      plans.reload();
    } catch (err) {
      setFormError({ message: errorMessage(err), details: errorDetails(err) });
    } finally {
      setBusy(false);
    }
  }

  async function remove(p: MembershipPlan) {
    if (!window.confirm(`Delete “${p.name}”? This cannot be undone. A plan that anyone has bought cannot be deleted; turn it off instead.`)) return;
    setMsg({});
    try {
      await api(tenantPath(tenant, `/membership-plans/${p.id}`), { method: 'DELETE' });
      setMsg({ ok: `“${p.name}” deleted.` });
      if (editing !== 'new' && editing?.id === p.id) setEditing(null);
      plans.reload();
    } catch (err) {
      setMsg({ error: `Could not delete “${p.name}”. ${errorMessage(err)}` });
    }
  }

  return (
    <section className="card" aria-labelledby="mp-title">
      <div className="section-title">
        <h2 id="mp-title" className="h3">
          Membership plans
        </h2>
        {canEdit && (
          <button className="btn btn-sm" onClick={() => open('new')}>
            Create plan
          </button>
        )}
      </div>
      <ErrorNote message={msg.error ?? plans.error} />
      <SuccessNote message={msg.ok} />

      <Sheet
        open={!!editing && canEdit}
        title={editing === 'new' ? 'New membership plan' : editing ? `Edit “${editing.name}”` : 'Membership plan'}
        subtitle={editing && editing !== 'new' ? "Price and benefit changes apply to new purchases and renewals, and to existing members' benefits from now on." : undefined}
        onClose={() => setEditing(null)}
        onSubmit={submit}
        footer={
          <>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Saving…' : editing === 'new' ? 'Create plan' : 'Save changes'}
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
        <div className="form-grid">
          <div className="field">
            <label htmlFor="mp-name">Name</label>
            <input id="mp-name" maxLength={40} value={form.name} onChange={set('name')} placeholder="Plus" />
          </div>
          <div className="field">
            <label htmlFor="mp-price">Price</label>
            <div className="money-input">
              <span aria-hidden="true">£</span>
              <input id="mp-price" inputMode="decimal" value={form.price} onChange={set('price')} placeholder="6.99" aria-describedby="mp-price-help" />
            </div>
            <p id="mp-price-help" className="help">
              At least £1.00.
            </p>
          </div>
          <div className="field">
            <label htmlFor="mp-interval">Customers pay every</label>
            <select id="mp-interval" value={form.interval} onChange={set('interval')}>
              <option value="month">Month</option>
              <option value="year">Year</option>
            </select>
          </div>
          <div className="field span-2">
            <label htmlFor="mp-desc">Description</label>
            <textarea id="mp-desc" maxLength={200} rows={2} value={form.description} onChange={set('description')} aria-describedby="mp-desc-help" />
            <p id="mp-desc-help" className="help">
              {form.description.length}/200 characters. Shown to customers when they choose a plan.
            </p>
          </div>
          <div className="field">
            <label htmlFor="mp-ticket">Ticket discount (%)</label>
            <input id="mp-ticket" type="number" min={0} max={100} step={1} value={form.ticketDiscount} onChange={set('ticketDiscount')} />
          </div>
          <div className="field">
            <label htmlFor="mp-food">Food and drink discount (%)</label>
            <input id="mp-food" type="number" min={0} max={100} step={1} value={form.foodDiscount} onChange={set('foodDiscount')} />
          </div>
          <div className="field">
            <label htmlFor="mp-mult">Points multiplier</label>
            <select id="mp-mult" value={form.multiplier} onChange={set('multiplier')} aria-describedby="mp-mult-help">
              {MULTIPLIERS.map((m) => (
                <option key={m} value={String(m)}>
                  {m === 1 ? '1× (normal points)' : `${m}×`}
                </option>
              ))}
            </select>
            <p id="mp-mult-help" className="help">
              Members earn this many times the usual points.
            </p>
          </div>
          <div className="field">
            <span className="label">Booking fee</span>
            <label className="switch">
              <input type="checkbox" checked={form.bookingFeeWaived} onChange={(e) => setForm({ ...form, bookingFeeWaived: e.target.checked })} />
              Members pay no booking fee
            </label>
          </div>
          <div className="field">
            <label htmlFor="mp-order">Order</label>
            <input id="mp-order" type="number" min={0} max={999} step={1} value={form.sortOrder} onChange={set('sortOrder')} aria-describedby="mp-order-help" />
            <p id="mp-order-help" className="help">
              Lower numbers show first.
            </p>
          </div>
          <div className="field">
            <span className="label">Status</span>
            <label className="switch">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
              On sale
            </label>
          </div>
        </div>
        <ApiErrorNote error={formError} />
      </Sheet>

      {plans.loading && !plans.data && <Loading />}
      {plans.data && plans.data.length === 0 && <p className="muted">No membership plans yet. Memberships are not offered in the app until there is a plan that is on.</p>}
      {plans.data && plans.data.length > 0 && (
        <ul className="tile-grid">
          {plans.data.map((p) => (
            <li key={p.id} className={`card tile plan-tile${p.active ? '' : ' is-off'}${canEdit ? ' tile-click' : ''}`}>
              {canEdit && <TileHit label={`Edit ${p.name}`} onClick={() => open(p)} />}
              <div className="tile-head">
                <div className="tile-title">{p.name}</div>
                <span className={`badge ${p.active ? 'badge-success' : 'badge-neutral'}`}>{p.active ? 'On sale' : 'Off sale'}</span>
              </div>
              <div className="plan-price">
                <span className="num">{formatMoney(p.priceMinor, 'GBP')}</span>
                <span className="muted"> a {INTERVALS[p.interval]}</span>
              </div>
              {benefitList(p.entitlements).length ? (
                <ul className="plan-benefits">
                  {benefitList(p.entitlements).map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              ) : (
                <div className="muted small">No benefits set</div>
              )}
              <div className="plan-foot small">
                <strong className="num">{count(p.activeMembers)}</strong> <span className="muted">active member{p.activeMembers === 1 ? '' : 's'}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

export default function LoyaltyPage() {
  const { tenant, can } = useSession();
  const canEdit = can.canEditPricing;
  return (
    <>
      <PageHeader
        title="Loyalty & memberships"
        description="Points customers earn on purchases, and paid memberships with discounts and other benefits. Changes apply in the app straight away; no release needed."
      />
      {!canEdit && <ReadOnlyNote>Only operator admins can change the points scheme and membership plans. They are shown read-only.</ReadOnlyNote>}
      <p className="note" role="note">
        Memberships renew manually for now: customers buy each month or year themselves. Automatic renewal needs a payment provider.
        <br />
        Payments in development are simulated; no money is taken.
      </p>
      <PointsSchemeCard tenant={tenant} canEdit={canEdit} />
      <MembershipPlansCard tenant={tenant} canEdit={canEdit} />
    </>
  );
}
