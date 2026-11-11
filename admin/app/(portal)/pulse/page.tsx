'use client';

import { ErrorNote, Loading, PageHeader } from '@/components/ui';
import { PulseBasisLine } from '@/components/pulse';
import { PulseModelView, tenantPath } from '@/lib/api';
import { useSession, useTenantData } from '@/lib/session';

/*
 * Pulse: what Seatfold's forecasting looks at and what it has learned about this operator,
 * in plain words. The maths is in docs/pulse.md; this page is for the people who use it.
 */

type Row = PulseModelView['multipliers']['venue'][number];

const GROUPS: { key: keyof PulseModelView['multipliers']; title: string; noun: string; limit: number }[] = [
  { key: 'venue', title: 'Your cinemas', noun: 'cinema', limit: 8 },
  { key: 'dayOfWeek', title: 'Days of the week', noun: 'day', limit: 7 },
  { key: 'slot', title: 'Times of day', noun: 'time', limit: 6 },
  { key: 'filmWeekBand', title: 'Weeks since release', noun: 'week', limit: 6 },
  { key: 'film', title: 'Films', noun: 'film', limit: 8 },
];

const sentence = (r: Row) => {
  const d = Math.round((r.multiplier - 1) * 100);
  if (Math.abs(d) < 3) return 'In line with the norm';
  return `${Math.abs(d)}% ${d > 0 ? 'above' : 'below'} the norm`;
};

