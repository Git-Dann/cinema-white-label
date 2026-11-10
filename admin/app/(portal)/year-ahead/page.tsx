'use client';

import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/ui';
import { useSession } from '@/lib/session';
import { useViewAs } from '@/lib/view-as';
import { gbp, num, useTween } from '@/components/insights';
import { dayLabel, forecast, type Kind, hoursNeeded, KIND_COLOUR, monthLabel, ROTA_HOURS, SLATE, START, STOCK, WEEKS, weekDate } from '@/lib/slate';

/*
 * Year ahead: an AI-style plan built from the release slate. Every figure and
 * film here is sample data (fictional titles standing in for studio
 * tentpoles), labelled on the page. Nothing reads bookings or the API.
 */

export default function YearAheadPage() {
  const { tenantName } = useSession();
  const { view } = useViewAs();
  const weeks = useMemo(forecast, []);
  const total = weeks.reduce((a, w) => a + w.admissions, 0);
  const lastYear = weeks.reduce((a, w) => a + w.lastYear, 0);
  const peak = weeks.reduce((a, w) => (w.admissions > a.admissions ? w : a), weeks[0]);
  const revenue = total * 1180;
  const vTotal = useTween(total);
  const vRev = useTween(revenue);

  if (view !== 'head-office') {
    return (
      <>
        <PageHeader title="Year ahead" />
        <p className="muted">The year-ahead plan is for head office. Venue managers see their own cinema in Next 6 weeks.</p>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Year ahead"
        description={`${tenantName} · what the release slate means for staff, stock and marketing`}
        actions={<span className="badge badge-sample">Sample forecast</span>}
      />
      <p className="muted small ya-note">
        <span className="ai-spark">✦</span> AI forecast built from the year's release calendar, last year's trading and seasonality. Film titles are fictional stand-ins for studio releases.
      </p>

      <section className="stat-grid insights-kpis" aria-label="Headline forecast">
        <div className="stat-card ins-kpi">
          <div className="stat-label">Forecast admissions, 12 months</div>
          <div className="stat-value num">{num(vTotal)}</div>
          <div className="ins-delta up">▲ {(((total - lastYear) / lastYear) * 100).toFixed(1)}% on last year</div>
        </div>
        <div className="stat-card ins-kpi" style={{ animationDelay: '60ms' }}>
          <div className="stat-label">Forecast box office and food</div>
          <div className="stat-value num">{gbp(vRev, true)}</div>
          <div className="muted small">At £11.80 spend per head</div>
        </div>
        <div className="stat-card ins-kpi" style={{ animationDelay: '120ms' }}>
          <div className="stat-label">Busiest week</div>
          <div className="stat-value num">w/c {dayLabel(peak.date)}</div>
          <div className="muted small">{num(peak.admissions)} admissions</div>
        </div>
        <div className="stat-card ins-kpi" style={{ animationDelay: '180ms' }}>
          <div className="stat-label">Tentpole releases</div>
          <div className="stat-value num">{SLATE.filter((r) => r.pull >= 0.7).length}</div>
          <div className="muted small">of {SLATE.length} films tracked</div>
        </div>
      </section>

      <section className="card ins-card ya-card" aria-labelledby="ya-demand">
        <header className="ins-head">
          <h2 id="ya-demand" className="h3">Demand forecast</h2>
          <span className="ya-legend">
            <span><i className="ya-swatch fc" /> Forecast</span>
            <span><i className="ya-swatch ly" /> Last year</span>
          </span>
        </header>
        <DemandChart weeks={weeks} />
      </section>

      <div className="insights-grid">
        <section className="card ins-card" aria-labelledby="ya-staff">
          <header className="ins-head">
            <h2 id="ya-staff" className="h3">Staffing</h2>
            <span className="muted small">Floor and bar hours per week, per cinema</span>
          </header>
          <Staffing weeks={weeks} />
        </section>
        <section className="card ins-card" aria-labelledby="ya-stock">
          <header className="ins-head">
            <h2 id="ya-stock" className="h3">What to order, and when</h2>
          </header>
          <Stock />
        </section>
        <section className="card ins-card span-2" aria-labelledby="ya-mkt">
          <header className="ins-head">
            <h2 id="ya-mkt" className="h3">Marketing calendar</h2>
            <span className="muted small">Pre-sales open about 6 weeks before release</span>
          </header>
          <Marketing />
        </section>
      </div>
    </>
  );
}

function DemandChart({ weeks }: { weeks: ReturnType<typeof forecast> }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 1000, H = 310, L = 52, R = 12, T = 56, B = 28;
  const max = Math.max(...weeks.map((w) => Math.max(w.admissions, w.lastYear))) * 1.08;
  const top = Math.ceil(max / 5000) * 5000;
  const x = (i: number) => L + (i / (WEEKS - 1)) * (W - L - R);
  const y = (v: number) => T + (1 - v / top) * (H - T - B);
  const path = (k: 'admissions' | 'lastYear') => weeks.map((w, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(w[k]).toFixed(1)}`).join('');
  const area = `${path('admissions')}L${x(WEEKS - 1)},${y(0)}L${x(0)},${y(0)}Z`;
  const ticks = Array.from({ length: top / 5000 + 1 }, (_, i) => i * 5000);
  const months = weeks.filter((w, i) => i === 0 || w.date.getUTCMonth() !== weeks[i - 1].date.getUTCMonth());
  const hw = hover !== null ? weeks[hover] : null;
  // Release labels go in the first of three rows where they don't touch the previous label; near the
  // right edge they hang to the left of their marker.
  const labels = (() => {
    const ends = [-Infinity, -Infinity, -Infinity];
    return SLATE.map((r) => {
      const w = r.title.length * 6.4;
      const flip = x(r.week) + 4 + w > W - R;
      const start = flip ? x(r.week) - 4 - w : x(r.week) + 4;
      let row = ends.findIndex((e) => start > e + 10);
      if (row < 0) row = ends.indexOf(Math.min(...ends));
      ends[row] = start + w;
      return { flip, y: T - 10 - row * 14 };
    });
  })();
  const releasesThatWeek = hover !== null ? SLATE.filter((r) => r.week === hover) : [];

  function move(e: React.PointerEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.round((((e.clientX - r.left) / r.width) * W - L) / ((W - L - R) / (WEEKS - 1)));
    setHover(Math.max(0, Math.min(WEEKS - 1, i)));
  }

  return (
    <div className="ins-trend">
      <svg viewBox={`0 0 ${W} ${H}`} className="ins-svg" onPointerMove={move} onPointerLeave={() => setHover(null)} role="img" aria-label="Weekly admissions forecast for the next 12 months with release dates marked">
        <defs>
          <linearGradient id="ya-area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--ai)" stopOpacity="0.3" />
            <stop offset="100%" stopColor="var(--ai)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="ins-grid" />
            <text x={L - 8} y={y(t) + 4} textAnchor="end" className="ins-axis">{num(t, true)}</text>
          </g>
        ))}
        {months.map((m) => (
          <text key={m.week} x={x(m.week)} y={H - 8} textAnchor="start" className="ins-axis">{monthLabel(m.date)}</text>
        ))}
        <path d={path('lastYear')} fill="none" className="ya-ly" />
        <path d={area} fill="url(#ya-area)" className="ins-area" />
        <path d={path('admissions')} fill="none" stroke="var(--ai)" strokeWidth="2" strokeLinejoin="round" pathLength={1} className="ins-line" />
        {SLATE.map((r, i) => (
          <g key={r.title} className="ya-release" style={{ animationDelay: `${400 + i * 70}ms` }}>
            <line x1={x(r.week)} x2={x(r.week)} y1={y(weeks[r.week].admissions)} y2={labels[i].y + 4} stroke={KIND_COLOUR[r.kind]} strokeWidth="1" strokeDasharray="2 3" />
            <circle cx={x(r.week)} cy={y(weeks[r.week].admissions)} r={4 + r.pull * 3} fill={KIND_COLOUR[r.kind]} stroke="var(--surface)" strokeWidth="2" />
            <text x={labels[i].flip ? x(r.week) - 4 : x(r.week) + 4} y={labels[i].y} textAnchor={labels[i].flip ? 'end' : 'start'} className="ya-release-label">{r.title}</text>
          </g>
        ))}
        {hw && hover !== null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={y(0)} className="ins-cross" />}
      </svg>
      {hw && hover !== null && (
        <div className="ins-tip" style={{ left: `${(x(hover) / W) * 100}%`, top: `${(y(hw.admissions) / H) * 100}%` }}>
          <div className="muted small">w/c {dayLabel(hw.date)}</div>
          <strong className="num">{num(hw.admissions)} admissions</strong>
          <div className="muted small num">Last year {num(hw.lastYear)}</div>
          {releasesThatWeek.map((r) => (
            <div key={r.title} className="small">
              <i className="ya-swatch" style={{ background: KIND_COLOUR[r.kind] }} /> {r.title} opens
            </div>
          ))}
        </div>
      )}
      <ul className="ya-kinds" aria-label="Release types">
        {(Object.keys(KIND_COLOUR) as Kind[]).map((k) => (
          <li key={k}>
            <i className="ya-swatch" style={{ background: KIND_COLOUR[k] }} /> {k}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Staffing({ weeks }: { weeks: ReturnType<typeof forecast> }) {
  // Monthly average: hours needed vs today's standard rota (420 h/week per cinema).
  const ROTA = ROTA_HOURS;
  const byMonth = new Map<string, { label: string; total: number; n: number }>();
  for (const w of weeks) {
    const k = `${w.date.getUTCFullYear()}-${w.date.getUTCMonth()}`;
    const e = byMonth.get(k) ?? { label: monthLabel(w.date), total: 0, n: 0 };
    e.total += w.admissions;
    e.n++;
    byMonth.set(k, e);
  }
  const months = [...byMonth.values()].slice(0, 12).map((m) => ({ label: m.label, hours: hoursNeeded(m.total / m.n) }));
  const max = Math.max(...months.map((m) => m.hours), ROTA) * 1.1;
  const busiest = months.filter((m) => m.hours > ROTA * 1.15);
  return (
    <div>
      <div className="ya-bars" role="img" aria-label="Staff hours needed per month against the standard rota">
        {months.map((m, i) => (
          <div key={i} className="ya-bar-col" title={`${m.label}: ${m.hours} h/week`}>
            <span className={`ya-bar${m.hours > ROTA * 1.15 ? ' hot' : ''}`} style={{ height: `${(m.hours / max) * 100}%`, animationDelay: `${i * 40}ms` }} />
            <span className="ya-bar-label">{m.label}</span>
          </div>
        ))}
        <span className="ya-rota" style={{ bottom: `calc(${(ROTA / max) * 100}% * 0.86 + 22px)` }}>
          <span>Standard rota {ROTA} h</span>
        </span>
      </div>
      <ul className="ya-actions">
        {busiest.slice(0, 3).map((m) => (
          <li key={m.label}>
            <strong>{m.label}:</strong> about {m.hours - ROTA} extra hours a week per cinema. Recruit seasonal staff 6 weeks ahead.
          </li>
        ))}
      </ul>
    </div>
  );
}

function Stock() {
  const rows = STOCK;
  return (
    <ul className="ya-stock">
      {rows.map((r, i) => (
        <li key={r.item} style={{ animationDelay: `${i * 70}ms` }}>
          <div>
            <strong>{r.item}</strong>
            <div className="muted small">{r.why}</div>
          </div>
          <div className="ya-stock-right">
            <span className={`ya-change${r.change.startsWith('+') ? ' up' : ''}`}>{r.change}</span>
            <span className="muted small">{r.when}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Marketing() {
  const campaigns = SLATE.filter((r) => r.pull >= 0.4).map((r) => ({
    title: r.title,
    kind: r.kind,
    presale: Math.max(0, r.week - 6),
    release: r.week,
    action: r.kind === 'Family animation' ? 'Family ticket bundle + school holiday emails' : r.kind === 'Superhero' ? 'Pre-sales, IMAX upsell, collectable bucket' : r.kind === 'Horror' ? 'Late-night screenings, social teaser' : 'Pre-sales email to past bookers',
  }));
  const x = (w: number) => `${(w / WEEKS) * 100}%`;
  const months = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(START.getUTCFullYear(), START.getUTCMonth() + i, 1)));
  return (
    <div className="ya-gantt">
      <div className="ya-gantt-months">
        {months.map((m) => (
          <span key={m.toISOString()}>{monthLabel(m)}</span>
        ))}
      </div>
      {campaigns.map((c, i) => (
        <div key={c.title} className="ya-gantt-row">
          <div className="ya-gantt-name">
            <strong>{c.title}</strong>
            <span className="muted small">{c.action}</span>
          </div>
          <div className="ya-gantt-track">
            <span className="ya-gantt-bar" style={{ left: x(c.presale), width: x(c.release - c.presale + 2), background: KIND_COLOUR[c.kind], animationDelay: `${i * 60}ms` }} title={`Pre-sales from w/c ${dayLabel(weekDate(c.presale))}, release w/c ${dayLabel(weekDate(c.release))}`} />
            <span className="ya-gantt-release" style={{ left: x(c.release) }} />
          </div>
        </div>
      ))}
    </div>
  );
}
