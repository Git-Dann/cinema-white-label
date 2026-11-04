import { z } from 'zod';

/**
 * Auditorium layout geometry.
 *
 * Coordinate system: "layout units". The canvas is 1.0 wide and
 * 1 / aspectRatio tall. Every x, y, width and height is expressed in these
 * units (i.e. normalised to the canvas width) so aspect is preserved when the
 * renderer scales the layout to any device. Origin is top-left; y grows down.
 *
 * Geometry is physical and versioned. Live availability is a separate
 * concern (see availability endpoints) and never stored in a layout.
 */

/**
 * Structural seat kinds (how a seat is built and used). Commercial categories
 * (label, price, colours, icon) are configured separately per operator; see seating.ts.
 */
export const SEAT_TYPES = ['standard', 'premium', 'recliner', 'sofa', 'luxePod', 'vipBed', 'wheelchair', 'companion'] as const;
export const ACCESS_FEATURES = ['wheelchair', 'easyAccess', 'transfer', 'hearingLoop'] as const;
export const FEATURE_KINDS = ['aisle', 'walkway', 'entrance', 'exit', 'stairs', 'accessibleSpace', 'boundary', 'label'] as const;

const point = z.object({ x: z.number(), y: z.number() });

export const screenSchema = z.object({
  /** Centre of the screen. */
  center: point,
  width: z.number().positive(),
  /** Sagitta of the curve as a fraction of width. 0 = flat. */
  curvature: z.number().min(0).max(0.3),
  /** Which edge of the auditorium the screen is on, relative to the canvas. */
  edge: z.enum(['top', 'bottom', 'left', 'right']),
  label: z.string().default('SCREEN'),
});

export const seatSchema = z.object({
  id: z.string().min(1),
  rowId: z.string(),
  sectionId: z.string(),
  /** Customer-facing seat label within the row, e.g. "8". */
  label: z.string(),
  /** Explicit ordering within the row for accessible navigation. */
  order: z.number().int(),
  x: z.number(),
  y: z.number(),
  rotation: z.number().default(0),
  width: z.number().positive(),
  height: z.number().positive(),
  type: z.enum(SEAT_TYPES),
  priceCategory: z.string(),
  accessibility: z.array(z.enum(ACCESS_FEATURES)).default([]),
  /** Seats this companion seat is paired with (usually a wheelchair space). */
  companionFor: z.array(z.string()).default([]),
  /** Seats that must be sold together (sofas / couple seats). */
  groupId: z.string().nullable().default(null),
  restrictedView: z.string().nullable().default(null),
});

export const rowSchema = z.object({
  id: z.string(),
  sectionId: z.string(),
  label: z.string(),
  order: z.number().int(),
});

export const sectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  order: z.number().int(),
});

export const featureSchema = z.object({
  id: z.string(),
  kind: z.enum(FEATURE_KINDS),
  label: z.string().nullable().default(null),
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
});

export const auditoriumLayoutSchema = z.object({
  id: z.string(),
  version: z.number().int().positive(),
  name: z.string(),
  aspectRatio: z.number().positive(),
  screen: screenSchema,
  sections: z.array(sectionSchema),
  rows: z.array(rowSchema),
  seats: z.array(seatSchema),
  features: z.array(featureSchema).default([]),
});

export type AuditoriumLayout = z.infer<typeof auditoriumLayoutSchema>;
export type Seat = z.infer<typeof seatSchema>;
export type SeatType = (typeof SEAT_TYPES)[number];
export type LayoutFeature = z.infer<typeof featureSchema>;

export interface LayoutIssue {
  code: string;
  message: string;
  seatId?: string;
}

