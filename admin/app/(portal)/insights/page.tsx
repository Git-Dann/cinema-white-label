'use client';

import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/ui';
import { useSession } from '@/lib/session';
import { Bars, build, Funnel, Heatmap, Kpi, Mix, num, pct, Range, RANGES, TrendChart, RangePicker } from '@/components/insights';

export default function InsightsPage() {
  const { tenantName } = useSession();
  const [range, setRange] = useState<Range>('30d');
  const data = useMemo(() => build(range), [range]);
  const label = RANGES.find((r) => r.id === range)!.label.toLowerCase();

  return (
    <>
      <PageHeader title="Insights" description={`${tenantName} · ${label}`} actions={<span className="badge badge-sample">Sample data</span>} />
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

