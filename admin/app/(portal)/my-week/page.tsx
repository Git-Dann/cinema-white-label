'use client';

import { PageHeader } from '@/components/ui';
import { useCinemaScope } from '@/lib/cinema-scope';
import { SLATE, START, weekDate, weekdayLabel } from '@/lib/slate';

/*
 * My week: what floor staff see. No forecasts or revenue, just their shifts,
 * a heads-up on busy nights and what's coming. Sample data; real shifts would
 * come from the operator's rota tool.
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
  const { venue, venues } = useCinemaScope();
  const site = venue?.name ?? venues[0]?.name ?? 'your cinema';
  const next = SLATE.find((r) => r.week > 0 && r.pull >= 0.7);
  const opening = next ? new Date(weekDate(next.week).getTime() + 4 * 86400_000) : null;

  return (
    <>
      <PageHeader title="My week" description={`Sam · ${site}`} actions={<span className="badge badge-sample">Sample</span>} />
      <div className="mw">
        <section className="card mw-card" aria-labelledby="mw-shifts">
          <h2 id="mw-shifts" className="h3">Your shifts</h2>
          <ul className="mw-shifts">
            {SHIFTS.map((s) => (
              <li key={s.day} className={s.note ? 'busy' : undefined}>
                <div className="mw-when">
                  <strong>{weekdayLabel(at(s.day))}</strong>
                  <span>{s.time}</span>
                </div>
                <div className="mw-role">{s.role}</div>
                {s.note && <div className="mw-note">🔥 {s.note}</div>}
              </li>
            ))}
          </ul>
          <p className="muted small">Shifts come from your rota app. Swap requests go through your manager.</p>
        </section>

        <section className="card mw-card" aria-labelledby="mw-brief">
          <h2 id="mw-brief" className="h3">Team briefing</h2>
          <ul className="mw-brief">
            {BRIEFING.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </section>

        {next && opening && (
          <section className="card mw-card mw-coming" aria-labelledby="mw-coming">
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
