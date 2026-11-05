/**
 * Undo/redo history for editors. Pure functions so behaviour is easy to reason
 * about. Consecutive edits that share a `coalesce` key within `windowMs` (arrow-key
 * repeats, one pointer drag) merge into a single undo step.
 */
export interface History<T> {
  past: T[];
  present: T;
  future: T[];
  lastKey: string | null;
  lastAt: number;
}

export const HISTORY_LIMIT = 100;

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [], lastKey: null, lastAt: 0 };
}

export function record<T>(h: History<T>, next: T, opts: { coalesce?: string; now?: number; windowMs?: number } = {}): History<T> {
  if (next === h.present) return h;
  const now = opts.now ?? Date.now();
  const merge = !!opts.coalesce && opts.coalesce === h.lastKey && now - h.lastAt <= (opts.windowMs ?? 1000);
  const past = merge ? h.past : [...h.past, h.present].slice(-HISTORY_LIMIT);
  return { past, present: next, future: [], lastKey: opts.coalesce ?? null, lastAt: now };
}

export function undo<T>(h: History<T>): History<T> {
  if (!h.past.length) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future], lastKey: null, lastAt: 0 };
}

export function redo<T>(h: History<T>): History<T> {
  if (!h.future.length) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1), lastKey: null, lastAt: 0 };
}
