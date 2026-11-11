'use client';

import { useState } from 'react';
import { ErrorNote, Loading } from '@/components/ui';
import { Sheet, TileHit } from '@/components/Sheet';
import { PulseBasisLine } from '@/components/pulse';
import { PulsePriceSuggestion, PulsePricing, PulseScreens, tenantPath } from '@/lib/api';
import { useCinemaScope } from '@/lib/cinema-scope';
import { useSession, useTenantData } from '@/lib/session';

/*
 * Pulse suggestions an operator acts on by hand: price moves for single shows and screen
 * swaps. Nothing here changes anything by itself.
 */

const when = (ymd: string, time: string) => `${new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${ymd}T12:00:00Z`))}, ${time}`;
const actionText = (s: PulsePriceSuggestion) => (s.action === 'raise' ? `Raise ${s.percent}%` : `Off-peak, ${s.percent}% off`);
const SHOWN = 8;

export function PricingSuggestions() {
  const { tenant } = useSession();
  const scope = useCinemaScope();
  const res = useTenantData<PulsePricing>(tenantPath(tenant, '/pulse/pricing'));
  const [filter, setFilter] = useState<'all' | 'raise' | 'off-peak'>('all');
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<PulsePriceSuggestion | null>(null);
  const inScope = (res.data?.suggestions ?? []).filter((s) => scope.includes(s.venue.id));
  const list = inScope.filter((s) => filter === 'all' || s.action === filter);
  const shown = all ? list : list.slice(0, SHOWN);
  const count = (a: string) => inScope.filter((s) => s.action === a).length;

  return (
    <section className="pulse-section" aria-labelledby="pricing-sugg">
      <header className="pulse-section-head">
        <h2 id="pricing-sugg" className="h3">Pricing suggestions</h2>
        <PulseBasisLine basis={res.data?.basis} />
      </header>
      <p className="muted small pulse-intro">
        Pulse flags single shows where a different price should sell more or earn more. Nothing changes on its own: use these to set a price below or to create an offer.
        {res.data ? ` Raises stay within ${res.data.caps.maxRaisePercent}%, discounts within ${res.data.caps.maxDiscountPercent}%.` : ''}
      </p>
      <ErrorNote message={res.error} />
      {res.loading && !res.data ? (
        <Loading />
      ) : inScope.length === 0 ? (
        <p className="muted">No suggestions right now: every show is priced about right for how it is selling.</p>
      ) : (
        <>
          <div className="chips page-chips" role="group" aria-label="Show">
            {(
              [
                ['all', `All ${inScope.length}`],
                ['raise', `Raise ${count('raise')}`],
                ['off-peak', `Off-peak ${count('off-peak')}`],
              ] as const
            ).map(([k, label]) => (
              <button key={k} className={`chip${filter === k ? ' selected' : ''}`} aria-pressed={filter === k} onClick={() => setFilter(k)}>
                {label}
              </button>
            ))}
          </div>
          <ul className="tile-grid">
            {shown.map((s) => (
              <li key={s.screeningId} className="card tile tile-click">
                <TileHit label={`Why Pulse suggests ${actionText(s)} for ${s.film.title}`} onClick={() => setOpen(s)} />
                <div className="tile-head">
                  <div>
                    <div className="tile-title">{s.film.title}</div>
                    <div className="muted small">
                      {when(s.localDate, s.localTime)} · {s.screen.name}
                    </div>
                  </div>
                  <span className={`badge ${s.action === 'raise' ? 'badge-success' : 'badge-warning'}`}>{actionText(s)}</span>
                </div>
                <div className="meter" role="img" aria-label={`Forecast ${Math.round(s.forecast.occupancy * 100)}% full`}>
                  <span style={{ width: `${Math.min(100, s.forecast.occupancy * 100)}%` }} />
                </div>
                <div className="small">{s.reasons[0]}</div>
                <div className="muted small">
                  {s.venue.name} · forecast {s.forecast.expected} of {s.forecast.capacity}
                </div>
              </li>
            ))}
          </ul>
          {list.length > SHOWN && (
            <button className="btn btn-ghost btn-sm pulse-more" onClick={() => setAll(!all)}>
              {all ? 'Show fewer' : `Show all ${list.length}`}
            </button>
          )}
        </>
      )}
      <Sheet open={!!open} narrow title={open ? actionText(open) : 'Suggestion'} subtitle={open ? `${open.film.title} · ${when(open.localDate, open.localTime)} · ${open.screen.name}, ${open.venue.name}` : undefined} onClose={() => setOpen(null)}>
        {open && (
          <div className="pulse-why">
            <div className="pulse-why-head">
              <div>
                <div className="stat-label">Forecast</div>
                <div className="stat-value num">{open.forecast.expected}</div>
                <div className="muted small num">
                  of {open.forecast.capacity} seats · {Math.round(open.forecast.occupancy * 100)}% full
                </div>
              </div>
              <div>
                <div className="stat-label">Suggested</div>
                <div className="stat-value">{open.action === 'raise' ? `+${open.percent}%` : `−${open.percent}%`}</div>
                <div className="muted small">{open.action === 'raise' ? 'on this show only' : 'as an off-peak price'}</div>
              </div>
            </div>
            <ul className="pulse-reasons">
              {open.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            <p className="note small">Pulse never changes prices itself. Set this show's price in Ticket prices, or create an offer for it in Offers.</p>
            <PulseBasisLine basis={res.data?.basis} />
          </div>
        )}
      </Sheet>
    </section>
  );
}

export function ScreenSwaps() {
  const { tenant } = useSession();
  const scope = useCinemaScope();
  const res = useTenantData<PulseScreens>(tenantPath(tenant, '/pulse/screens'));
  const swaps = (res.data?.swaps ?? []).filter((s) => scope.includes(s.venue.id));

  return (
    <section className="pulse-section" aria-labelledby="swap-sugg">
      <header className="pulse-section-head">
        <h2 id="swap-sugg" className="h3">Screen swap suggestions</h2>
        <PulseBasisLine basis={res.data?.basis} />
      </header>
      <ErrorNote message={res.error} />
      {res.loading && !res.data ? (
        <Loading />
      ) : swaps.length === 0 ? (
        <div className="card pulse-empty">
          <strong>Every show fits its screen</strong>
          <span className="muted small">Pulse checks the next two weeks for a show forecast to sell out while a bigger screen nearby sits half empty. When it finds one, it appears here with the seats you would gain.</span>
        </div>
      ) : (
        <ul className="tile-grid wide">
          {swaps.map((s) => (
            <li key={`${s.from.screeningId}-${s.to.screeningId}`} className="card tile">
              <div className="tile-head">
                <div>
                  <div className="tile-title">
                    {when(s.localDate, s.localTime)} · {s.venue.name}
                  </div>
                </div>
                <span className="badge badge-success">+{s.extraAdmissions} seats sold</span>
              </div>
              <div className="pulse-swap">
                <div>
                  <span className="muted small">Move</span>
                  <strong>{s.from.filmTitle}</strong>
                  <span className="muted small num">
                    {s.from.screenName} · {s.from.capacity} seats · demand {s.from.demand}
                  </span>
                </div>
                <span className="pulse-swap-arrow" aria-hidden="true">⇄</span>
                <div>
                  <span className="muted small">with</span>
                  <strong>{s.to.filmTitle}</strong>
                  <span className="muted small num">
                    {s.to.screenName} · {s.to.capacity} seats · expects {s.to.expected}
                  </span>
                </div>
              </div>
              <div className="small">{s.reason}</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
