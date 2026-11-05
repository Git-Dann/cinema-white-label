'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { tenantPath, Venue } from '@/lib/api';
import { useSession, useTenantData } from '@/lib/session';

/**
 * Which cinema the portal is focused on: one venue, or all of them (null).
 * Pages use it to filter lists and to default new items. It is remembered per
 * operator in this browser. Memberships and loyalty stay operator-wide.
 */
interface CinemaScope {
  venues: Venue[];
  venueId: string | null;
  venue: Venue | null;
  setVenueId: (id: string | null) => void;
  /** True when an item scoped to `itemVenueId` (null = every cinema) belongs in the current view. */
  includes: (itemVenueId: string | null | undefined) => boolean;
  /** "All cinemas" or the cinema's name, for an item's venue. */
  label: (itemVenueId: string | null | undefined) => string;
}

const Ctx = createContext<CinemaScope | null>(null);

export function useCinemaScope(): CinemaScope {
  const v = useContext(Ctx);
  if (!v) throw new Error('useCinemaScope must be used inside CinemaScopeProvider');
  return v;
}

export function CinemaScopeProvider({ children }: { children: React.ReactNode }) {
  const { tenant } = useSession();
  const venues = useTenantData<Venue[]>(tenantPath(tenant, '/venues'));
  const key = `cinema.admin.venue.${tenant}`;
  const [venueId, setState] = useState<string | null>(null);

  useEffect(() => {
    try {
      setState(localStorage.getItem(key));
    } catch {
      setState(null);
    }
  }, [key]);

  // Forget a cinema that no longer exists.
  useEffect(() => {
    if (venueId && venues.data && !venues.data.some((v) => v.id === venueId)) setState(null);
  }, [venueId, venues.data]);

  const setVenueId = useCallback(
    (id: string | null) => {
      setState(id);
      try {
        if (id) localStorage.setItem(key, id);
        else localStorage.removeItem(key);
      } catch {
        /* storage blocked: keep the choice for this visit only */
      }
    },
    [key],
  );

  const value = useMemo<CinemaScope>(() => {
    const list = venues.data ?? [];
    return {
      venues: list,
      venueId,
      venue: list.find((v) => v.id === venueId) ?? null,
      setVenueId,
      includes: (item) => !venueId || !item || item === venueId,
      label: (item) => (item ? list.find((v) => v.id === item)?.name ?? 'One cinema' : 'All cinemas'),
    };
  }, [venues.data, venueId, setVenueId]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Small note under a page header saying which cinema the page shows. */
export function ScopeNote({ what }: { what: string }) {
  const { venue, setVenueId } = useCinemaScope();
  if (!venue) return null;
  return (
    <p className="scope-note">
      Showing {what} for <strong>{venue.name}</strong>, plus anything that applies to all cinemas.{' '}
      <button type="button" className="link-btn" onClick={() => setVenueId(null)}>
        Show all cinemas
      </button>
    </p>
  );
}
