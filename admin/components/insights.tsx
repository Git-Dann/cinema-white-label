'use client';

import { useEffect, useRef, useState } from 'react';

/*
 * Insights: a visual preview of the analytics an operator gets. Every figure on
 * this page is generated sample data (seeded, so it is stable between visits)
 * and is labelled as such. Nothing here reads bookings or the API.
 */

export type Range = '7d' | '30d' | '1y' | 'all';
export const RANGES: { id: Range; label: string; points: number; unit: 'day' | 'week' | 'month'; days: number }[] = [
  { id: '7d', label: 'Last 7 days', points: 7, unit: 'day', days: 7 },
  { id: '30d', label: 'Last 30 days', points: 30, unit: 'day', days: 30 },
  { id: '1y', label: 'Last year', points: 52, unit: 'week', days: 365 },
  { id: 'all', label: 'All time', points: 36, unit: 'month', days: 1095 },
];

// Categorical slots (dark steps, validated against the portal surface): fixed order, never cycled.
export const SERIES = { tickets: '#3987e5', food: '#d95926', memberships: '#199e70' } as const;
// Sequential blue ramp, low → high, for the busiest-times heatmap.
const RAMP = ['#1a2433', '#184f95', '#1c5cab', '#256abf', '#2a78d6', '#3987e5', '#5598e7', '#86b6ef'];

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export const gbp = (pence: number, compact = false) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: compact || pence >= 100_000 ? 0 : 2, notation: compact ? 'compact' : 'standard' }).format(pence / 100);
export const num = (n: number, compact = false) => new Intl.NumberFormat('en-GB', { notation: compact ? 'compact' : 'standard', maximumFractionDigits: compact ? 1 : 0 }).format(n);
export const pct = (n: number) => `${n.toFixed(1)}%`;

export interface Data {
  trend: { label: string; revenue: number }[];
  kpis: { label: string; value: string; raw: number; format: (n: number) => string; delta: number; spark: number[] }[];
  mix: { key: keyof typeof SERIES; label: string; value: number }[];
  films: { title: string; tickets: number }[];
  heat: number[][];
  funnel: { label: string; value: number }[];
  products: { name: string; attach: number }[];
}

