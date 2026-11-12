'use client';

import { useMemo, useState } from 'react';
import { ErrorNote, Loading, PageHeader } from '@/components/ui';
import { SafeImage } from '@/components/SafeImage';
import { mediaUrl, PulseFood, PulseForecast, PulseForecasts, PulseStaffing, ShiftRow, tenantPath, VenueToday } from '@/lib/api';
import { ForecastSheet, paceTone, PulseBasisLine } from '@/components/pulse';
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
  const rota = useTenantData<ShiftRow[]>(site ? tenantPath(tenant, `/shifts?venueId=${site.id}&from=${date}T00:00:00Z&to=${date}T23:59:59Z`) : null);
  const onShift = rota.data ?? [];
  // Pulse: forecasts for this day (a window either side of midnight UTC, filtered to the local date),
  // staffing against the rota, and food to prepare.
  const dayStart = new Date(`${date}T00:00:00Z`).getTime();
  const fcPath = site ? tenantPath(tenant, `/pulse/forecasts?venueId=${site.id}&from=${new Date(dayStart - 3 * 3600_000).toISOString()}&to=${new Date(dayStart + 27 * 3600_000).toISOString()}`) : null;
  const pulse = useTenantData<PulseForecasts>(fcPath);
  const staffing = useTenantData<PulseStaffing>(site ? tenantPath(tenant, `/pulse/staffing?venueId=${site.id}&date=${date}`) : null);
  const food = useTenantData<PulseFood>(site ? tenantPath(tenant, `/pulse/food?venueId=${site.id}&date=${date}`) : null);
  const forecastFor = useMemo(() => new Map((pulse.data?.forecasts ?? []).filter((f) => f.localDate === date).map((f) => [f.screeningId, f])), [pulse.data, date]);
  // Films on today whose social talk is climbing: expect more walk-ups than the booking pace shows.
  const talk = useMemo(() => {
    const seen = new Map<string, number>();
    for (const f of forecastFor.values()) {
      const d = f.drivers.find((x) => x.label === 'People are talking');
      const m = d?.explanation.match(/climbing \(([\d.]+) times/);
      if (m) seen.set(f.film.title, Number(m[1]));
    }
    return [...seen.entries()].sort((a, b) => b[1] - a[1]);
  }, [forecastFor]);
  const [why, setWhy] = useState<PulseForecast | null>(null);
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

          <section className="card onshift" aria-labelledby="onshift-h">
            <div className="row between">
              <h2 id="onshift-h" className="h3">On shift</h2>
              <span className="muted small">{onShift.length ? `From ${onShift[0].source}` : 'Connect your rota in Connections to see who is working'}</span>
            </div>
            {onShift.length > 0 && (
              <ul className="onshift-list">
                {onShift.map((s) => (
                  <li key={s.id}>
                    <strong>{s.staffName}</strong>
                    <span className="muted small">{s.role}</span>
                    <span className="small num">{time(s.startsAt)}–{time(s.endsAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <header className="pulse-section-head">
            <h2 className="h3">Pulse forecast</h2>
            <PulseBasisLine basis={staffing.data?.basis ?? food.data?.basis} />
          </header>
          {talk.length > 0 && (
            <p className="today-talk small">
              <span className="pulse-mark" aria-hidden="true" />
              <span>
                People are talking more about {talk.map(([t, m]) => `${t} (${m.toFixed(1)}×)`).join(', ')} than last week on Bluesky. Expect extra walk-ups: staffing and food below already include it, so keep a till spare.
              </span>
            </p>
          )}
          <div className="today-pulse">
            <section className="card ins-card" aria-labelledby="staff-h">
              <header className="ins-head">
                <h2 id="staff-h" className="h3">Staffing</h2>
                <span className="muted small">{staffing.data ? `${staffing.data.expectedAdmissions} expected through the doors` : ''}</span>
              </header>
              {staffing.data ? (
                <>
                  <p className="small today-pulse-summary">
                    {staffing.data.rota.connected ? staffing.data.summary : 'Connect your rota in Connections to compare who is on with what the day needs. Until then this shows what the day needs.'}
                  </p>
                  {(() => {
                    const rows = staffing.data.windows.filter((w) => w.arrivals > 0 || w.short);
                    const on = staffing.data.rota.connected;
                    return (
                      <div className="table-wrap">
                        <table className="table staff-strip">
                          <thead>
                            <tr>
                              <th scope="row">From</th>
                              {rows.map((w) => (
                                <th key={w.from} scope="col" className={w.short ? 'short' : undefined} title={w.short ?? undefined}>
                                  {w.from}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              <th scope="row">Arriving</th>
                              {rows.map((w) => (
                                <td key={w.from} className={`num${w.short ? ' short' : ''}`}>{w.arrivals}</td>
                              ))}
                            </tr>
                            <tr>
                              <th scope="row">Tills{on ? ' needed / on' : ' needed'}</th>
                              {rows.map((w) => (
                                <td key={w.from} className={`num${w.short ? ' short' : ''}`}>
                                  {w.tillsNeeded}
                                  {on && <span className={w.tillsRostered < w.tillsNeeded ? 'warn' : 'muted'}> / {w.tillsRostered}</span>}
                                </td>
                              ))}
                            </tr>
                            <tr>
                              <th scope="row">Ushers{on ? ' needed / on' : ' needed'}</th>
                              {rows.map((w) => (
                                <td key={w.from} className={`num${w.short ? ' short' : ''}`}>
                                  {w.ushersNeeded}
                                  {on && <span className={w.ushersRostered < w.ushersNeeded ? 'warn' : 'muted'}> / {w.ushersRostered}</span>}
                                </td>
                              ))}
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    );
                  })()}
                  <p className="muted small">Half-hour windows; shaded ones are short. Most people arrive in the half hour before their film.</p>
                </>
              ) : (
                <ErrorNote message={staffing.error} />
              )}
            </section>

            <section className="card ins-card" aria-labelledby="food-h">
              <header className="ins-head">
                <h2 id="food-h" className="h3">Food to prepare</h2>
                <span className="muted small">{food.data ? `${food.data.shows.reduce((a, x) => a + x.expectedOrders, 0)} orders expected` : ''}</span>
              </header>
              {food.data ? (
                <>
                  <ul className="prep-totals">
                    {food.data.totals.slice(0, 8).map((t) => (
                      <li key={t.productId}>
                        <span>{t.name}</span>
                        <strong className="num">{t.quantity}</strong>
                      </li>
                    ))}
                  </ul>
                  <details className="prep-shows">
                    <summary className="small">By show</summary>
                    <ul>
                      {food.data.shows.map((x) => (
                        <li key={x.screeningId} className="small">
                          <strong className="num">{x.localTime}</strong> {x.film.title} <span className="muted">· {x.expectedOrders} orders</span>
                          <div className="muted">{x.items.slice(0, 4).map((i) => `${i.name} ${i.quantity}`).join(' · ')}</div>
                        </li>
                      ))}
                    </ul>
                  </details>
                </>
              ) : (
                <ErrorNote message={food.error} />
              )}
            </section>
          </div>

          {d.shows.length === 0 ? (
            <p className="muted">No shows at {site?.name} on this day.</p>
          ) : (
            <div className="board" aria-label="Shows by screen" style={{ '--cols': Math.min(4, Math.max(1, screens.length)) } as React.CSSProperties}>
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
                      const status = left <= 0 ? 'Sold out' : pct >= 85 ? 'Nearly full' : null;
                      return (
                        <li key={s.id} className={`card show-card${s.started ? ' is-past' : ''}`}>
                          <div className="show-poster" style={{ background: s.film.poster?.dominantColor ?? 'var(--surface-2)' }}>
                            <SafeImage src={mediaUrl(s.film.poster?.url, 240)} alt="" fallback={<span />} />
                          </div>
                          <div className="show-body">
                            <div className="show-head">
                              <strong className="show-time num">{time(s.startsAt)}</strong>
                              {s.started && <span className="badge badge-neutral">Started</span>}
                            </div>
                            <div className="show-film" title={s.film.title}>{s.film.title}</div>
                            <div className="muted small">{[s.film.certificate, ...s.formats].join(' · ')}</div>
                            {(status || s.foodOrders > 0) && (
                              <div className="row gap-1 show-badges">
                                {status && <span className={`badge ${left <= 0 ? 'badge-danger' : 'badge-warning'}`}>{status}</span>}
                                {s.foodOrders > 0 && <span className="badge badge-scope">{s.foodOrders} food</span>}
                              </div>
                            )}
                          </div>
                          <div className="show-sales">
                            <div className="meter" role="img" aria-label={`${s.sold} of ${s.capacity} seats sold`}>
                              <span style={{ width: `${pct}%` }} />
                              {s.held > 0 && <span className="meter-held" style={{ width: `${Math.round((s.held / s.capacity) * 100)}%` }} />}
                            </div>
                            <div className="show-foot small">
                              <span>
                                <strong className="num">{s.sold}</strong>
                                <span className="muted num">/{s.capacity} sold{s.held ? ` · ${s.held} booking` : ''}</span>
                              </span>
                              {forecastFor.get(s.id) && !s.started && (() => {
                                const f = forecastFor.get(s.id)!;
                                const tone = paceTone(f.paceIndex);
                                return (
                                  <button type="button" className={`show-pulse${tone ? ` ${tone}` : ''}`} onClick={() => setWhy(f)} aria-label={`Why Pulse expects ${f.expected}`}>
                                    Forecast <strong className="num">{f.expected}</strong>
                                    {tone && <span className="muted"> · {tone === 'fast' ? 'fast' : tone === 'slow' ? 'slow' : 'on pace'}</span>}
                                  </button>
                                );
                              })()}
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
      <ForecastSheet f={why} basis={pulse.data?.basis} onClose={() => setWhy(null)} />
    </>
  );
}
