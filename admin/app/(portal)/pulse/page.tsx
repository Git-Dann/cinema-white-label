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
  { key: 'venue', title: 'Your cinemas', noun: 'cinema', limit: 6 },
  { key: 'slot', title: 'Times of day', noun: 'time', limit: 6 },
  { key: 'dayOfWeek', title: 'Days of the week', noun: 'day', limit: 7 },
  { key: 'filmWeekBand', title: 'Weeks since release', noun: 'week', limit: 7 },
  { key: 'film', title: 'Films', noun: 'film', limit: 8 },
];

const sentence = (r: Row) => {
  const d = Math.round((r.multiplier - 1) * 100);
  if (Math.abs(d) < 3) return 'in line with the norm';
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
            <span className="pulse-adjust-label" title={`${r.label}: ${sentence(r)}, from ${r.shows.toLocaleString('en-GB')} shows`}>
              {r.label}
              <span className="muted small"> · {r.shows.toLocaleString('en-GB')}</span>
            </span>
            <span className="pulse-adjust-bar" aria-hidden="true">
              <i className={v >= 0 ? 'up' : 'down'} style={v >= 0 ? { left: '50%', width: `${v * 50}%` } : { right: '50%', width: `${-v * 50}%` }} />
            </span>
            <span className="pulse-adjust-value num">×{r.multiplier.toFixed(2)}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Films by Wikipedia page views, with the effect each has on its forecast. */
function AudienceInterest({ rows }: { rows: NonNullable<PulseModelView['interest']> }) {
  const shown = rows.slice(0, 12);
  const typical = shown[0]?.typical ?? 0;
  const demo = rows.some((r) => r.source === 'demo');
  const span = Math.max(0.25, ...shown.map((r) => Math.abs(Math.log(r.strength))));
  return (
    <section className="card ins-card pulse-section" aria-labelledby="pulse-interest">
      <header className="ins-head">
        <h2 id="pulse-interest" className="h3">Audience interest</h2>
        <span className="row gap-1 small">
          <span className="muted">
            Wikipedia page views in the month before release, against the typical film you show ({typical.toLocaleString('en-GB')})
          </span>
          {demo && <span className="badge badge-sample">Demo figures</span>}
        </span>
      </header>
      <ul className="pulse-adjust pulse-adjust-cols">
        {shown.map((r) => {
          const v = Math.log(r.strength) / span;
          return (
            <li key={r.filmId}>
              <span className="pulse-adjust-label" title={`${r.title}: ${r.views.toLocaleString('en-GB')} page views`}>
                {r.title}
                <span className="muted small"> · {r.views.toLocaleString('en-GB')}</span>
                {r.series && <span className="muted small"> · series</span>}
              </span>
              <span className="pulse-adjust-bar" aria-hidden="true">
                <i className={v >= 0 ? 'up' : 'down'} style={v >= 0 ? { left: '50%', width: `${v * 50}%` } : { right: '50%', width: `${-v * 50}%` }} />
              </span>
              <span className="pulse-adjust-value num">×{r.strength.toFixed(2)}</span>
            </li>
          );
        })}
      </ul>
      <p className="muted small pulse-foot-note">Each doubling of page views goes with about 1.4 times the opening audience, kept between ×0.60 and ×1.80. Source: Wikimedia Foundation, CC0.</p>
    </section>
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

  return (
    <>
      <PageHeader title="Pulse" description="How Seatfold forecasts every show, and what it has learned about your cinemas" actions={m && <PulseBasisLine basis={m.basis} />} />
      <ErrorNote message={res.error} />
      {res.loading && !m ? (
        <Loading />
      ) : m ? (
        <>
          <section className="card ins-card pulse-section" aria-labelledby="pulse-start">
            <header className="ins-head">
              <h2 id="pulse-start" className="h3">Starting point</h2>
              <span className="muted small">How full a typical UK screen is, before anything Pulse learns about you</span>
            </header>
            <ul className="pulse-slots">
              {Object.entries(m.priors.slotBase).map(([k, v]) => (
                <li key={k}>
                  <span className="stat-label">{m.curves.bySlot.find((c) => c.slot === k)?.label ?? k}</span>
                  <strong className="num">{Math.round(v * 100)}%</strong>
                </li>
              ))}
            </ul>
          </section>

          {m.interest && m.interest.length > 0 && <AudienceInterest rows={m.interest} />}

          <section className="pulse-section" aria-labelledby="pulse-learned">
            <header className="pulse-section-head">
              <h2 id="pulse-learned" className="h3">What Pulse has learned</h2>
              <span className="muted small">×1.00 is the norm for the same kind of show · number of shows learned from beside each name</span>
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