/** Structural and geometric validation run before a layout can be published. */
export function validateLayout(layout: AuditoriumLayout): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  const height = 1 / layout.aspectRatio;
  const sectionIds = new Set(layout.sections.map((s) => s.id));
  const rowIds = new Map(layout.rows.map((r) => [r.id, r]));
  const seatIds = new Set<string>();
  const labelsByRow = new Map<string, Set<string>>();

  if (layout.seats.length === 0) issues.push({ code: 'empty', message: 'Layout has no seats' });

  for (const r of layout.rows) {
    if (!sectionIds.has(r.sectionId)) issues.push({ code: 'row.section', message: `Row ${r.id} references unknown section ${r.sectionId}` });
  }

  for (const s of layout.seats) {
    if (seatIds.has(s.id)) issues.push({ code: 'seat.duplicateId', message: `Duplicate seat id ${s.id}`, seatId: s.id });
    seatIds.add(s.id);
    const row = rowIds.get(s.rowId);
    if (!row) issues.push({ code: 'seat.row', message: `Seat ${s.id} references unknown row ${s.rowId}`, seatId: s.id });
    if (!sectionIds.has(s.sectionId)) issues.push({ code: 'seat.section', message: `Seat ${s.id} references unknown section`, seatId: s.id });
    const labels = labelsByRow.get(s.rowId) ?? new Set();
    if (labels.has(s.label)) issues.push({ code: 'seat.duplicateLabel', message: `Row ${s.rowId} has duplicate seat label ${s.label}`, seatId: s.id });
    labels.add(s.label);
    labelsByRow.set(s.rowId, labels);
    const hw = s.width / 2;
    const hh = s.height / 2;
    if (s.x - hw < 0 || s.x + hw > 1 || s.y - hh < 0 || s.y + hh > height) {
      issues.push({ code: 'seat.bounds', message: `Seat ${s.id} lies outside the canvas`, seatId: s.id });
    }
  }

  for (const s of layout.seats) {
    for (const c of s.companionFor) {
      if (!seatIds.has(c)) issues.push({ code: 'seat.companion', message: `Seat ${s.id} is companion for unknown seat ${c}`, seatId: s.id });
    }
  }

  const groups = new Map<string, number>();
  for (const s of layout.seats) if (s.groupId) groups.set(s.groupId, (groups.get(s.groupId) ?? 0) + 1);
  for (const [g, n] of groups) if (n < 2) issues.push({ code: 'seat.group', message: `Seat group ${g} has only one seat` });

  // Overlap check using inscribed circles (rotation-safe, slightly lenient).
  const seats = layout.seats;
  for (let i = 0; i < seats.length; i++) {
    for (let j = i + 1; j < seats.length; j++) {
      const a = seats[i];
      const b = seats[j];
      const ra = Math.min(a.width, a.height) / 2;
      const rb = Math.min(b.width, b.height) / 2;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d < (ra + rb) * 0.9) {
        issues.push({ code: 'seat.overlap', message: `Seats ${a.id} and ${b.id} overlap`, seatId: a.id });
      }
    }
  }

  const sc = layout.screen;
  if (sc.center.x < 0 || sc.center.x > 1 || sc.center.y < 0 || sc.center.y > height) {
    issues.push({ code: 'screen.bounds', message: 'Screen lies outside the canvas' });
  }
  // The curved screen bows away from the audience; make sure the arc stays on the canvas.
  const sag = sc.curvature * sc.width;
  const arcOut =
    (sc.edge === 'top' && sc.center.y - sag < 0) ||
    (sc.edge === 'bottom' && sc.center.y + sag > height) ||
    (sc.edge === 'left' && sc.center.x - sag < 0) ||
    (sc.edge === 'right' && sc.center.x + sag > 1);
  if (arcOut) issues.push({ code: 'screen.arcBounds', message: 'Screen curve extends beyond the canvas' });
  return issues;
}

// ---------------------------------------------------------------------------
// Builders used by fixtures and the admin layout editor.
// ---------------------------------------------------------------------------

export interface RowSeatSpec {
  /** Seat label; null leaves a physical gap (e.g. aisle) without creating a seat. */
  label: string | null;
  type?: SeatType;
  priceCategory?: string;
  accessibility?: Seat['accessibility'];
  companionFor?: string[];
  groupId?: string | null;
  restrictedView?: string | null;
  /** Width multiplier, e.g. 1.6 for recliners or wheelchair spaces. */
  span?: number;
}

export interface RowBuildOptions {
  rowId: string;
  sectionId: string;
  y: number;
  seatSize: number;
  gap: number;
  centerX?: number;
  /** If set, seats follow an arc centred on this point (usually near the screen). */
  arcCenter?: { x: number; y: number };
  seats: RowSeatSpec[];
  defaultType?: SeatType;
  defaultPriceCategory?: string;
  /** Horizontal offset for staggered rows, in layout units. */
  stagger?: number;
}

export function buildRow(opts: RowBuildOptions): Seat[] {
  const centerX = (opts.centerX ?? 0.5) + (opts.stagger ?? 0);
  const widths = opts.seats.map((s) => opts.seatSize * (s.span ?? 1));
  const total = widths.reduce((a, b) => a + b, 0) + opts.gap * (opts.seats.length - 1);
  let cursor = centerX - total / 2;
  const out: Seat[] = [];
  let order = 0;
  opts.seats.forEach((spec, i) => {
    const w = widths[i];
    const cx = cursor + w / 2;
    cursor += w + opts.gap;
    if (spec.label === null) return;
    let x = cx;
    let y = opts.y;
    let rotation = 0;
    if (opts.arcCenter) {
      // Bend the straight row onto a circle through (centerX, y) centred on arcCenter.
      const r = Math.hypot(centerX - opts.arcCenter.x, opts.y - opts.arcCenter.y);
      const theta = (cx - centerX) / r;
      x = opts.arcCenter.x + r * Math.sin(theta);
      y = opts.arcCenter.y + r * Math.cos(theta);
      rotation = (-theta * 180) / Math.PI;
    }
    out.push({
      id: `${opts.rowId}-${spec.label}`,
      rowId: opts.rowId,
      sectionId: opts.sectionId,
      label: spec.label,
      order: order++,
      x: round(x),
      y: round(y),
      rotation: round(rotation),
      width: round(w),
      height: round(opts.seatSize),
      type: spec.type ?? opts.defaultType ?? 'standard',
      priceCategory: spec.priceCategory ?? opts.defaultPriceCategory ?? 'standard',
      accessibility: spec.accessibility ?? [],
      companionFor: spec.companionFor ?? [],
      groupId: spec.groupId ?? null,
      restrictedView: spec.restrictedView ?? null,
    });
  });
  return out;
}

function round(n: number): number {
  return Math.round(n * 1e5) / 1e5;
}
