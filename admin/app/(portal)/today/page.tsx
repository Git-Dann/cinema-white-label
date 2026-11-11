'use client';

import { useMemo, useState } from 'react';
import { ErrorNote, Loading, PageHeader } from '@/components/ui';
import { SafeImage } from '@/components/SafeImage';
import { mediaUrl, PulseFood, PulseForecast, PulseForecasts, PulseStaffing, ShiftRow, tenantPath, VenueToday } from '@/lib/api';
import { ForecastSheet, paceText, paceTone, PulseBasisLine } from '@/components/pulse';
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
                  <ol className="staff-grid" aria-label="Half-hour windows">
                    {staffing.data.windows.filter((w) => w.arrivals > 0 || w.short).map((w) => (
                      <li key={w.from} className={w.short ? 'short' : undefined} title={w.short ?? undefined}>
                        <span className="num staff-time">{w.from}</span>
                        <span className="small">
                          Tills <strong className="num">{w.tillsNeeded}</strong>
                          {staffing.data!.rota.connected && <span className="muted num">/{w.tillsRostered}</span>}
                        </span>
                        <span className="small">
                          Ushers <strong className="num">{w.ushersNeeded}</strong>
                          {staffing.data!.rota.connected && <span className="muted num">/{w.ushersRostered}</span>}
                        </span>
                        <span className="muted small num">{w.arrivals} arriving</span>
                      </li>
                    ))}
                  </ol>
                  <p className="muted small">Needed{staffing.data.rota.connected ? ' / on shift' : ''}. Most people arrive in the half hour before their film.</p>
                  <PulseBasisLine basis={staffing.data.basis} />
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
                  <PulseBasisLine basis={food.data.basis} />
                </>
              ) : (
                <ErrorNote message={food.error} />
              )}
            </section>
          </div>

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
                            {forecastFor.get(s.id) && !s.started && (() => {
                              const f = forecastFor.get(s.id)!;
                              const tone = paceTone(f.paceIndex);
                              return (
                                <button type="button" className={`show-pulse small${tone ? ` ${tone}` : ''}`} onClick={() => setWhy(f)} aria-label={`Why Pulse expects ${f.expected}`}>
                                  <span>
                                    Forecast <strong className="num">{f.expected}</strong>
                                  </span>
                                  <span className="muted">{paceText(f.paceIndex) ?? 'Sales not open yet'}</span>
                                </button>
                              );
                            })()}
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