export function build(range: Range): Data {
  const r = RANGES.find((x) => x.id === range)!;
  const rand = rng({ '7d': 7, '30d': 30, '1y': 365, all: 1095 }[range]);
  const scale = r.days / 30;
  const today = new Date('2026-11-06T12:00:00Z');
  const trend = Array.from({ length: r.points }, (_, i) => {
    const back = r.points - 1 - i;
    const d = new Date(today);
    let label: string;
    let base: number;
    if (r.unit === 'day') {
      d.setUTCDate(d.getUTCDate() - back);
      const dow = d.getUTCDay();
      base = [1.35, 0.7, 0.75, 0.8, 0.95, 1.4, 1.6][dow] * 520_000;
      label = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
    } else if (r.unit === 'week') {
      d.setUTCDate(d.getUTCDate() - back * 7);
      base = 3_600_000 * (1 + 0.25 * Math.sin((i / 52) * Math.PI * 2 - 1.2)) * (1 + i / 300);
      label = `w/c ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}`;
    } else {
      d.setUTCMonth(d.getUTCMonth() - back);
      base = 13_000_000 * (0.75 + i / 70) * (1 + 0.22 * Math.sin((i / 12) * Math.PI * 2 - 1.4));
      label = d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
    }
    return { label, revenue: Math.round(base * (0.88 + rand() * 0.24)) };
  });
  const revenue = trend.reduce((a, p) => a + p.revenue, 0);
  const tickets = Math.round(revenue / 1180);
  const spark = (n: number, drift: number) => Array.from({ length: 12 }, (_, i) => 1 + drift * (i / 11) + (rand() - 0.5) * 0.18).slice(0, n);
  const occupancy = 46 + rand() * 18;
  const kpis: Data['kpis'] = [
    { label: 'Revenue', value: gbp(revenue), raw: revenue, format: (n) => gbp(n), delta: 6 + rand() * 9, spark: spark(12, 0.35) },
    { label: 'Tickets sold', value: num(tickets), raw: tickets, format: (n) => num(n), delta: 3 + rand() * 8, spark: spark(12, 0.25) },
    { label: 'Spend per head', value: gbp(Math.round(revenue / tickets)), raw: Math.round(revenue / tickets), format: (n) => gbp(n), delta: 1 + rand() * 4, spark: spark(12, 0.12) },
    { label: 'Seat occupancy', value: pct(occupancy), raw: occupancy, format: (n) => pct(n), delta: -1.5 + rand() * 5, spark: spark(12, 0.08) },
  ];
  const foodShare = 0.27 + rand() * 0.04;
  const memberShare = 0.08 + rand() * 0.03;
  const mix: Data['mix'] = [
    { key: 'tickets', label: 'Tickets', value: Math.round(revenue * (1 - foodShare - memberShare)) },
    { key: 'food', label: 'Food & drink', value: Math.round(revenue * foodShare) },
    { key: 'memberships', label: 'Memberships', value: Math.round(revenue * memberShare) },
  ];
  const titles = ['Ember Protocol', 'Tidewater', 'The Lantern Keeper', 'Signal Lost', 'Northbound', 'Paper Comets'];
  const weights = [1, 0.74, 0.58, 0.41, 0.33, 0.22].map((w) => w * (0.9 + rand() * 0.2));
  const wsum = weights.reduce((a, b) => a + b, 0);
  const films = titles.map((title, i) => ({ title, tickets: Math.round((tickets * 0.82 * weights[i]) / wsum) })).sort((a, b) => b.tickets - a.tickets);
  // Days (Mon–Sun) × time slots: weekends and evenings are busiest.
  const heat = Array.from({ length: 7 }, (_, d) =>
    Array.from({ length: 6 }, (_, h) => {
      const day = [0.55, 0.5, 0.6, 0.7, 1, 1.25, 1.1][d];
      const slot = [0.25, 0.45, 0.6, 0.85, 1, 0.55][h];
      return Math.round(day * slot * 100 * (0.85 + rand() * 0.3) * scale);
    }),
  );
  const sessions = Math.round(tickets * 4.6);
  const funnel = [
    { label: 'Opened the app', value: sessions },
    { label: 'Viewed a film', value: Math.round(sessions * 0.62) },
    { label: 'Chose seats', value: Math.round(sessions * 0.31) },
    { label: 'Reached payment', value: Math.round(sessions * 0.24) },
    { label: 'Booked', value: Math.round(sessions * 0.2) },
  ];
  const products = [
    { name: 'Salted popcorn', attach: 31 },
    { name: 'Fountain drink', attach: 27 },
    { name: 'Date night combo', attach: 14 },
    { name: 'Ember Protocol bucket', attach: 9 },
    { name: 'Hot chocolate', attach: 6 },
  ].map((p) => ({ ...p, attach: Math.round(p.attach * (0.85 + rand() * 0.3) * 10) / 10 }));
  return { trend, kpis, mix, films, heat, funnel, products };
}

/** Animates from the previous value to the new one whenever it changes. */
export function useTween(target: number, ms = 900) {
  const [v, setV] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      setV(target);
      from.current = target;
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      setV(a + (target - a) * e);
      if (k < 1) raf = requestAnimationFrame(tick);
      else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      from.current = target;
    };
  }, [target, ms]);
  return v;
}

export function Kpi({ kpi, index }: { kpi: Data['kpis'][number]; index: number }) {
  const v = useTween(kpi.raw);
  const up = kpi.delta >= 0;
  const w = 96, h = 28;
  const min = Math.min(...kpi.spark), max = Math.max(...kpi.spark);
  const pts = kpi.spark.map((s, i) => `${(i / (kpi.spark.length - 1)) * w},${h - 2 - ((s - min) / (max - min || 1)) * (h - 4)}`).join(' ');
  return (
    <div className="stat-card ins-kpi" style={{ animationDelay: `${index * 60}ms` }}>
      <div className="stat-label">{kpi.label}</div>
      <div className="stat-value num">{kpi.format(v)}</div>
      <div className="ins-kpi-foot">
        <span className={`ins-delta ${up ? 'up' : 'down'}`} aria-label={`${up ? 'Up' : 'Down'} ${Math.abs(kpi.delta).toFixed(1)}% on the previous period`}>
          {up ? '▲' : '▼'} {Math.abs(kpi.delta).toFixed(1)}%
        </span>
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" className="ins-spark">
          <polyline key={kpi.value} points={pts} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" pathLength={1} />
        </svg>
      </div>
    </div>
  );
}

export interface ForecastPoint { label: string; revenue: number; low: number; high: number }

