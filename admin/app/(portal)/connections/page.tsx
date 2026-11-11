'use client';

import { FormEvent, useMemo, useState } from 'react';
import { ApiErrorNote, ErrorNote, Loading, PageHeader, ReadOnlyNote, SuccessNote } from '@/components/ui';
import { API_BASE, ApiKeyRow, api, errorDetails, errorMessage, Film, IntegrationCatalogue, ShiftRow, tenantPath, WebhookRow } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useSession, useTenantData } from '@/lib/session';
import { Sheet, TileHit } from '@/components/Sheet';

/*
 * Connections: how Seatfold plugs into the systems an operator already runs.
 * Two doors, both narrow: API keys (a partner reads or writes only what its scopes
 * allow) and webhooks (we push signed events out). Nothing here claims a connection
 * that isn't real: statuses come from data (shifts received, films from TMDB) or say
 * plainly what's needed.
 */

type Tab = 'apps' | 'keys' | 'webhooks';
type Status = { tone: 'success' | 'warning' | 'neutral' | 'scope'; label: string };
type ApiErr = { message: string; details: string[] } | null;

interface App {
  name: string;
  what: string;
  how: string;
  status: Status;
}

export default function ConnectionsPage() {
  const { tenant, can } = useSession();
  const [tab, setTab] = useState<Tab>('apps');
  const keys = useTenantData<ApiKeyRow[]>(tenantPath(tenant, '/api-keys'));
  const hooks = useTenantData<WebhookRow[]>(tenantPath(tenant, '/webhooks'));
  const catalogue = useTenantData<IntegrationCatalogue>(tenantPath(tenant, '/integrations/catalogue'));
  const shifts = useTenantData<ShiftRow[]>(tenantPath(tenant, '/shifts'));
  const films = useTenantData<Film[]>(tenantPath(tenant, '/films'));
  const canEdit = can.canManageTeam;

  const live = (keys.data ?? []).filter((k) => !k.revokedAt);
  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'apps', label: 'Apps' },
    { id: 'keys', label: 'API keys', count: live.length },
    { id: 'webhooks', label: 'Webhooks', count: (hooks.data ?? []).length },
  ];

  return (
    <>
      <PageHeader
        title="Connections"
        description="Connect Seatfold to the systems you already run. Each one gets only what it needs."
        actions={
          <a className="btn" href={`${API_BASE}/docs`} target="_blank" rel="noreferrer">
            API reference ↗
          </a>
        }
      />
      {!canEdit && <ReadOnlyNote>Only operator admins can create keys and webhooks.</ReadOnlyNote>}
      <div className="chips page-chips" role="tablist" aria-label="Connections">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={`chip${tab === t.id ? ' selected' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
            {t.count !== undefined && <span className="chip-count">{t.count}</span>}
          </button>
        ))}
      </div>
      {tab === 'apps' && <Apps shifts={shifts.data ?? []} films={films.data ?? []} keys={live} hooks={hooks.data ?? []} onTab={setTab} />}
      {tab === 'keys' && <Keys tenant={tenant} canEdit={canEdit} rows={keys.data} loading={keys.loading} error={keys.error} reload={keys.reload} catalogue={catalogue.data} />}
      {tab === 'webhooks' && <Webhooks tenant={tenant} canEdit={canEdit} rows={hooks.data} loading={hooks.loading} error={hooks.error} reload={hooks.reload} catalogue={catalogue.data} />}
    </>
  );
}

function Apps({ shifts, films, keys, hooks, onTab }: { shifts: ShiftRow[]; films: Film[]; keys: ApiKeyRow[]; hooks: WebhookRow[]; onTab: (t: Tab) => void }) {
  const sources = useMemo(() => new Map(shifts.reduce<[string, number][]>((acc, s) => {
    const i = acc.findIndex(([k]) => k === s.source);
    if (i >= 0) acc[i][1]++;
    else acc.push([s.source, 1]);
    return acc;
  }, [])), [shifts]);
  const rota = (id: string): Status => (sources.get(id) ? { tone: 'success', label: `Connected · ${sources.get(id)} shifts` } : { tone: 'neutral', label: 'Connect with a key' });
  const anyKey = (scope: string) => keys.some((k) => k.scopes.includes(scope));
  const tmdb = films.some((f) => !f.hidden && f.poster?.attribution === 'Image: TMDB');
  const hooked = hooks.some((h) => h.active);

  const groups: { title: string; blurb: string; apps: App[] }[] = [
    {
      title: 'Payments',
      blurb: 'Card and Apple Pay payments go through one provider of your choice. Card details never touch Seatfold.',
      apps: [
        { name: 'Stripe', what: 'Cards, Apple Pay and payouts', how: 'Needs your Stripe account and merchant ID', status: { tone: 'warning', label: 'Simulated payments in use' } },
        { name: 'Adyen', what: 'Cards and Apple Pay for larger chains', how: 'Needs your Adyen account', status: { tone: 'neutral', label: 'Available' } },
        { name: 'Worldpay', what: 'Cards through your existing acquirer', how: 'Needs your Worldpay account', status: { tone: 'neutral', label: 'Available' } },
      ],
    },
    {
      title: 'Rota & staff',
      blurb: 'Your rota app sends shifts in, so My week and Today show who is working. The forecast goes back out as hours needed.',
      apps: [
        { name: 'Planday', what: 'Shifts into My week and Today', how: 'API key with shifts:write, source "planday"', status: rota('planday') },
        { name: 'Deputy', what: 'Shifts into My week and Today', how: 'API key with shifts:write, source "deputy"', status: rota('deputy') },
        { name: 'RotaCloud', what: 'Shifts into My week and Today', how: 'API key with shifts:write, source "rotacloud"', status: rota('rotacloud') },
        ...[...sources.keys()].filter((k) => !['planday', 'deputy', 'rotacloud'].includes(k)).map((k): App => ({ name: `Other rota: ${k}`, what: 'Shifts into My week and Today', how: `Sent with source "${k}"`, status: rota(k) })),
      ],
    },
    {
      title: 'Data & reporting',
      blurb: 'Sales and occupancy for your BI tool or warehouse. Bookings come without customer details.',
      apps: [
        { name: 'Power BI, Looker Studio', what: 'Dashboards on sales and occupancy', how: 'API key with bookings:read and screenings:read', status: anyKey('bookings:read') ? { tone: 'success', label: 'Key issued' } : { tone: 'neutral', label: 'Connect with a key' } },
        { name: 'BigQuery, Snowflake', what: 'Every booking in your warehouse', how: 'Nightly pull from /v1/partner/bookings', status: anyKey('bookings:read') ? { tone: 'success', label: 'Key issued' } : { tone: 'neutral', label: 'Connect with a key' } },
        { name: 'Xero, QuickBooks', what: 'Daily takings into your accounts', how: 'Daily totals from the bookings API', status: { tone: 'neutral', label: 'Connect with a key' } },
      ],
    },
    {
      title: 'Marketing & automation',
      blurb: 'Booking events go out as signed webhooks, so email tools and automations can react to them.',
      apps: [
        { name: 'Zapier, Make', what: 'Anything triggered by a booking', how: 'Webhook on booking.confirmed', status: hooked ? { tone: 'success', label: 'Webhook active' } : { tone: 'neutral', label: 'Add a webhook' } },
        { name: 'Klaviyo, Mailchimp', what: 'Post-visit emails and audiences', how: 'Webhook through Zapier or your own receiver', status: hooked ? { tone: 'success', label: 'Webhook active' } : { tone: 'neutral', label: 'Add a webhook' } },
      ],
    },
    {
      title: 'Ticketing & film data',
      blurb: 'Seatfold works beside your ticketing system rather than replacing it.',
      apps: [
        { name: 'Vista, Veezi, Admit One', what: 'Showtimes, seats and sales in step with your box office', how: 'Adapter written once you have licensed access', status: { tone: 'neutral', label: 'On request' } },
        { name: 'TMDB', what: 'Film details, cast and artwork (demo)', how: 'Refreshes every morning', status: tmdb ? { tone: 'success', label: 'Connected' } : { tone: 'neutral', label: 'Not loaded' } },
        { name: 'Distributor feeds', what: 'Licensed artwork and trailers', how: 'Per distributor agreement', status: { tone: 'neutral', label: 'On request' } },
      ],
    },
  ];

  return (
    <>
      <div className="conn-doors">
        <button className="card conn-door" onClick={() => onTab('keys')}>
          <strong>API keys</strong>
          <span className="muted small">A system reads or writes only what its key allows. Read-only unless you say otherwise.</span>
        </button>
        <button className="card conn-door" onClick={() => onTab('webhooks')}>
          <strong>Webhooks</strong>
          <span className="muted small">Seatfold tells your systems when something happens, signed so they know it was us.</span>
        </button>
      </div>
      {groups.map((g) => (
        <section key={g.title} className="venue-block" aria-labelledby={`g-${g.title}`}>
          <h2 id={`g-${g.title}`} className="h3 section-title">{g.title}</h2>
          <p className="muted small conn-blurb">{g.blurb}</p>
          <ul className="tile-grid">
            {g.apps.map((a) => (
              <li key={a.name} className="card tile">
                <div className="tile-head">
                  <div className="tile-title">{a.name}</div>
                  <span className={`badge badge-${a.status.tone}`}>{a.status.label}</span>
                </div>
                <div className="small">{a.what}</div>
                <div className="muted small">{a.how}</div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

/** A secret shown once, with Copy, inside the panel that created it. */
function OnceSecret({ title, note, value }: { title: string; note: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="conn-secret" role="status">
      <strong>{title}</strong>
      <p className="small muted">{note}</p>
      <div className="team-password">
        <code className="break">{value}</code>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => {
            navigator.clipboard?.writeText(value);
            setCopied(true);
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

function Keys({ tenant, canEdit, rows, loading, error, reload, catalogue }: { tenant: string; canEdit: boolean; rows: ApiKeyRow[] | null; loading: boolean; error: string | null; reload: () => void; catalogue: IntegrationCatalogue | null }) {
  // The panel shows one of: a new-key form, the key just created (shown once), or an existing key.
  const [panel, setPanel] = useState<{ kind: 'new'; name: string; scopes: string[] } | { kind: 'created'; name: string; key: string } | { kind: 'view'; key: ApiKeyRow } | null>(null);
  const [formError, setFormError] = useState<ApiErr>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const label = (id: string) => catalogue?.scopes.find((s) => s.id === id)?.label ?? id;
  const close = () => setPanel(null);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (panel?.kind !== 'new') return;
    setFormError(null);
    setBusy(true);
    try {
      const r = await api<{ name: string; key: string }>(tenantPath(tenant, '/api-keys'), { method: 'POST', body: { name: panel.name, scopes: panel.scopes } });
      setPanel({ kind: 'created', name: r.name, key: r.key });
      reload();
    } catch (err) {
      setFormError({ message: errorMessage(err), details: errorDetails(err) });
    } finally {
      setBusy(false);
    }
  }

  async function revoke(k: ApiKeyRow) {
    if (!window.confirm(`Revoke "${k.name}"? Anything using it stops working straight away.`)) return;
    try {
      await api(tenantPath(tenant, `/api-keys/${k.id}`), { method: 'DELETE' });
      setMsg(`${k.name} revoked.`);
      setPanel(null);
      reload();
    } catch (err) {
      setFormError({ message: errorMessage(err), details: [] });
    }
  }

  const title = panel?.kind === 'new' ? 'New API key' : panel?.kind === 'created' ? `${panel.name} is ready` : panel?.kind === 'view' ? panel.key.name : '';

  return (
    <>
      <div className="row between conn-bar">
        <p className="muted small">Send the key as <code>Authorization: Bearer sf_live_…</code> to <code>{API_BASE}/v1/partner</code>.</p>
        {canEdit && <button className="btn btn-primary" onClick={() => { setFormError(null); setPanel({ kind: 'new', name: '', scopes: [] }); }}>Create key</button>}
      </div>

      <Sheet
        open={!!panel}
        narrow
        title={title}
        subtitle={panel?.kind === 'view' ? <><code>{panel.key.prefix}…</code> · created {formatDateTime(panel.key.createdAt)}</> : panel?.kind === 'new' ? 'One key per system, so you can revoke one without touching the others.' : undefined}
        onClose={close}
        onSubmit={panel?.kind === 'new' ? create : (e) => { e.preventDefault(); close(); }}
        footer={
          panel?.kind === 'new' ? (
            <>
              <button type="submit" className="btn btn-primary" disabled={busy || !panel.name.trim() || !panel.scopes.length}>{busy ? 'Creating…' : 'Create key'}</button>
              <button type="button" className="btn btn-ghost" onClick={close}>Cancel</button>
            </>
          ) : panel?.kind === 'created' ? (
            <button type="submit" className="btn btn-primary">I’ve copied it</button>
          ) : panel?.kind === 'view' ? (
            <>
              <button type="button" className="btn btn-ghost" onClick={close}>Close</button>
              {canEdit && !panel.key.revokedAt && (
                <button type="button" className="btn btn-danger sheet-foot-end" onClick={() => revoke(panel.key)}>Revoke key</button>
              )}
            </>
          ) : null
        }
      >
        {panel?.kind === 'new' && (
          <>
            <div className="field">
              <label htmlFor="key-name">Name</label>
              <input id="key-name" required placeholder="e.g. Planday, Power BI" value={panel.name} onChange={(e) => setPanel({ ...panel, name: e.target.value })} />
            </div>
            <fieldset className="plain">
              <legend className="label">What it can do</legend>
              <div className="conn-checks">
                {(catalogue?.scopes ?? []).map((s) => (
                  <label key={s.id} className="check">
                    <input type="checkbox" checked={panel.scopes.includes(s.id)} onChange={(e) => setPanel({ ...panel, scopes: e.target.checked ? [...panel.scopes, s.id] : panel.scopes.filter((x) => x !== s.id) })} />
                    <span>
                      {s.label} <code className="muted small">{s.id}</code>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          </>
        )}
        {panel?.kind === 'created' && <OnceSecret title="Copy the key now" note="Keep it somewhere safe. It is shown once; after this only its first characters are visible." value={panel.key} />}
        {panel?.kind === 'view' && (
          <dl className="tile-meta conn-detail">
            <dt>Status</dt>
            <dd>{panel.key.revokedAt ? `Revoked ${formatDateTime(panel.key.revokedAt)}` : 'Active'}</dd>
            <dt>Last used</dt>
            <dd>{panel.key.lastUsedAt ? formatDateTime(panel.key.lastUsedAt) : 'Not used yet'}</dd>
            <dt>Can</dt>
            <dd>
              <ul className="conn-scope-list">
                {panel.key.scopes.map((s) => <li key={s}>{label(s)} <code className="muted small">{s}</code></li>)}
              </ul>
            </dd>
          </dl>
        )}
        <ApiErrorNote error={formError} />
      </Sheet>

      <ErrorNote message={error} />
      <SuccessNote message={msg} />
      {loading && !rows ? (
        <Loading />
      ) : rows && rows.length === 0 ? (
        <p className="muted">No keys yet. Create one for each system, so you can revoke one without touching the others.</p>
      ) : (
        <ul className="tile-grid">
          {(rows ?? []).map((k) => (
            <li key={k.id} className={`card tile tile-click${k.revokedAt ? ' is-off' : ''}`}>
              <TileHit label={`Open ${k.name}`} onClick={() => { setFormError(null); setPanel({ kind: 'view', key: k }); }} />
              <div className="tile-head">
                <div>
                  <div className="tile-title">{k.name}</div>
                  <code className="small muted">{k.prefix}…</code>
                </div>
                <span className={`badge ${k.revokedAt ? 'badge-neutral' : 'badge-success'}`}>{k.revokedAt ? 'Revoked' : 'Active'}</span>
              </div>
              <ul className="tag-list" aria-label="What it can do">
                {k.scopes.map((s) => <li key={s}>{label(s)}</li>)}
              </ul>
              <div className="muted small conn-foot">{k.lastUsedAt ? `Last used ${formatDateTime(k.lastUsedAt)}` : 'Not used yet'}</div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Webhooks({ tenant, canEdit, rows, loading, error, reload, catalogue }: { tenant: string; canEdit: boolean; rows: WebhookRow[] | null; loading: boolean; error: string | null; reload: () => void; catalogue: IntegrationCatalogue | null }) {
  type Form = { url: string; description: string; events: string[] };
  const [panel, setPanel] = useState<{ kind: 'new'; form: Form } | { kind: 'created'; url: string; secret: string } | { kind: 'edit'; id: string; form: Form } | null>(null);
  const [formError, setFormError] = useState<ApiErr>(null);
  const [note, setNote] = useState<{ ok?: string; error?: string }>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const close = () => setPanel(null);
  const hook = panel?.kind === 'edit' ? rows?.find((h) => h.id === panel.id) ?? null : null;
  const eventLabel = (id: string) => catalogue?.events.find((e) => e.id === id)?.label ?? id;

  function open(h: WebhookRow) {
    setFormError(null);
    setNote({});
    setPanel({ kind: 'edit', id: h.id, form: { url: h.url, description: h.description ?? '', events: h.events } });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!panel || panel.kind === 'created') return close();
    setFormError(null);
    setBusy(true);
    try {
      const body = { ...panel.form, description: panel.form.description || null };
      if (panel.kind === 'new') {
        const r = await api<{ url: string; secret: string }>(tenantPath(tenant, '/webhooks'), { method: 'POST', body });
        setPanel({ kind: 'created', url: r.url, secret: r.secret });
      } else {
        await api(tenantPath(tenant, `/webhooks/${panel.id}`), { method: 'PUT', body });
        setMsg({ ok: 'Webhook saved.' });
        setPanel(null);
      }
      reload();
    } catch (err) {
      setFormError({ message: errorMessage(err), details: errorDetails(err) });
    } finally {
      setBusy(false);
    }
  }

  /** Test, pause and resend report inside the panel; delete closes it. */
  async function act(fn: () => Promise<unknown>, ok: string, closeAfter = false) {
    setNote({});
    try {
      const r = (await fn()) as { status?: string; error?: string | null } | undefined;
      if (r && r.status === 'failed') setNote({ error: `Not delivered: ${r.error ?? 'no answer'}` });
      else if (closeAfter) {
        setMsg({ ok });
        setPanel(null);
      } else setNote({ ok });
      reload();
    } catch (err) {
      setNote({ error: errorMessage(err) });
    }
  }

  const form = panel && panel.kind !== 'created' ? panel.form : null;
  const setForm = (f: Form) => panel && panel.kind !== 'created' && setPanel({ ...panel, form: f });
  const title = panel?.kind === 'new' ? 'New webhook' : panel?.kind === 'created' ? 'Webhook added' : hook ? hook.description || 'Webhook' : '';

  return (
    <>
      <div className="row between conn-bar">
        <p className="muted small">
          Each request carries <code>Seatfold-Signature: t=…,v1=…</code>, an HMAC-SHA256 of <code>{'{t}.{body}'}</code> with your secret.
        </p>
        {canEdit && <button className="btn btn-primary" onClick={() => { setFormError(null); setPanel({ kind: 'new', form: { url: '', description: '', events: ['booking.confirmed'] } }); }}>Add webhook</button>}
      </div>

      <Sheet
        open={!!panel}
        title={title}
        subtitle={hook ? <span className="break">{hook.url}</span> : panel?.kind === 'created' ? <span className="break">{panel.url}</span> : undefined}
        onClose={close}
        onSubmit={submit}
        footer={
          panel?.kind === 'created' ? (
            <button type="submit" className="btn btn-primary">I’ve copied it</button>
          ) : panel && canEdit ? (
            <>
              <button type="submit" className="btn btn-primary" disabled={busy || !form?.url || !form?.events.length}>
                {busy ? 'Saving…' : panel.kind === 'new' ? 'Add webhook' : 'Save changes'}
              </button>
              {hook && (
                <>
                  <button type="button" className="btn" onClick={() => act(() => api(tenantPath(tenant, `/webhooks/${hook.id}/test`), { method: 'POST' }), 'Test event delivered.')}>Send test</button>
                  <button type="button" className="btn btn-ghost" onClick={() => act(() => api(tenantPath(tenant, `/webhooks/${hook.id}`), { method: 'PUT', body: { active: !hook.active } }), hook.active ? 'Paused.' : 'Turned on.')}>{hook.active ? 'Pause' : 'Turn on'}</button>
                  <button type="button" className="btn btn-danger sheet-foot-end" onClick={() => window.confirm('Delete this webhook?') && act(() => api(tenantPath(tenant, `/webhooks/${hook.id}`), { method: 'DELETE' }), 'Webhook deleted.', true)}>Delete</button>
                </>
              )}
              {panel.kind === 'new' && <button type="button" className="btn btn-ghost" onClick={close}>Cancel</button>}
            </>
          ) : (
            <button type="button" className="btn btn-ghost" onClick={close}>Close</button>
          )
        }
      >
        {panel?.kind === 'created' && <OnceSecret title="Copy the signing secret now" note="The receiving system uses it to check each request came from Seatfold. It is shown once." value={panel.secret} />}
        {form && (
          <fieldset className="plain" disabled={!canEdit}>
            <div className="form-grid">
              <div className="field span-2">
                <label htmlFor="hook-url">HTTPS address</label>
                <input id="hook-url" type="url" required placeholder="https://hooks.example.com/seatfold" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
              </div>
              <div className="field span-2">
                <label htmlFor="hook-desc">What it's for (optional)</label>
                <input id="hook-desc" placeholder="e.g. Bookings into Power BI" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
            </div>
            <div className="label">Send these events</div>
            <div className="conn-checks">
              {(catalogue?.events ?? []).map((ev) => (
                <label key={ev.id} className="check">
                  <input type="checkbox" checked={form.events.includes(ev.id)} onChange={(e) => setForm({ ...form, events: e.target.checked ? [...form.events, ev.id] : form.events.filter((x) => x !== ev.id) })} />
                  <span>
                    {ev.label} <code className="muted small">{ev.id}</code>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {hook && (
          <section className="conn-log conn-log-sheet" aria-label="Recent deliveries">
            <div className="label">Recent deliveries</div>
            {hook.deliveries.length === 0 ? (
              <span className="muted small">Nothing sent yet. Send a test to check the address.</span>
            ) : (
              hook.deliveries.slice(0, 8).map((d) => (
                <div key={d.id} className="conn-log-row small">
                  <span className={`conn-dot ${d.status}`} aria-label={d.status} />
                  <span>{eventLabel(d.event)}</span>
                  <span className="muted">{d.responseCode ?? d.error ?? ''}</span>
                  <span className="muted">{formatDateTime(d.createdAt)}</span>
                  {canEdit && d.status === 'failed' && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => act(() => api(tenantPath(tenant, `/webhook-deliveries/${d.id}/resend`), { method: 'POST' }), 'Delivered.')}>Resend</button>
                  )}
                </div>
              ))
            )}
          </section>
        )}
        <ErrorNote message={note.error} />
        <SuccessNote message={note.ok} />
        <ApiErrorNote error={formError} />
      </Sheet>

      <ErrorNote message={error ?? msg.error} />
      <SuccessNote message={msg.ok} />
      {loading && !rows ? (
        <Loading />
      ) : rows && rows.length === 0 ? (
        <p className="muted">No webhooks yet.</p>
      ) : (
        <ul className="tile-grid wide">
          {(rows ?? []).map((h) => {
            const last = h.deliveries[0];
            return (
              <li key={h.id} className={`card tile tile-click${h.active ? '' : ' is-off'}`}>
                <TileHit label={`Open webhook ${h.description ?? h.url}`} onClick={() => open(h)} />
                <div className="tile-head">
                  <div className="conn-url">
                    <div className="tile-title">{h.description || 'Webhook'}</div>
                    <div className="muted small break">{h.url}</div>
                  </div>
                  <span className={`badge ${h.active ? 'badge-success' : 'badge-neutral'}`}>{h.active ? 'On' : 'Paused'}</span>
                </div>
                <ul className="tag-list" aria-label="Events">
                  {h.events.map((e) => <li key={e}>{eventLabel(e)}</li>)}
                </ul>
                <div className="small conn-foot">
                  {last ? (
                    <>
                      <span className={`conn-dot ${last.status}`} aria-hidden="true" />
                      <span className="muted">
                        Last {last.status === 'failed' ? 'delivery failed' : 'delivered'} {formatDateTime(last.createdAt)}
                      </span>
                    </>
                  ) : (
                    <span className="muted">Nothing sent yet</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