/** Bars that grow left or right from "normal" (×1). */
function Adjustments({ rows }: { rows: Row[] }) {
  const span = Math.max(0.25, ...rows.map((r) => Math.abs(Math.log(r.multiplier))));
  return (
    <ul className="pulse-adjust">
      {rows.map((r) => {
        const v = Math.log(r.multiplier) / span;
        return (
          <li key={r.key}>
            <span className="pulse-adjust-label">{r.label}</span>
            <span className="pulse-adjust-bar" aria-hidden="true">
              <i className={v >= 0 ? 'up' : 'down'} style={v >= 0 ? { left: '50%', width: `${v * 50}%` } : { right: '50%', width: `${-v * 50}%` }} />
            </span>
            <span className="pulse-adjust-value num">×{r.multiplier.toFixed(2)}</span>
            <span className="muted small pulse-adjust-note">
              {sentence(r)} · {r.shows.toLocaleString('en-GB')} shows
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Share of a show's final sales sold by each point before it starts, one line per time of day. */
function BookingCurve({ curves }: { curves: PulseModelView['curves'] }) {
  const W = 1000;
  const H = 280;
  const pad = { l: 44, r: 16, t: 12, b: 30 };
  const hours = curves.hoursBefore;
  // Hours on a square-root scale so the last day before the show gets room.
  const x = (h: number) => pad.l + (1 - Math.sqrt(h) / Math.sqrt(hours[0])) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v) * (H - pad.t - pad.b);
  // Distinct by colour and by dash, so the lines read apart even where they run close.
  const tones = ['var(--accent)', 'var(--warning)', 'var(--danger)', 'var(--text-2)', 'var(--accent)'];
  const dashes = ['', '', '', '6 5', '2 4'];
  const ticks = [168, 72, 24, 6, 1, 0];
  const label = (h: number) => (h === 0 ? 'Start' : h >= 24 ? `${h / 24}d` : `${h}h`);
  return (
    <figure className="pulse-curve">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="How much of a show's audience has booked at each point before it starts">
        {[0, 0.25, 0.5, 0.75, 1].map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} className="pulse-grid" />
            <text x={pad.l - 8} y={y(v) + 4} textAnchor="end" className="pulse-axis">
              {v * 100}%
            </text>
          </g>
        ))}
        {ticks.map((h) => (
          <text key={h} x={x(h)} y={H - 8} textAnchor="middle" className="pulse-axis">
            {label(h)}
          </text>
        ))}
        {curves.bySlot.map((c, i) => (
          <polyline key={c.slot} fill="none" stroke={tones[i % tones.length]} strokeDasharray={dashes[i % dashes.length] || undefined} strokeWidth={2.2} strokeLinejoin="round" points={c.values.map((v, j) => `${x(hours[j])},${y(v)}`).join(' ')} />
        ))}
      </svg>
      <figcaption className="pulse-legend small">
        {curves.bySlot.map((c, i) => (
          <span key={c.slot}>
            <svg width="18" height="6" aria-hidden="true">
              <line x1="0" x2="18" y1="3" y2="3" stroke={tones[i % tones.length]} strokeWidth="2.5" strokeDasharray={dashes[i % dashes.length] || undefined} />
            </svg>
            {c.label}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

export default function PulsePage() {
  const { tenant } = useSession();
  const res = useTenantData<PulseModelView>(tenantPath(tenant, '/pulse/model'));
  const m = res.data;
  const demo = (m?.basis.demoShows ?? 0) > 0;
  const fri = m?.curves.bySlot.find((c) => c.slot === 'fri-sat-evening');
  const dayBefore = fri ? fri.values[m!.curves.hoursBefore.indexOf(24)] : null;

  return (
    <>
      <PageHeader title="Pulse" description="How Seatfold forecasts every show, and what it has learned about your cinemas" />
      <ErrorNote message={res.error} />
      {res.loading && !m ? (
        <Loading />
      ) : m ? (
        <>
          <PulseBasisLine basis={m.basis} className="pulse-page-basis" />
          {demo && (
            <p className="note small">
              This is demo history, made up to show how Pulse works. Once your own shows have played, Pulse learns from them instead and this notice goes away.
            </p>
          )}

          <section className="pulse-steps" aria-label="How Pulse works">
            <div className="card">
              <span className="pulse-step">1</span>
              <h2 className="h3">Starts from a normal show</h2>
              <p className="small muted">Every show begins from how full a typical UK screen is at that time, then allows for the film's week of release, its genre, the format and holidays.</p>
              <ul className="pulse-slots small">
                {Object.entries(m.priors.slotBase).map(([k, v]) => (
                  <li key={k}>
                    <span>{m.curves.bySlot.find((c) => c.slot === k)?.label ?? k}</span>
                    <strong className="num">{Math.round(v * 100)}%</strong>
                  </li>
                ))}
              </ul>
            </div>
            <div className="card">
              <span className="pulse-step">2</span>
              <h2 className="h3">Learns your cinemas</h2>
              <p className="small muted">
                It compares what really sold with what a normal show would sell, and learns where you run above or below. It only trusts a pattern once it has seen enough shows, so one odd night never swings it.
              </p>
            </div>
            <div className="card">
              <span className="pulse-step">3</span>
              <h2 className="h3">Watches sales come in</h2>
              <p className="small muted">
                As a show sells, Pulse compares it with how a show like it usually sells by that point, and trusts the live sales more the closer it gets.
                {dayBefore != null && ` A Friday or Saturday evening has usually sold ${Math.round(dayBefore * 100)}% of its seats by the day before.`}
              </p>
            </div>
          </section>

          <section className="pulse-section" aria-labelledby="pulse-learned">
            <header className="pulse-section-head">
              <h2 id="pulse-learned" className="h3">What Pulse has learned</h2>
              <span className="muted small">×1.00 is the UK norm for the same kind of show</span>
            </header>
            <div className="pulse-learned">
              {GROUPS.map((g) => {
                const rows = [...m.multipliers[g.key]].sort((a, b) => Math.abs(Math.log(b.multiplier)) - Math.abs(Math.log(a.multiplier))).slice(0, g.limit);
                if (g.key === 'dayOfWeek' || g.key === 'filmWeekBand' || g.key === 'slot') rows.sort((a, b) => a.key.localeCompare(b.key, 'en', { numeric: true }));
                return (
                  <section key={g.key} className={`card ins-card${g.key === 'film' ? ' pulse-learned-wide' : ''}`} aria-label={g.title}>
                    <header className="ins-head">
                      <h3 className="h3">{g.title}</h3>
                    </header>
                    {rows.length ? <Adjustments rows={rows} /> : <p className="muted small">Not enough shows yet to learn anything by {g.noun}.</p>}
                  </section>
                );
              })}
            </div>
          </section>

          <section className="pulse-section card ins-card" aria-labelledby="pulse-curve">
            <header className="ins-head">
              <h2 id="pulse-curve" className="h3">How shows sell in the run-up</h2>
              <span className="muted small">Share of the final audience booked by each point</span>
            </header>
            <BookingCurve curves={m.curves} />
          </section>
        </>
      ) : null}
    </>
  );
}
