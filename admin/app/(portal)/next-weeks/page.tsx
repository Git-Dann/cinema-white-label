'use client';

import { useMemo, useState } from 'react';
import { ErrorNote, Loading, PageHeader } from '@/components/ui';
import { num } from '@/components/insights';
import { TileHit } from '@/components/Sheet';
import { ConfidenceChip, ForecastBar, ForecastSheet, PaceChip, paceFallback, paceText, PulseBasisLine } from '@/components/pulse';
import { PulseForecast, PulseForecasts, tenantPath } from '@/lib/api';
import { useCinemaScope } from '@/lib/cinema-scope';
import { useSession, useTenantData } from '@/lib/session';
import { dayLabel, forecast, hoursNeeded, KIND_COLOUR, ROTA_HOURS, SLATE, START, STOCK, weekdayLabel } from '@/lib/slate';

/*
 * Next 6 weeks: the venue manager's view of what's coming. The programmed weeks are
 * forecast show by show by Pulse (docs/pulse.md); the weeks beyond the programme stay a
 * labelled sample plan for hours, big nights and orders.
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

const dayName = (ymd: string) => new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${ymd}T12:00:00Z`));

/** Show-by-show Pulse forecasts for the programmed days at one cinema. */
function ProgrammeForecast({ venueId }: { venueId: string }) {
  const { tenant } = useSession();
  const res = useTenantData<PulseForecasts>(tenantPath(tenant, `/pulse/forecasts?venueId=${venueId}`), [venueId]);
  const [day, setDay] = useState<string | null>(null);
  const [open, setOpen] = useState<PulseForecast | null>(null);
  const days = res.data?.daily.slice().sort((a, b) => a.date.localeCompare(b.date)) ?? [];
  const current = day && days.some((d) => d.date === day) ? day : days[0]?.date ?? null;
  const shows = (res.data?.forecasts ?? []).filter((f) => f.localDate === current);
  const total = days.reduce((a, d) => ({ expected: a.expected + d.expected, capacity: a.capacity + d.capacity, shows: a.shows + d.shows }), { expected: 0, capacity: 0, shows: 0 });
  const fast = (res.data?.forecasts ?? []).filter((f) => (f.paceIndex ?? 0) >= 1.3).length;
  const slow = (res.data?.forecasts ?? []).filter((f) => f.paceIndex != null && f.paceIndex <= 0.7).length;
  const today = days.find((d) => d.date === current);

  return (
    <section className="pulse-section" aria-labelledby="nw-pulse">
      <header className="pulse-section-head">
        <h2 id="nw-pulse" className="h3">Show by show, as programmed</h2>
        <PulseBasisLine basis={res.data?.basis} />
      </header>
      <ErrorNote message={res.error} />
      {res.loading && !res.data ? (
        <Loading />
      ) : days.length === 0 ? (
        <p className="muted">No shows are programmed here yet. Forecasts appear as soon as screenings are scheduled.</p>
      ) : (
        <>
          <div className="stat-grid nw-pulse-stats">
            <div className="stat-card">
              <div className="stat-label">Expected admissions</div>
              <div className="stat-value num">{num(total.expected)}</div>
              <div className="muted small">
                {total.shows} shows over {days.length} {days.length === 1 ? 'day' : 'days'} · {Math.round((total.expected / Math.max(1, total.capacity)) * 100)}% full
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Selling fast</div>
              <div className="stat-value num">{fast}</div>
              <div className="muted small">Shows well ahead of a usual show at this point</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Selling slowly</div>
              <div className="stat-value num">{slow}</div>
              <div className="muted small">Worth a nudge: an offer or an off-peak price</div>
            </div>
          </div>
          <div className="chips page-chips" role="group" aria-label="Day">
            {days.map((d) => (
              <button key={d.date} className={`chip${d.date === current ? ' selected' : ''}`} aria-pressed={d.date === current} onClick={() => setDay(d.date)}>
                {dayName(d.date)} <span className="muted num">· {num(d.expected)}</span>
              </button>
            ))}
          </div>
          {today && (
            <p className="muted small nw-day-line">
              {dayName(today.date)}: about <strong className="num">{num(today.expected)}</strong> of {num(today.capacity)} seats across {today.shows} shows, {num(today.soldNow)} sold so far.
            </p>
          )}
          <ul className="tile-grid nw-shows">
            {shows.map((f) => (
              <li key={f.screeningId} className="card tile tile-click nw-show">
                <TileHit label={`Why Pulse expects ${f.expected} for ${f.film.title} at ${f.localTime}`} onClick={() => setOpen(f)} />
                <div className="tile-head">
                  <div>
                    <div className="tile-title">
                      <span className="num">{f.localTime}</span> · {f.film.title}
                    </div>
                    <div className="muted small">
                      {f.screen.name} · {f.film.certificate}
                    </div>
                  </div>
                  <PaceChip pace={f.paceIndex} />
                </div>
                <ForecastBar f={f} />
                <div className="nw-show-foot small">
                  <span>
                    <strong className="num">{f.expected}</strong> expected <span className="muted num">({f.low} to {f.high})</span>
                  </span>
                  <span className="muted num">
                    {f.soldNow} sold · {f.capacity} seats
                  </span>
                </div>
                <div className="nw-show-foot small">
                  <ConfidenceChip level={f.confidence} />
                  <span className="muted">{paceText(f.paceIndex) ?? paceFallback(f.paceBasis)}</span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      <ForecastSheet f={open} basis={res.data?.basis} onClose={() => setOpen(null)} />
    </section>
  );
}

export default function NextWeeksPage() {
  const { venue, venues } = useCinemaScope();
  const site = venue?.name ?? venues[0]?.name ?? 'your cinema';
  const siteId = venue?.id ?? venues[0]?.id ?? null;
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
      <PageHeader title="Next 6 weeks" description={`${site} · every programmed show forecast by Pulse, then the weeks beyond`} />
      {siteId && <ProgrammeForecast venueId={siteId} />}

      <header className="pulse-section-head nw-later-head">
        <h2 className="h3">Weeks beyond the programme</h2>
        <span className="badge badge-sample">Sample plan</span>
      </header>
      <p className="muted small ya-note">
        Hours, big nights and orders from the release-slate sample, until shows are programmed and Pulse can forecast them. Pick a cinema in the sidebar to switch sites.
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
              <div key={o.title} className="nw-opening">
                <strong>
                  <span className="nw-dot" style={{ background: KIND_COLOUR[o.kind] }} aria-hidden="true" />
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
