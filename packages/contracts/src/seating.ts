import { z } from 'zod';
import { contrastRatio } from './color';
import { hexSchema, ResolvedTheme } from './theme';

/**
 * Operator-configurable seat categories and seat rules. Delivered with each
 * screening so the seat map's labels, icons, shapes, colours and rules change
 * without an app update.
 */

export const SEAT_SHAPES = ['seat', 'recliner', 'pod', 'bed', 'sofa', 'space'] as const;

/** SF Symbols the apps are allowed to render for seat categories. */
export const SEAT_ICONS = ['star.fill', 'crown.fill', 'sparkles', 'bed.double.fill', 'sofa.fill', 'chair.lounge.fill', 'figure.roll', 'person.2.fill', 'ear', 'leaf.fill'] as const;

const appearance = z.object({ fill: hexSchema, accent: hexSchema });

export const seatCategorySchema = z.object({
  /** Matches Seat.priceCategory. */
  id: z.string().regex(/^[a-z0-9-]+$/),
  label: z.string().min(1).max(30),
  description: z.string().max(140).nullable().default(null),
  shape: z.enum(SEAT_SHAPES),
  icon: z.enum(SEAT_ICONS).nullable().default(null),
  /** Null = use the theme's semantic seat tokens. */
  colours: z.object({ light: appearance, dark: appearance }).nullable().default(null),
  sortOrder: z.number().int().default(0),
});
export type SeatCategory = z.infer<typeof seatCategorySchema>;

export const seatRulesSchema = z.object({
  maxTickets: z.number().int().min(1).max(50),
  /** Single empty seats left between selections. */
  orphanSeatPolicy: z.enum(['allow', 'warn', 'block']),
  /**
   * Companion seats: 'none' = sold like any seat; 'warn' = explain;
   * 'requireWheelchair' = only with the paired wheelchair space in the same booking.
   */
  companionPolicy: z.enum(['none', 'warn', 'requireWheelchair']),
});
export type SeatRules = z.infer<typeof seatRulesSchema>;

export interface SeatCategoryIssue {
  categoryId: string;
  appearance: 'light' | 'dark';
  message: string;
}

/**
 * Category accents must remain distinguishable from the seat-map background
 * (WCAG 1.4.11, 3:1). Fills are decorative but must not be confused with the
 * selected state.
 */
export function validateSeatCategories(categories: SeatCategory[], theme: ResolvedTheme): SeatCategoryIssue[] {
  const issues: SeatCategoryIssue[] = [];
  const ids = new Set<string>();
  for (const c of categories) {
    if (ids.has(c.id)) issues.push({ categoryId: c.id, appearance: 'light', message: `Duplicate category ${c.id}` });
    ids.add(c.id);
    if (!c.colours) continue;
    for (const mode of ['light', 'dark'] as const) {
      const bg = theme[mode].background;
      const ratio = contrastRatio(c.colours[mode].accent, bg);
      if (ratio < 3) issues.push({ categoryId: c.id, appearance: mode, message: `${c.label} accent is ${ratio.toFixed(2)}:1 against the background, needs 3:1` });
      if (c.colours[mode].fill.toUpperCase() === theme[mode].seatSelected.toUpperCase()) {
        issues.push({ categoryId: c.id, appearance: mode, message: `${c.label} fill matches the selected-seat colour` });
      }
    }
  }
  return issues;
}

/** Default categories used by fixtures; operators override in the admin portal. */
export const DEFAULT_SEAT_CATEGORIES: SeatCategory[] = [
  { id: 'standard', label: 'Standard', description: null, shape: 'seat', icon: null, colours: null, sortOrder: 0 },
  { id: 'premium', label: 'Premium', description: 'Extra legroom, best view', shape: 'seat', icon: 'star.fill', colours: null, sortOrder: 1 },
  { id: 'recliner', label: 'Recliner', description: 'Fully reclining leather seat', shape: 'recliner', icon: 'chair.lounge.fill', colours: null, sortOrder: 2 },
  { id: 'sofa', label: 'Sofa', description: 'Two-seat sofa, sold as a pair', shape: 'sofa', icon: 'sofa.fill', colours: null, sortOrder: 3 },
  { id: 'luxe-pod', label: 'Luxe Pod', description: 'Private reclining pod with table service', shape: 'pod', icon: 'sparkles', colours: null, sortOrder: 4 },
  { id: 'vip-bed', label: 'VIP Bed', description: 'Double bed for two, sold as a pair', shape: 'bed', icon: 'bed.double.fill', colours: null, sortOrder: 5 },
];
