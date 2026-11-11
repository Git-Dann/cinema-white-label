'use client';

import { FormEvent, useMemo, useState } from 'react';
import { ApiErrorNote, ErrorNote, Loading, PageHeader, ReadOnlyNote, SuccessNote } from '@/components/ui';
import { API_BASE, ApiKeyRow, api, errorDetails, errorMessage, Film, IntegrationCatalogue, ShiftRow, tenantPath, WebhookRow } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useSession, useTenantData } from '@/lib/session';

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

function Keys({ tenant, canEdit, rows, loading, error, reload, catalogue }: { tenant: string; canEdit: boolean; rows: ApiKeyRow[] | null; loading: boolean; error: string | null; reload: () => void; catalogue: IntegrationCatalogue | null }) {
  const [form, setForm] = useState<{ name: string; scopes: string[] } | null>(null);
  const [created, setCreated] = useState<{ name: string; key: string } | null>(null);
  const [formError, setFormError] = useState<ApiErr>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const label = (id: string) => catalogue?.scopes.find((s) => s.id === id)?.label ?? id;

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setFormError(null);
    try {
      const r = await api<{ name: string; key: string }>(tenantPath(tenant, '/api-keys'), { method: 'POST', body: form });
      setCreated({ name: r.name, key: r.key });
      setForm(null);
      reload();
    } catch (err) {
      setFormError({ message: errorMessage(err), details: errorDetails(err) });
    }
  }

  async function revoke(k: ApiKeyRow) {
    if (!window.confirm(`Revoke "${k.name}"? Anything using it stops working straight away.`)) return;
    try {
      await api(tenantPath(tenant, `/api-keys/${k.id}`), { method: 'DELETE' });
      setMsg(`${k.name} revoked.`);
      reload();
    } catch (err) {
      setMsg(errorMessage(err));
    }
  }

  return (
    <>
      <div className="row between conn-bar">
        <p className="muted small">Send the key as <code>Authorization: Bearer sf_live_…</code> to <code>{API_BASE}/v1/partner</code>.</p>
        {canEdit && !form && <button className="btn btn-primary" onClick={() => { setForm({ name: '', scopes: [] }); setCreated(null); }}>Create key</button>}
      </div>
      {created && (
        <div className="card team-created" role="status">
          <strong>{created.name} is ready.</strong>
          <p className="small">Copy it now and keep it somewhere safe. It is shown once; after this only its first characters are visible.</p>
          <div className="team-password">
            <code className="break">{created.key}</code>
            <button className="btn btn-ghost btn-sm" onClick={() => navigator.clipboard?.writeText(created.key)}>Copy</button>
          </div>
        </div>
      )}
      {form && (
        <form className="card team-form" onSubmit={create} aria-labelledby="key-new">
          <h2 id="key-new" className="h3">New API key</h2>
          <ApiErrorNote error={formError} />
          <div className="field">
            <label htmlFor="key-name">Name</label>
            <input id="key-name" required placeholder="e.g. Planday, Power BI" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <fieldset className="plain">
            <legend className="label">What it can do</legend>
            <div className="check-grid">
              {(catalogue?.scopes ?? []).map((s) => (
                <label key={s.id} className="check">
                  <input type="checkbox" checked={form.scopes.includes(s.id)} onChange={(e) => setForm({ ...form, scopes: e.target.checked ? [...form.scopes, s.id] : form.scopes.filter((x) => x !== s.id) })} />
                  <span>
                    <code>{s.id}</code> <span className="muted small">{s.label}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="row gap-1">
            <button className="btn btn-primary" disabled={!form.name.trim() || !form.scopes.length}>Create key</button>
            <button type="button" className="btn btn-ghost" onClick={() => setForm(null)}>Cancel</button>
          </div>
        </form>
      )}
      <ErrorNote message={error} />
      <SuccessNote message={msg} />
      {loading && !rows ? (
        <Loading />
      ) : rows && rows.length === 0 ? (
        <p className="muted">No keys yet. Create one for each system, so you can revoke one without touching the others.</p>
      ) : (
        <ul className="tile-grid">
          {(rows ?? []).map((k) => (
            <li key={k.id} className={`card tile${k.revokedAt ? ' is-off' : ''}`}>
              <div className="tile-head">
                <div>
                  <div className="tile-title">{k.name}</div>
                  <code className="small">{k.prefix}…</code>
                </div>
                <span className={`badge ${k.revokedAt ? 'badge-neutral' : 'badge-success'}`}>{k.revokedAt ? 'Revoked' : 'Active'}</span>
              </div>
              <ul className="tag-list" aria-label="Scopes">
                {k.scopes.map((s) => <li key={s} title={label(s)}>{s}</li>)}
              </ul>
              <div className="muted small">
                Created {formatDateTime(k.createdAt)} · {k.lastUsedAt ? `last used ${formatDateTime(k.lastUsedAt)}` : 'not used yet'}
              </div>
              {canEdit && !k.revokedAt && (
                <div className="tile-actions">
                  <button className="btn btn-sm btn-danger" onClick={() => revoke(k)}>Revoke</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Webhooks({ tenant, canEdit, rows, loading, error, reload, catalogue }: { tenant: string; canEdit: boolean; rows: WebhookRow[] | null; loading: boolean; error: string | null; reload: () => void; catalogue: IntegrationCatalogue | null }) {
  const [form, setForm] = useState<{ url: string; description: string; events: string[] } | null>(null);
  const [created, setCreated] = useState<{ url: string; secret: string } | null>(null);
  const [formError, setFormError] = useState<ApiErr>(null);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setFormError(null);
    try {
      const r = await api<{ url: string; secret: string }>(tenantPath(tenant, '/webhooks'), { method: 'POST', body: { ...form, description: form.description || null } });
      setCreated(r);
      setForm(null);
      reload();
    } catch (err) {
      setFormError({ message: errorMessage(err), details: errorDetails(err) });
    }
  }

  async function act(fn: () => Promise<{ status?: string; responseCode?: number | null; error?: string | null } | unknown>, ok: string) {
    setMsg({});
    try {
      const r = (await fn()) as { status?: string; error?: string | null } | undefined;
      if (r && r.status === 'failed') setMsg({ error: `Not delivered: ${r.error ?? 'no answer'}` });
      else setMsg({ ok });
      reload();
    } catch (err) {
      setMsg({ error: errorMessage(err) });
    }
  }

  return (
    <>
      <div className="row between conn-bar">
        <p className="muted small">
          Each request carries <code>Seatfold-Signature: t=…,v1=…</code>, an HMAC-SHA256 of <code>{'{t}.{body}'}</code> with your secret.
        </p>
        {canEdit && !form && <button className="btn btn-primary" onClick={() => { setForm({ url: '', description: '', events: ['booking.confirmed'] }); setCreated(null); }}>Add webhook</button>}
      </div>
      {created && (
        <div className="card team-created" role="status">
          <strong>Webhook added for {created.url}</strong>
          <p className="small">This is its signing secret. It is shown once, so copy it into the receiving system now.</p>
          <div className="team-password">
            <code className="break">{created.secret}</code>
            <button className="btn btn-ghost btn-sm" onClick={() => navigator.clipboard?.writeText(created.secret)}>Copy</button>
          </div>
        </div>
      )}
      {form && (
        <form className="card team-form" onSubmit={create} aria-labelledby="hook-new">
          <h2 id="hook-new" className="h3">New webhook</h2>
          <ApiErrorNote error={formError} />
          <div className="form-grid">
            <div className="field span-2">
              <label htmlFor="hook-url">HTTPS address</label>
              <input id="hook-url" type="url" required placeholder="https://hooks.example.com/seatfold" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
            </div>
            <div className="field span-2">
              <label htmlFor="hook-desc">What it's for (optional)</label>
              <input id="hook-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
          </div>
          <fieldset className="plain">
            <legend className="label">Send these events</legend>
            <div className="check-grid">
              {(catalogue?.events ?? []).map((ev) => (
                <label key={ev.id} className="check">
                  <input type="checkbox" checked={form.events.includes(ev.id)} onChange={(e) => setForm({ ...form, events: e.target.checked ? [...form.events, ev.id] : form.events.filter((x) => x !== ev.id) })} />
                  <span>
                    <code>{ev.id}</code> <span className="muted small">{ev.label}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="row gap-1">
            <button className="btn btn-primary" disabled={!form.url || !form.events.length}>Add webhook</button>
            <button type="button" className="btn btn-ghost" onClick={() => setForm(null)}>Cancel</button>
          </div>
        </form>
      )}
      <ErrorNote message={error ?? msg.error} />
      <SuccessNote message={msg.ok} />
      {loading && !rows ? (
        <Loading />
      ) : rows && rows.length === 0 ? (
        <p className="muted">No webhooks yet.</p>
      ) : (
        <ul className="tile-grid wide">
          {(rows ?? []).map((h) => (
            <li key={h.id} className={`card tile${h.active ? '' : ' is-off'}`}>
              <div className="tile-head">
                <div className="conn-url">
                  <div className="tile-title break">{h.url}</div>
                  {h.description && <div className="muted small">{h.description}</div>}
                </div>
                <span className={`badge ${h.active ? 'badge-success' : 'badge-neutral'}`}>{h.active ? 'On' : 'Paused'}</span>
              </div>
              <ul className="tag-list" aria-label="Events">
                {h.events.map((e) => <li key={e}>{e}</li>)}
              </ul>
              <div className="conn-log" aria-label="Recent deliveries">
                {h.deliveries.length === 0 ? (
                  <span className="muted small">Nothing sent yet</span>
                ) : (
                  h.deliveries.slice(0, 5).map((d) => (
                    <div key={d.id} className="conn-log-row small">
                      <span className={`conn-dot ${d.status}`} aria-label={d.status} />
                      <code>{d.event}</code>
                      <span className="muted">{d.responseCode ?? d.error ?? ''}</span>
                      <span className="muted">{formatDateTime(d.createdAt)}</span>
                      {canEdit && d.status === 'failed' && (
                        <button className="btn btn-ghost btn-sm" onClick={() => act(() => api(tenantPath(tenant, `/webhook-deliveries/${d.id}/resend`), { method: 'POST' }), 'Delivered.')}>Resend</button>
                      )}
                    </div>
                  ))
                )}
              </div>
              {canEdit && (
                <div className="tile-actions">
                  <button className="btn btn-sm" onClick={() => act(() => api(tenantPath(tenant, `/webhooks/${h.id}/test`), { method: 'POST' }), 'Test event delivered.')}>Send test</button>
                  <button className="btn btn-sm" onClick={() => act(() => api(tenantPath(tenant, `/webhooks/${h.id}`), { method: 'PUT', body: { active: !h.active } }), h.active ? 'Paused.' : 'Turned on.')}>{h.active ? 'Pause' : 'Turn on'}</button>
                  <button className="btn btn-sm btn-danger" onClick={() => window.confirm('Delete this webhook?') && act(() => api(tenantPath(tenant, `/webhooks/${h.id}`), { method: 'DELETE' }), 'Webhook deleted.')}>Delete</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
