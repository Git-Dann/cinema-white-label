'use client';

import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/ui';
import { num } from '@/components/insights';
import { useCinemaScope } from '@/lib/cinema-scope';
import { dayLabel, forecast, hoursNeeded, KIND_COLOUR, ROTA_HOURS, SLATE, START, STOCK, weekdayLabel } from '@/lib/slate';

/*
 * Next 6 weeks: the venue manager's slice of the Year ahead forecast. One
 * cinema, action-led: hours to add, big nights, orders to place. Sample data.
 */

const HORIZON = 6;
const SHIFT_HOURS = 6;
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400_000);

function plan() {
  return forecast()
    .slice(0, HORIZON)
    .map((w) => {
      const hours = hoursNeeded(w.admissions);
      const gap = hours - ROTA_HOURS;
      const openings = SLATE.filter((r) => r.week === w.week);
      return { ...w, perSite: Math.round(w.admissions / 4), hours, gap, shifts: gap > 0 ? Math.ceil(gap / SHIFT_HOURS) : 0, openings, change: (w.admissions - w.lastYear) / w.lastYear };
    });
}

function bigNight(kind: string) {
  if (kind === 'Family animation') return 'Matinees sell out first: open both tills from 10am Saturday and Sunday.';
  if (kind === 'Horror') return 'Late shows run full: keep the bar open until the last show starts.';
  return 'Expect sell-outs 6 to 9pm: open the second till and add an usher for the big screen.';
}

export default function NextWeeksPage() {
  const { venue, venues } = useCinemaScope();
  const site = venue?.name ?? venues[0]?.name ?? 'your cinema';
  const weeks = useMemo(plan, []);
  const extra = weeks.reduce((a, w) => a + Math.max(0, w.gap), 0);
  const orders = STOCK.filter((s) => s.due <= HORIZON * 7).sort((a, b) => a.due - b.due);
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState(false);

  async function copyForRota() {
    const lines = weeks.map((w) => `w/c ${dayLabel(w.date)}: ${w.hours} h needed (rota ${ROTA_HOURS} h)${w.shifts ? `, add ${w.shifts} × ${SHIFT_HOURS} h shifts` : ''}${w.openings.length ? `. Opening: ${w.openings.map((o) => o.title).join(', ')}` : ''}`);
    try {
      await navigator.clipboard.writeText(`${site}: staffing for the next ${HORIZON} weeks\n${lines.join('\n')}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Next 6 weeks"
        description={`${site} · staff, big nights and orders, week by week`}
        actions={<span className="badge badge-sample">Sample forecast</span>}
      />
      <p className="muted small ya-note">
        <span className="ai-spark">✦</span> Your cinema's share of the release-slate forecast. Pick a cinema in the sidebar to switch sites.
      </p>

      <section className="nw-summary card" aria-label="Summary">
        <div>
          <div className="stat-label">Extra hours over the standard rota</div>
          <div className="stat-value num">{num(extra)} h</div>
        </div>
        <div>
          <div className="stat-label">Big openings</div>
          <div className="stat-value num">{weeks.reduce((a, w) => a + w.openings.length, 0)}</div>
        </div>
        <div>
          <div className="stat-label">Orders to place</div>
          <div className="stat-value num">{orders.length}</div>
        </div>
        <div className="nw-copy">
          <button className="btn btn-primary btn-sm" onClick={copyForRota}>
            {copied ? 'Copied' : 'Copy for your rota tool'}
          </button>
          <span className="muted small">Paste into whichever rota app you use.</span>
        </div>
      </section>

      <ol className="nw-weeks">
        {weeks.map((w, i) => (
          <li key={w.week} className={`card nw-week${w.gap > 0 ? ' busy' : ''}`} style={{ animationDelay: `${i * 50}ms` }}>
            <header>
              <h2 className="h3">w/c {dayLabel(w.date)}</h2>
              <span className={`ins-delta ${w.change >= 0 ? 'up' : 'down'}`}>
                {w.change >= 0 ? '▲' : '▼'} {Math.abs(w.change * 100).toFixed(0)}% on last year
              </span>
            </header>
            <div className="nw-meter" role="img" aria-label={`${w.hours} hours needed against a ${ROTA_HOURS} hour rota`}>
              <span style={{ width: `${Math.min(100, (w.hours / (ROTA_HOURS * 1.6)) * 100)}%` }} />
              <i style={{ left: `${(1 / 1.6) * 100}%` }} title={`Rota ${ROTA_HOURS} h`} />
            </div>
            <p className="nw-hours">
              <strong>{w.hours} h</strong> needed · rota {ROTA_HOURS} h · about {num(w.perSite)} admissions
            </p>
            <p className={`nw-action${w.gap > 0 ? ' hot' : ''}`}>
              {w.gap > 0 ? `Add ${w.shifts} × ${SHIFT_HOURS} h shifts, mostly Friday to Sunday evenings.` : 'Standard rota covers it.'}
            </p>
            {w.openings.map((o) => (
              <div key={o.title} className="nw-opening" style={{ borderColor: KIND_COLOUR[o.kind] }}>
                <strong>
                  {weekdayLabel(addDays(w.date, 4))}: {o.title} opens
                </strong>
                <span className="muted small">{bigNight(o.kind)}</span>
              </div>
            ))}
          </li>
        ))}
      </ol>

      <section className="card ins-card" aria-labelledby="nw-orders">
        <header className="ins-head">
          <h2 id="nw-orders" className="h3">Orders to place</h2>
          <span className="muted small">Tick off as you go</span>
        </header>
        <ul className="nw-orders">
          {orders.map((o) => (
            <li key={o.item} className={done[o.item] ? 'done' : undefined}>
              <label className="check">
                <input type="checkbox" checked={!!done[o.item]} onChange={(e) => setDone({ ...done, [o.item]: e.target.checked })} />
                <span>
                  <strong>{o.item}</strong> <span className="ya-change up">{o.change}</span>
                  <span className="muted small"> · {o.why}</span>
                </span>
              </label>
              <span className="muted small nw-due">by {dayLabel(addDays(START, o.due))}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
