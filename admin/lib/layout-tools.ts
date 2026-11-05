import { AuditoriumLayout, buildRow, RowSeatSpec, Seat, SeatType, SEAT_TYPES } from '@cinema/contracts';

/** Row letters as the fixtures use them: I and O are skipped, as many UK cinemas do. */
export const ROW_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'.split('');

/** Canvas width in SVG units; mirrors backend/src/fixtures/write-layouts.ts toSvg. */
export const CANVAS_W = 1000;

/** Seat type colours used by the fixture previews (toSvg). Operator brand colours never apply here. */
export const SEAT_TYPE_COLOURS: Record<SeatType, string> = {
  standard: '#3A4660',
  premium: '#B8892E',
  recliner: '#6B4FA3',
  sofa: '#8E3B6B',
  luxePod: '#2F7D6B',
  vipBed: '#7A3E9D',
  wheelchair: '#2F6FD6',
  companion: '#1E9AA0',
};

export const SEAT_TYPE_LABELS: Record<SeatType, string> = {
  standard: 'Standard',
  premium: 'Premium',
  recliner: 'Recliner',
  sofa: 'Sofa',
  luxePod: 'Luxe pod',
  vipBed: 'VIP bed',
  wheelchair: 'Wheelchair space',
  companion: 'Companion',
};

export const ACCESS_LABELS: Record<Seat['accessibility'][number], string> = {
  wheelchair: 'Wheelchair',
  easyAccess: 'Easy access',
  transfer: 'Transfer seat',
  hearingLoop: 'Hearing loop',
};

export { SEAT_TYPES };

/** Price category ids that usually match a seat type, used to preselect the generator's category. */
export const TYPE_TO_CATEGORY: Partial<Record<SeatType, string>> = {
  standard: 'standard',
  premium: 'premium',
  recliner: 'recliner',
  sofa: 'sofa',
  luxePod: 'luxe-pod',
  vipBed: 'vip-bed',
};

export interface GeneratorSettings {
  rows: number;
  firstRow: string;
  seatsPerBlock: number;
  blocks: number;
  /** Aisle width between blocks, in seat widths. */
  aisleGap: number;
  seatSize: number;
  seatGap: number;
  rowSpacing: number;
  firstRowY: number;
  /** 0 = straight rows. Higher values bend rows more (arc radius = 1 / curvature). */
  curvature: number;
  stagger: boolean;
  type: SeatType;
  priceCategory: string;
}

export const DEFAULT_GENERATOR: GeneratorSettings = {
  rows: 8,
  firstRow: 'A',
  seatsPerBlock: 6,
  blocks: 2,
  aisleGap: 1,
  seatSize: 0.04,
  seatGap: 0.008,
  rowSpacing: 0.056,
  firstRowY: 0.2,
  curvature: 0,
  stagger: false,
  type: 'standard',
  priceCategory: 'standard',
};

/** Width of one generated row in layout units (before curving). */
export function generatedRowWidth(s: GeneratorSettings): number {
  const seats = s.seatsPerBlock * s.blocks;
  const aisles = Math.max(0, s.blocks - 1);
  const items = seats + aisles;
  return seats * s.seatSize + aisles * s.aisleGap * s.seatSize + Math.max(0, items - 1) * s.seatGap;
}

/** Replaces sections, rows and seats with a generated grid; keeps the screen and features. */
export function generateLayout(base: AuditoriumLayout, s: GeneratorSettings): AuditoriumLayout {
  const start = Math.max(0, ROW_LETTERS.indexOf(s.firstRow));
  const letters = ROW_LETTERS.slice(start, start + Math.max(1, Math.min(s.rows, ROW_LETTERS.length - start)));
  const arcCenter = s.curvature > 0 ? { x: 0.5, y: s.firstRowY - 1 / s.curvature } : undefined;
  const rows: AuditoriumLayout['rows'] = [];
  const seats: Seat[] = [];
  letters.forEach((rowId, r) => {
    rows.push({ id: rowId, sectionId: 'stalls', label: rowId, order: r });
    const specs: RowSeatSpec[] = [];
    let n = 1;
    for (let b = 0; b < s.blocks; b++) {
      for (let i = 0; i < s.seatsPerBlock; i++) specs.push({ label: String(n++) });
      if (b < s.blocks - 1) specs.push({ label: null, span: s.aisleGap });
    }
    seats.push(
      ...buildRow({
        rowId,
        sectionId: 'stalls',
        y: s.firstRowY + r * s.rowSpacing,
        seatSize: s.seatSize,
        gap: s.seatGap,
        arcCenter,
        stagger: s.stagger && r % 2 === 1 ? (s.seatSize + s.seatGap) / 2 : 0,
        seats: specs,
        defaultType: s.type,
        defaultPriceCategory: s.priceCategory,
      }),
    );
  });
  const out: AuditoriumLayout = { ...base, sections: [{ id: 'stalls', name: 'Stalls', order: 0 }], rows, seats };
  return fitCanvasHeight(out);
}

/** Sets the aspect ratio so the canvas ends a little below the last row. */
export function fitCanvasHeight(l: AuditoriumLayout, margin = 0.07): AuditoriumLayout {
  if (l.seats.length === 0) return l;
  const bottom = Math.max(...l.seats.map((s) => s.y + s.height / 2));
  const height = Math.max(bottom + margin, 0.3);
  return { ...l, aspectRatio: Math.round((1 / height) * 1000) / 1000 };
}

export function emptyLayout(id: string, name: string): AuditoriumLayout {
  return {
    id,
    version: 1,
    name,
    aspectRatio: 1.2,
    screen: { center: { x: 0.5, y: 0.08 }, width: 0.7, curvature: 0.05, edge: 'top', label: 'SCREEN' },
    sections: [{ id: 'stalls', name: 'Stalls', order: 0 }],
    rows: [],
    seats: [],
    features: [],
  };
}

export function mapSeats(l: AuditoriumLayout, ids: Set<string>, fn: (s: Seat) => Seat): AuditoriumLayout {
  return { ...l, seats: l.seats.map((s) => (ids.has(s.id) ? fn(s) : s)) };
}

/** Removes seats and any companion links that pointed at them. */
export function deleteSeats(l: AuditoriumLayout, ids: Set<string>): AuditoriumLayout {
  return {
    ...l,
    seats: l.seats.filter((s) => !ids.has(s.id)).map((s) => (s.companionFor.some((c) => ids.has(c)) ? { ...s, companionFor: s.companionFor.filter((c) => !ids.has(c)) } : s)),
  };
}

export function nudgeSeats(l: AuditoriumLayout, ids: Set<string>, dx: number, dy: number): AuditoriumLayout {
  const r = (n: number) => Math.round(n * 1e5) / 1e5;
  return mapSeats(l, ids, (s) => ({ ...s, x: r(s.x + dx), y: r(s.y + dy) }));
}

/** A group id not yet used in the layout, e.g. "H-pair2". */
export function freeGroupId(l: AuditoriumLayout, rowId: string, stem = 'pair'): string {
  const used = new Set(l.seats.map((s) => s.groupId).filter(Boolean));
  let n = 1;
  while (used.has(`${rowId}-${stem}${n}`)) n++;
  return `${rowId}-${stem}${n}`;
}
