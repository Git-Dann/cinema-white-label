'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useSession } from '@/lib/session';

/**
 * Which audience the portal is shown for. In real use the signed-in role decides
 * this; the "Preview as" switch lets a head office user show what a venue manager
 * or a member of floor staff would see. It only changes what is shown, never what
 * the API allows.
 */
export type ViewAs = 'head-office' | 'venue' | 'floor';

export const VIEW_LABELS: Record<ViewAs, string> = {
  'head-office': 'Head office',
  venue: 'Venue manager',
  floor: 'Floor staff',
};

/** Where each view starts. */
export const HOME: Record<ViewAs, string> = { 'head-office': '/', venue: '/today', floor: '/my-week' };

/** Views a real role may use: nobody previews a view above their own. */
export function viewsFor(role: string): ViewAs[] {
  if (role === 'VENUE_MANAGER') return ['venue', 'floor'];
  if (role === 'REPORTING') return ['head-office'];
  return ['head-office', 'venue', 'floor'];
}

interface ViewAsValue {
  view: ViewAs;
  views: ViewAs[];
  setView: (v: ViewAs) => void;
}

const Ctx = createContext<ViewAsValue | null>(null);

export function useViewAs(): ViewAsValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useViewAs must be used inside ViewAsProvider');
  return v;
}

const KEY = 'cinema.admin.viewAs';

export function ViewAsProvider({ children }: { children: React.ReactNode }) {
  const { me } = useSession();
  const views = useMemo(() => viewsFor(me.role), [me.role]);
  const [chosen, setChosen] = useState<ViewAs | null>(null);

  useEffect(() => {
    try {
      setChosen(localStorage.getItem(KEY) as ViewAs | null);
    } catch {
      setChosen(null);
    }
  }, []);

  const setView = useCallback((v: ViewAs) => {
    setChosen(v);
    try {
      localStorage.setItem(KEY, v);
    } catch {
      /* storage blocked: keep the choice for this visit only */
    }
  }, []);

  const view = chosen && views.includes(chosen) ? chosen : views[0];
  const value = useMemo(() => ({ view, views, setView }), [view, views, setView]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
