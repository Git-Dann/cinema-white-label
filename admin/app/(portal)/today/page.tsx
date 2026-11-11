'use client';

import { useMemo, useState } from 'react';
import { ErrorNote, Loading, PageHeader } from '@/components/ui';
import { SafeImage } from '@/components/SafeImage';
import { mediaUrl, tenantPath, VenueToday } from '@/lib/api';
import { useCinemaScope } from '@/lib/cinema-scope';
import { useSession, useTenantData } from '@/lib/session';

/*
 * Today: the venue manager's home. Every show at one cinema on a day, from live
 * bookings: seats sold against capacity, holds in progress, and food orders to prepare.
 */

const DAYS = 6;

function localDay(offset: number, timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(Date.now() + offset * 86400_000));
}

function dayLabel(iso: string, offset: number, timeZone: string) {
  if (offset === 0) return 'Today';
  if (offset === 1) return 'Tomorrow';
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`));
}

export default function TodayPage() {
  const { tenant } = useSession();
  const { venue, venues } = useCinemaScope();
  const site = venue ?? venues[0] ?? null;
  const tz = site?.timeZone ?? 'Europe/London';
  const [offset, setOffset] = useState(0);
  const date = localDay(offset, tz);
  const today = useTenantData<VenueToday>(site ? tenantPath(tenant, `/venues/${site.id}/today?date=${date}`) : null);
  const d = today.data;
  const time = (iso: string) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(iso));

  const next = useMemo(() => d?.shows.find((s) => !s.started) ?? null, [d]);
  // One column per screen, shows in time order: how a manager reads the day.
  const screens = useMemo(() => {
    const m = new Map<string, VenueToday['shows']>();
    for (const s of d?.shows ?? []) m.set(s.screen, [...(m.get(s.screen) ?? []), s]);
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b, 'en-GB', { numeric: true }));
  }, [d]);
  const busiest = useMemo(() => (d?.shows ?? []).reduce<VenueToday['shows'][number] | null>((a, s) => (!a || s.occupancy > a.occupancy ? s : a), null), [d]);

  return (
    <>
      <PageHeader title="Today" description={site ? `${site.name} · every show, from live bookings` : 'Pick a cinema in the sidebar'} />
      <div className="chips page-chips" role="group" aria-label="Day">
        {Array.from({ length: DAYS }, (_, i) => {
          const iso = localDay(i, tz);
          return (
            <button key={iso} aria-pressed={i === offset} className={`chip${i === offset ? ' selected' : ''}`} onClick={() => setOffset(i)}>
              {dayLabel(iso, i, tz)}
            </button>
          );
        })}
      </div>

      <ErrorNote message={today.error} />
      {today.loading && !d ? (
        <Loading />
      ) : d ? (
        <>
          <section className="stat-grid" aria-label="The day at a glance">
            <div className="stat-card">
              <div className="stat-label">Shows</div>
              <div className="stat-value num">{d.totals.shows}</div>
              <div className="muted small">{next ? `Next at ${time(next.startsAt)}, ${next.screen}` : offset === 0 ? 'All shows have started' : ''}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Seats sold</div>
              <div className="stat-value num">{d.totals.sold.toLocaleString('en-GB')}</div>
              <div className="muted small">of {d.totals.capacity.toLocaleString('en-GB')} · {d.totals.capacity ? Math.round((d.totals.sold / d.totals.capacity) * 100) : 0}% full</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Food orders to prepare</div>
              <div className="stat-value num">{d.totals.foodOrders}</div>
              <div className="muted small">Bookings with food and drink</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Busiest show</div>
              <div className="stat-value num">{busiest ? time(busiest.startsAt) : '–'}</div>
              <div className="muted small">{busiest ? `${busiest.film.title} · ${Math.round(busiest.occupancy * 100)}% full` : 'No shows'}</div>
            </div>
          </section>

          {d.shows.length === 0 ? (
            <p className="muted">No shows at {site?.name} on this day.</p>
          ) : (
            <div className="board" aria-label="Shows by screen">
              {screens.map(([screen, list]) => (
                <section key={screen} className="board-col" aria-label={screen}>
                  <h2 className="board-head">
                    {screen}
                    <span className="muted small"> · {list.length} show{list.length === 1 ? '' : 's'}</span>
                  </h2>
                  <ul className="board-list">
                    {list.map((s) => {
                      const pct = Math.round(s.occupancy * 100);
                      const left = s.capacity - s.sold - s.held;
                      const status = left <= 0 ? 'Sold out' : pct >= 70 ? 'Selling fast' : null;
                      return (
                        <li key={s.id} className={`card show-card${s.started ? ' is-past' : ''}`}>
                          <div className="show-poster" style={{ background: s.film.poster?.dominantColor ?? 'var(--surface-2)' }}>
                            <SafeImage src={mediaUrl(s.film.poster?.url, 160)} alt="" fallback={<span />} />
                          </div>
                          <div className="show-body">
                            <div className="show-head">
                              <strong className="show-time num">{time(s.startsAt)}</strong>
                              {status && <span className={`badge ${left <= 0 ? 'badge-danger' : 'badge-warning'}`}>{status}</span>}
                              {s.started && <span className="badge badge-neutral">Started</span>}
                            </div>
                            <div className="show-film" title={s.film.title}>{s.film.title} <span className="muted">· {s.film.certificate}</span></div>
                            {s.formats.length > 0 && <div className="muted small">{s.formats.join(' · ')}</div>}
                            <div className="meter" role="img" aria-label={`${s.sold} of ${s.capacity} seats sold`}>
                              <span style={{ width: `${pct}%` }} />
                              {s.held > 0 && <span className="meter-held" style={{ width: `${Math.round((s.held / s.capacity) * 100)}%` }} />}
                            </div>
                            <div className="show-foot small">
                              <span><strong className="num">{s.sold}</strong>/{s.capacity}{s.held ? ` · ${s.held} booking` : ''}</span>
                              {s.foodOrders > 0 && <span className="badge badge-scope">{s.foodOrders} food</span>}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </>
      ) : null}
    </>
  );
}