/** Sample "AI" projection: repeats the recent pattern with gentle growth and a widening band. */
export function forecastFor(points: { label: string; revenue: number }[], unit: 'day' | 'week' | 'month', n: number): ForecastPoint[] {
  const period = unit === 'day' ? 7 : unit === 'week' ? 4 : 12;
  const name = unit === 'day' ? 'day' : unit === 'week' ? 'week' : 'month';
  return Array.from({ length: n }, (_, k) => {
    const ref = points[Math.max(0, points.length - period + (k % period))]?.revenue ?? points[points.length - 1].revenue;
    const revenue = Math.round(ref * (1.04 + k * 0.004));
    const spread = 0.06 + k * 0.012;
    return { label: `Forecast · ${name} ${k + 1}`, revenue, low: Math.round(revenue * (1 - spread)), high: Math.round(revenue * (1 + spread)) };
  });
}

export function TrendChart({ points, forecast = [] }: { points: { label: string; revenue: number }[]; forecast?: ForecastPoint[] }) {
  // Drawn at the container's real width so axis text stays at its true size on any screen.
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(760);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = W < 520 ? 200 : 260, L = 48, R = 12, T = 12, B = 28;
  const [hover, setHover] = useState<number | null>(null);
  // Round gridlines, with the top one always above the highest point.
  const all = [...points, ...forecast];
  const max = Math.max(...points.map((p) => p.revenue), ...forecast.map((f) => f.high)) * 1.05;
  const step = Math.pow(10, Math.floor(Math.log10(max / 4)));
  const tick = [1, 2, 2.5, 5, 10].map((m) => m * step).find((t) => t * 4 >= max) ?? step * 10;
  const ticks = Array.from({ length: Math.ceil(max / tick) + 1 }, (_, i) => i * tick);
  const top = ticks[ticks.length - 1];
  const x = (i: number) => L + (all.length === 1 ? 0 : (i / (all.length - 1)) * (W - L - R));
  const y = (v: number) => T + (1 - v / top) * (H - T - B);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.revenue).toFixed(1)}`).join('');
  const area = `${line}L${x(points.length - 1)},${y(0)}L${x(0)},${y(0)}Z`;
  const every = Math.ceil(points.length / (W < 520 ? 3 : 6));
  const last = points.length - 1;
  const fLine = forecast.length ? `M${x(last)},${y(points[last].revenue)}` + forecast.map((f, k) => `L${x(last + 1 + k).toFixed(1)},${y(f.revenue).toFixed(1)}`).join('') : '';
  const fBand = forecast.length
    ? `M${x(last)},${y(points[last].revenue)}` + forecast.map((f, k) => `L${x(last + 1 + k).toFixed(1)},${y(f.high).toFixed(1)}`).join('') +
      [...forecast].reverse().map((f, k) => `L${x(last + forecast.length - k).toFixed(1)},${y(f.low).toFixed(1)}`).join('') + 'Z'
    : '';

  function move(e: React.PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - L) / (W - L - R)) * (all.length - 1));
    setHover(Math.max(0, Math.min(all.length - 1, i)));
  }

  const hp = hover !== null ? all[hover] : null;
  const isForecast = hover !== null && hover > last;
  return (
    <div className="ins-trend" ref={box}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="ins-svg" onPointerMove={move} onPointerLeave={() => setHover(null)} role="img" aria-label={`Revenue trend from ${points[0].label} to ${points[points.length - 1].label}`}>
        <defs>
          <linearGradient id="ins-area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="ins-grid" />
            <text x={L - 8} y={y(t) + 4} textAnchor="end" className="ins-axis">{gbp(t, true)}</text>
          </g>
        ))}
        {points.map((p, i) => (i % every === 0 || i === points.length - 1) && (
          <text key={i} x={x(i)} y={H - 8} textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'} className="ins-axis">
            {p.label.replace(/^w\/c /, '')}
          </text>
        ))}
        <path d={area} fill="url(#ins-area)" className="ins-area" />
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" pathLength={1} className="ins-line" />
        {forecast.length > 0 && (
          <g className="ins-forecast">
            <line x1={x(last)} x2={x(last)} y1={T} y2={y(0)} className="ins-cross" />
            <text x={x(last) + 6} y={T + 10} className="ins-axis ins-ai-label">AI forecast</text>
            <path d={fBand} className="ins-ai-band" />
            <path d={fLine} fill="none" className="ins-ai-line" />
          </g>
        )}
        {hp && hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={T} y2={y(0)} className="ins-cross" />
            <circle cx={x(hover)} cy={y(hp.revenue)} r="5" fill={isForecast ? 'var(--ai)' : 'var(--accent)'} stroke="var(--surface)" strokeWidth="2" />
          </g>
        )}
      </svg>
      {hp && hover !== null && (
        <div className="ins-tip" style={{ left: `${(x(hover) / W) * 100}%`, top: `${(y(hp.revenue) / H) * 100}%` }}>
          <div className="muted small">{hp.label}</div>
          <strong className="num">{gbp(hp.revenue)}</strong>
          {isForecast && 'low' in hp && <div className="muted small num">Likely {gbp((hp as ForecastPoint).low, true)}–{gbp((hp as ForecastPoint).high, true)}</div>}
        </div>
      )}
    </div>
  );
}

export function Mix({ mix }: { mix: Data['mix'] }) {
  const total = mix.reduce((a, m) => a + m.value, 0);
  const [hover, setHover] = useState<string | null>(null);
  return (
    <div>
      <div className="ins-mix-total num">{gbp(total)}</div>
      <div className="ins-stack" role="img" aria-label={mix.map((m) => `${m.label} ${pct((m.value / total) * 100)}`).join(', ')}>
        {mix.map((m) => (
          <div
            key={m.key}
            className={`ins-seg${hover && hover !== m.key ? ' dim' : ''}`}
            style={{ flexGrow: m.value, background: SERIES[m.key] }}
            onPointerEnter={() => setHover(m.key)}
            onPointerLeave={() => setHover(null)}
            title={`${m.label}: ${gbp(m.value)}`}
          />
        ))}
      </div>
      <ul className="ins-legend">
        {mix.map((m) => (
          <li key={m.key} className={hover && hover !== m.key ? 'dim' : ''} onPointerEnter={() => setHover(m.key)} onPointerLeave={() => setHover(null)}>
            <span className="ins-dot" style={{ background: SERIES[m.key] }} aria-hidden="true" />
            <span>{m.label}</span>
            <span className="muted num">{gbp(m.value, true)}</span>
            <strong className="num">{pct((m.value / total) * 100)}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Bars({ rows, max, tone = 'tickets' }: { rows: { label: string; value: number; text: string }[]; max?: number; tone?: keyof typeof SERIES }) {
  const top = max ?? Math.max(...rows.map((r) => r.value));
  return (
    <ul className="ins-bars">
      {rows.map((r, i) => (
        <li key={r.label} title={`${r.label}: ${r.text}`}>
          <span className="ins-bar-label">{r.label}</span>
          <span className="ins-bar-track">
            <span className="ins-bar" style={{ width: `${(r.value / top) * 100}%`, background: SERIES[tone], transitionDelay: `${i * 50}ms` }} />
          </span>
          <span className="ins-bar-value num">{r.text}</span>
        </li>
      ))}
    </ul>
  );
}

export function Heatmap({ grid }: { grid: number[][] }) {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const slots = ['10am', '1pm', '4pm', '6pm', '8pm', '10pm'];
  const flat = grid.flat();
  const min = Math.min(...flat), max = Math.max(...flat);
  const [hover, setHover] = useState<{ d: number; s: number } | null>(null);
  const shade = (v: number) => RAMP[Math.min(RAMP.length - 1, Math.floor(((v - min) / (max - min || 1)) * (RAMP.length - 1) + 0.5))];
  return (
    <div className="ins-heat">
      <div className="ins-heat-grid" role="table" aria-label="Tickets by day and start time">
        <span />
        {slots.map((s) => (
          <span key={s} className="ins-axis-h">{s}</span>
        ))}
        {grid.map((row, d) => (
          <div key={d} role="row" style={{ display: 'contents' }}>
            <span className="ins-axis-h ins-axis-v" role="rowheader">{days[d]}</span>
            {row.map((v, s) => (
              <span
                key={s}
                role="cell"
                aria-label={`${days[d]} ${slots[s]}: ${num(v)} tickets`}
                className={`ins-cell${hover && (hover.d !== d || hover.s !== s) ? ' dim' : ''}`}
                style={{ background: shade(v), animationDelay: `${(d * 6 + s) * 12}ms` }}
                onPointerEnter={() => setHover({ d, s })}
                onPointerLeave={() => setHover(null)}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="ins-heat-foot">
        <span className="muted small">{hover ? `${days[hover.d]} ${slots[hover.s]} · ${num(grid[hover.d][hover.s])} tickets` : 'Hover a cell for the figure'}</span>
        <span className="ins-ramp" aria-hidden="true">
          <span className="muted small">Fewer</span>
          {RAMP.map((c) => (
            <i key={c} style={{ background: c }} />
          ))}
          <span className="muted small">More</span>
        </span>
      </div>
    </div>
  );
}

export function Funnel({ steps }: { steps: { label: string; value: number }[] }) {
  const top = steps[0].value;
  return (
    <ol className="ins-funnel">
      {steps.map((s, i) => (
        <li key={s.label}>
          <div className="ins-funnel-row">
            <span>{s.label}</span>
            <span className="num">
              <strong>{num(s.value, true)}</strong>
              {i > 0 && <span className="muted small"> · {pct((s.value / top) * 100)}</span>}
            </span>
          </div>
          <span className="ins-bar-track">
            <span className="ins-bar" style={{ width: `${(s.value / top) * 100}%`, background: SERIES.tickets, transitionDelay: `${i * 70}ms` }} />
          </span>
        </li>
      ))}
    </ol>
  );
}

export function RangePicker({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  return (
    <div className="segmented" role="radiogroup" aria-label="Time range">
      {RANGES.map((r) => (
        <button key={r.id} role="radio" aria-checked={value === r.id} className={value === r.id ? 'on' : ''} onClick={() => onChange(r.id)}>
          {r.label}
        </button>
      ))}
    </div>
  );
}

export interface AiInsight { kind: string; title: string; detail: string; impactMinor: number; confidence: number; action: string }

/** Sample recommendations, scaled to the range so the numbers feel consistent. */
export function aiInsightsFor(range: Range): AiInsight[] {
  const k = { '7d': 0.25, '30d': 1, '1y': 12, all: 36 }[range];
  return [
    { kind: 'Demand', title: 'Add a Saturday 8pm screening of Ember Protocol', detail: 'Forecast to sell out 3 days early at Leeds Riverside. A second screen would capture demand that is turned away today.', impactMinor: Math.round(240_000 * k), confidence: 91, action: 'Add screening' },
    { kind: 'Food', title: 'Promote the Sea salt caramel popcorn to Tidewater bookers', detail: '38% of Tidewater bookings already add popcorn. Showing the film special at checkout lifts attach rate by an estimated 6 points.', impactMinor: Math.round(110_000 * k), confidence: 84, action: 'Create promotion' },
    { kind: 'Pricing', title: 'Try £6.99 off-peak on Tuesday matinees', detail: 'Tuesday 1pm screenings average 22% occupancy. Similar cinemas fill 15% more seats with an off-peak price and lose little revenue.', impactMinor: Math.round(62_000 * k), confidence: 72, action: 'Set price' },
    { kind: 'Members', title: 'Win back 140 Plus members who have not booked in 30 days', detail: 'They are 3× more likely to cancel next month. A £2 off code by email typically brings a third of them back.', impactMinor: Math.round(48_000 * k), confidence: 78, action: 'Send offer' },
  ];
}

/** The "AI layer": headline impact, recommendations and a visible sample label. */
export function AiPanel({ insights }: { insights: AiInsight[] }) {
  const total = insights.reduce((a, i) => a + i.impactMinor, 0);
  const v = useTween(total);
  return (
    <section className="ai-panel" aria-label="AI insights (sample)">
      <div className="ai-panel-head">
        <div>
          <div className="ai-kicker"><span className="ai-spark" aria-hidden="true">✦</span> AI insights · sample</div>
          <div className="ai-total num">+{gbp(v)}</div>
          <div className="muted small">Estimated extra revenue if you act on these {insights.length} suggestions</div>
        </div>
      </div>
      <ul className="ai-list">
        {insights.map((i, n) => (
          <li key={i.title} className="ai-item" style={{ animationDelay: `${120 + n * 90}ms` }}>
            <div className="ai-item-top">
              <span className="ai-tag">{i.kind}</span>
              <span className="ai-impact num">+{gbp(i.impactMinor, true)}</span>
            </div>
            <h3 className="ai-title">{i.title}</h3>
            <p className="muted small">{i.detail}</p>
            <div className="ai-item-foot">
              <span className="ai-conf" aria-label={`${i.confidence}% confidence`}>
                <span className="ai-conf-bar"><span style={{ width: `${i.confidence}%` }} /></span>
                <span className="muted small">{i.confidence}% confidence</span>
              </span>
              <button className="btn btn-sm" type="button" disabled title="Preview only">{i.action}</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
