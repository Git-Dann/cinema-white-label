'use client';

import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/ui';
import { useSession, useTenantData } from '@/lib/session';
import { PulseAnomalies, PulseBaskets, PulseLoyalty, tenantPath } from '@/lib/api';
import { ErrorNote, Loading } from '@/components/ui';
import { Bars, build, Funnel, Heatmap, Kpi, Mix, num, pct, Range, RANGES, TrendChart, RangePicker } from '@/components/insights';

const longDay = (ymd: string) => new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${ymd}T12:00:00Z`));

/** Real panels from Pulse: days that broke from the forecast, what sells together, who your customers are. */
function PulsePanels() {
  const { tenant } = useSession();
  const alerts = useTenantData<PulseAnomalies>(tenantPath(tenant, '/pulse/anomalies'));
  const baskets = useTenantData<PulseBaskets>(tenantPath(tenant, '/pulse/baskets'));
  const loyalty = useTenantData<PulseLoyalty>(tenantPath(tenant, '/pulse/loyalty'));
  const maxShare = Math.max(0.01, ...(loyalty.data?.segments.map((g) => g.share) ?? [0]));

  return (
    <section className="pulse-section" aria-labelledby="ins-pulse">
      <header className="pulse-section-head">
        <h2 id="ins-pulse" className="h3">From Pulse</h2>
        <p className="pulse-basis small">
          <span className="pulse-mark" aria-hidden="true" />
          <span className="muted">Worked out from your bookings and food orders</span>
          {[alerts.data?.basis, baskets.data?.basis, loyalty.data?.basis].some((b) => b && ((b.demoShows ?? 0) > 0 || (b.demoOrders ?? 0) > 0 || (b.demoCustomers ?? 0) > 0)) && <span className="badge badge-sample">Demo history</span>}
        </p>
      </header>
      <div className="insights-grid">
        <section className="card ins-card span-2" aria-labelledby="ins-alerts">
          <header className="ins-head">
            <h2 id="ins-alerts" className="h3">Days that broke from the forecast</h2>
            <span className="muted small">{alerts.data ? `Last ${alerts.data.days} cinema-days` : ''}</span>
          </header>
          <ErrorNote message={alerts.error} />
          {alerts.loading && !alerts.data ? (
            <Loading />
          ) : alerts.data && alerts.data.anomalies.length === 0 ? (
            <p className="muted small">Nothing unusual: every day landed close to what Pulse expected.</p>
          ) : (
            <ul className="pulse-alerts">
              {alerts.data?.anomalies.map((a) => (
                <li key={`${a.venueId}-${a.date}`} className={a.ratio < 1 ? 'down' : 'up'}>
                  <span className="pulse-alert-figure num">{a.ratio < 1 ? `${Math.round((1 - a.ratio) * 100)}% below` : `${Math.round((a.ratio - 1) * 100)}% above`}</span>
                  <div>
                    <strong>
                      {a.venueName} · {longDay(a.date)}
                    </strong>
                    <span className="muted small num">
                      {a.actual} admissions against about {a.forecast} expected
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {alerts.data && alerts.data.anomalies.length > 0 && alerts.data.anomalies.length < 3 && <p className="muted small">Every other day landed close to what Pulse expected.</p>}
        </section>

        <section className="card ins-card span-2" aria-labelledby="ins-bundles">
          <header className="ins-head">
            <h2 id="ins-bundles" className="h3">Bought together</h2>
            <span className="muted small">Bundle ideas from food orders</span>
          </header>
          <ErrorNote message={baskets.error} />
          {baskets.loading && !baskets.data ? (
            <Loading />
          ) : baskets.data && baskets.data.rules.length === 0 ? (
            <p className="muted small">Not enough food orders yet to see what goes together.</p>
          ) : (
            <ul className="pulse-bundles">
              {baskets.data?.rules.map((r) => (
                <li key={r.items.join('+')}>
                  <div className="pulse-bundle-items">
                    {r.items.map((i, n) => (
                      <span key={i}>
                        {n > 0 && <span className="muted"> + </span>}
                        <strong>{i}</strong>
                      </span>
                    ))}
                  </div>
                  <div className="pulse-bundle-stats small">
                    <span className="badge badge-success">{r.lift.toFixed(1)}× more likely together</span>
                    <span className="muted num">
                      in {Math.round(r.support * 100)}% of orders · {Math.round(r.confidence * 100)}% follow-through
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card ins-card span-2" aria-labelledby="ins-segments">
          <header className="ins-head">
            <h2 id="ins-segments" className="h3">Your customers</h2>
            <span className="muted small">{loyalty.data ? `${loyalty.data.customers.toLocaleString('en-GB')} customers · ${loyalty.data.atRisk.customers} at risk of drifting away` : ''}</span>
          </header>
          <ErrorNote message={loyalty.error} />
          {loyalty.loading && !loyalty.data ? (
            <Loading />
          ) : (
            <ul className="pulse-segments">
              {loyalty.data?.segments.map((g) => (
                <li key={g.name}>
                  <div className="pulse-segment-head">
                    <strong>{g.name}</strong>
                    <span className="num">
                      {g.customers.toLocaleString('en-GB')} <span className="muted small">· {Math.round(g.share * 100)}%</span>
                    </span>
                  </div>
                  <div className="pulse-segment-bar" aria-hidden="true">
                    <span style={{ width: `${(g.share / maxShare) * 100}%` }} />
                  </div>
                  <span className="small pulse-segment-action" title={g.description}>{g.action}</span>
                </li>
              ))}
              {loyalty.data && (
                <li className="pulse-segment-risk">
                  <div className="pulse-segment-head">
                    <strong>At risk</strong>
                    <span className="num">
                      {loyalty.data.atRisk.customers.toLocaleString('en-GB')} <span className="muted small">· {Math.round(loyalty.data.atRisk.share * 100)}%</span>
                    </span>
                  </div>
                  <span className="small pulse-segment-action">{loyalty.data.atRisk.note}</span>
                </li>
              )}
            </ul>
          )}
        </section>
      </div>
    </section>
  );
}

export default function InsightsPage() {
  const { tenantName } = useSession();
  const [range, setRange] = useState<Range>('30d');
  const data = useMemo(() => build(range), [range]);
  const label = RANGES.find((r) => r.id === range)!.label.toLowerCase();

  return (
    <>
      <PageHeader title="Insights" description={`${tenantName} · what Pulse sees, then trading figures`} />
      <PulsePanels />

      <header className="pulse-section-head nw-later-head">
        <h2 className="h3">Trading figures · {label}</h2>
        <span className="badge badge-sample">Sample data</span>
      </header>
      <div className="insights-toolbar">
        <RangePicker value={range} onChange={setRange} />
        <p className="muted small">Illustrative figures to show what operators will see. Not linked to live bookings yet.</p>
      </div>

      <section className="stat-grid insights-kpis" aria-label="Key figures">
        {data.kpis.map((k, i) => (
          <Kpi key={k.label} kpi={k} index={i} />
        ))}
      </section>

      <div className="insights-grid">
        <section className="card ins-card span-2" aria-labelledby="ins-rev">
          <header className="ins-head">
            <h2 id="ins-rev" className="h3">Revenue</h2>
            <span className="muted small">{RANGES.find((r) => r.id === range)!.unit === 'day' ? 'Per day' : RANGES.find((r) => r.id === range)!.unit === 'week' ? 'Per week' : 'Per month'}</span>
          </header>
          <TrendChart key={range} points={data.trend} />
        </section>

        <section className="card ins-card" aria-labelledby="ins-mix">
          <header className="ins-head">
            <h2 id="ins-mix" className="h3">Where revenue comes from</h2>
          </header>
          <Mix mix={data.mix} />
        </section>

        <section className="card ins-card" aria-labelledby="ins-films">
          <header className="ins-head">
            <h2 id="ins-films" className="h3">Top films</h2>
            <span className="muted small">Tickets sold</span>
          </header>
          <Bars rows={data.films.map((f) => ({ label: f.title, value: f.tickets, text: num(f.tickets) }))} />
        </section>

        <section className="card ins-card" aria-labelledby="ins-heat">
          <header className="ins-head">
            <h2 id="ins-heat" className="h3">Busiest times</h2>
            <span className="muted small">Tickets by start time</span>
          </header>
          <Heatmap grid={data.heat} />
        </section>

        <section className="card ins-card" aria-labelledby="ins-funnel">
          <header className="ins-head">
            <h2 id="ins-funnel" className="h3">App booking funnel</h2>
            <span className="muted small">{pct((data.funnel[4].value / data.funnel[0].value) * 100)} convert</span>
          </header>
          <Funnel steps={data.funnel} />
        </section>

        <section className="card ins-card span-2" aria-labelledby="ins-food">
          <header className="ins-head">
            <h2 id="ins-food" className="h3">Food & drink attach rate</h2>
            <span className="muted small">Share of bookings that include the item</span>
          </header>
          <Bars rows={data.products.map((p) => ({ label: p.name, value: p.attach, text: pct(p.attach) }))} max={40} tone="food" />
        </section>
      </div>
    </>
  );
}

