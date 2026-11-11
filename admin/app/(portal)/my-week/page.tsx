'use client';

import { PageHeader } from '@/components/ui';
import { tenantPath, VenueToday } from '@/lib/api';
import { useCinemaScope } from '@/lib/cinema-scope';
import { useSession, useTenantData } from '@/lib/session';
import { SLATE, START, weekDate, weekdayLabel } from '@/lib/slate';

/*
 * My week: what floor staff see. No forecasts or revenue: their shifts (sample; real
 * shifts come from the operator's rota tool), today's shows from live bookings, the
 * team briefing and what's coming. Laid out as cards, not one long list.
 */

const at = (day: number) => new Date(START.getTime() + day * 86400_000);

const SHIFTS = [
  { day: 2, time: '17:00 to 23:00', role: 'Concessions', note: null },
  { day: 4, time: '17:30 to 23:30', role: 'Screens 1 to 4, usher', note: 'Busy night: queues 6.30 to 7.30pm. Two tills open.' },
  { day: 5, time: '11:30 to 18:00', role: 'Box office and concessions', note: 'Family matinees: kids combos run low by 3pm, restock at the break.' },
  { day: 8, time: '17:00 to 22:00', role: 'Bar', note: null },
];

const BRIEFING = [
  'Screen 2 is 90% sold for the 8.10pm show on Friday.',
  'New large cup sizes arrive Thursday: same price as before.',
  'Accessible seats on Screen 3 need checking before the 6pm show.',
];

export default function MyWeekPage() {
  const { tenant } = useSession();
  const { venue, venues } = useCinemaScope();
  const site = venue ?? venues[0] ?? null;
  const tz = site?.timeZone ?? 'Europe/London';
  const today = useTenantData<VenueToday>(site ? tenantPath(tenant, `/venues/${site.id}/today`) : null);
  const shows = (today.data?.shows ?? []).filter((s) => !s.started).slice(0, 6);
  const time = (iso: string) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(iso));
  const next = SLATE.find((r) => r.week > 0 && r.pull >= 0.7);
  const opening = next ? new Date(weekDate(next.week).getTime() + 4 * 86400_000) : null;

  return (
    <>
      <PageHeader title="My week" description={`Sam · ${site?.name ?? 'your cinema'}`} actions={<span className="badge badge-sample">Sample shifts</span>} />

      <section aria-labelledby="mw-shifts">
        <h2 id="mw-shifts" className="h3 section-title">Your shifts</h2>
        <ul className="tile-grid">
          {SHIFTS.map((s) => (
            <li key={s.day} className={`card tile${s.note ? ' mw-busy' : ''}`}>
              <div className="tile-head">
                <div>
                  <div className="tile-title">{weekdayLabel(at(s.day))}</div>
                  <div className="muted small num">{s.time}</div>
                </div>
                {s.note && <span className="badge badge-warning">Busy</span>}
              </div>
              <div>{s.role}</div>
              {s.note && <p className="mw-note small">{s.note}</p>}
            </li>
          ))}
        </ul>
        <p className="muted small mw-foot">Shifts come from your rota app. Swap requests go through your manager.</p>
      </section>

      <div className="mw-cols">
        <section className="card" aria-labelledby="mw-today">
          <h2 id="mw-today" className="h3">Still to come today</h2>
          {shows.length === 0 ? (
            <p className="muted">No more shows today.</p>
          ) : (
            <ul className="mw-shows">
              {shows.map((s) => (
                <li key={s.id}>
                  <strong className="num">{time(s.startsAt)}</strong>
                  <span className="mw-show-film">{s.film.title}</span>
                  <span className="muted small">{s.screen}</span>
                  <span className="small num">{Math.round(s.occupancy * 100)}% full</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card" aria-labelledby="mw-brief">
          <h2 id="mw-brief" className="h3">Team briefing</h2>
          <ul className="mw-brief">
            {BRIEFING.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </section>

        {next && opening && (
          <section className="card" aria-labelledby="mw-coming">
            <h2 id="mw-coming" className="h3">Coming up</h2>
            <p>
              <strong>{next.title}</strong> opens {weekdayLabel(opening)}. It will be one of the busiest weekends of the year, so extra shifts will be offered first to people who ask.
            </p>
          </section>
        )}
      </div>
    </>
  );
}
