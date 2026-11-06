'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { AiPanel, aiInsightsFor, Bars, build, forecastFor, Kpi, Mix, num, Range, RANGES, RangePicker, TrendChart } from '@/components/insights';

/**
 * Overview block: a short version of Insights with an "AI insights" layer that can
 * be switched on. Sample data only, and labelled as such on screen.
 */
export function PerformancePreview() {
  const [range, setRange] = useState<Range>('30d');
  const [ai, setAi] = useState(false);
  const data = useMemo(() => build(range), [range]);
  const r = RANGES.find((x) => x.id === range)!;
  const forecast = useMemo(() => (ai ? forecastFor(data.trend, r.unit, Math.max(4, Math.round(data.trend.length * 0.25))) : []), [ai, data, r.unit]);
  const insights = useMemo(() => aiInsightsFor(range), [range]);

  return (
    <section className={`perf${ai ? ' perf-ai' : ''}`} aria-labelledby="perf-title">
      <header className="perf-head">
        <div>
          <h2 id="perf-title" className="h3">
            Performance <span className="badge badge-sample">Sample data</span>
          </h2>
          <p className="muted small">A preview of the analytics operators will get. Not linked to live bookings yet.</p>
        </div>
        <div className="perf-controls">
          <RangePicker value={range} onChange={setRange} />
          <button type="button" className={`ai-toggle${ai ? ' on' : ''}`} role="switch" aria-checked={ai} onClick={() => setAi((v) => !v)}>
            <span className="ai-spark" aria-hidden="true">✦</span> AI insights
            <span className="ai-switch" aria-hidden="true">
              <span />
            </span>
          </button>
        </div>
      </header>

      {ai && <AiPanel key={range} insights={insights} />}

      <div className="stat-grid insights-kpis">
        {data.kpis.map((k, i) => (
          <Kpi key={k.label} kpi={k} index={i} />
        ))}
      </div>

      <div className="insights-grid">
        <section className="card ins-card span-2" aria-labelledby="perf-rev">
          <header className="ins-head">
            <h3 id="perf-rev" className="h3">Revenue</h3>
            <span className="muted small">{ai ? 'With AI forecast' : r.unit === 'day' ? 'Per day' : r.unit === 'week' ? 'Per week' : 'Per month'}</span>
          </header>
          <TrendChart key={`${range}-${ai}`} points={data.trend} forecast={forecast} />
        </section>
        <section className="card ins-card" aria-labelledby="perf-mix">
          <header className="ins-head">
            <h3 id="perf-mix" className="h3">Where revenue comes from</h3>
          </header>
          <Mix mix={data.mix} />
        </section>
        <section className="card ins-card" aria-labelledby="perf-films">
          <header className="ins-head">
            <h3 id="perf-films" className="h3">Top films</h3>
            <Link href="/insights" className="small">Full insights →</Link>
          </header>
          <Bars rows={data.films.slice(0, 4).map((f) => ({ label: f.title, value: f.tickets, text: num(f.tickets) }))} />
        </section>
      </div>
    </section>
  );
}
