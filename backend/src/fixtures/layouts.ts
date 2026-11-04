import { AuditoriumLayout, buildRow, RowSeatSpec, Seat } from '@cinema/contracts';

/**
 * Fictional development auditoriums. They exercise straight rows, curved and
 * staggered rows, aisles, wheelchair spaces with companions, premium areas,
 * recliners and sofa (grouped) seats.
 */

const rowLetters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'.split(''); // I and O skipped, as many UK cinemas do

function labels(from: number, to: number): RowSeatSpec[] {
  const out: RowSeatSpec[] = [];
  for (let i = from; i <= to; i++) out.push({ label: String(i) });
  return out;
}

/** Screen 1: classic straight rows, central aisle, accessible front row, premium back rows. */
export function standardLayout(id: string): AuditoriumLayout {
  const aspect = 1.15;
  const seatSize = 0.042;
  const gap = 0.009;
  const rowPitch = 0.056;
  const firstRowY = 0.2;
  const seats: Seat[] = [];
  const rows: AuditoriumLayout['rows'] = [];

  const rowCount = 10;
  for (let r = 0; r < rowCount; r++) {
    const rowId = rowLetters[r];
    const premium = r >= rowCount - 2;
    const sectionId = premium ? 'premium' : 'stalls';
    rows.push({ id: rowId, sectionId, label: rowId, order: r });
    let specs: RowSeatSpec[];
    if (r === 0) {
      // Front row: wheelchair spaces at each end with companion seats beside them.
      specs = [
        { label: 'W1', type: 'wheelchair', accessibility: ['wheelchair'], span: 1.5, priceCategory: 'standard' },
        { label: '1', type: 'companion', companionFor: [`${rowId}-W1`], priceCategory: 'standard', restrictedView: 'Close to the screen' },
        ...labels(2, 6).map((s) => ({ ...s, restrictedView: 'Close to the screen' })),
        { label: null },
        ...labels(7, 11).map((s) => ({ ...s, restrictedView: 'Close to the screen' })),
        { label: '12', type: 'companion', companionFor: [`${rowId}-W2`], priceCategory: 'standard', restrictedView: 'Close to the screen' },
        { label: 'W2', type: 'wheelchair', accessibility: ['wheelchair'], span: 1.5, priceCategory: 'standard' },
      ];
    } else {
      specs = [...labels(1, 7), { label: null }, ...labels(8, 14)];
      if (r === 1) specs = specs.map((s) => (s.label === '1' || s.label === '14' ? { ...s, accessibility: ['easyAccess'] } : s));
    }
    seats.push(
      ...buildRow({
        rowId,
        sectionId,
        y: firstRowY + r * rowPitch + (premium ? 0.02 : 0),
        seatSize,
        gap,
        seats: specs,
        defaultType: premium ? 'premium' : 'standard',
        defaultPriceCategory: premium ? 'premium' : 'standard',
      }),
    );
  }

  const height = 1 / aspect;
  return {
    id,
    version: 1,
    name: 'Screen 1',
    aspectRatio: aspect,
    screen: { center: { x: 0.5, y: 0.075 }, width: 0.72, curvature: 0.06, edge: 'top', label: 'SCREEN' },
    sections: [
      { id: 'stalls', name: 'Stalls', order: 0 },
      { id: 'premium', name: 'Premium', order: 1 },
    ],
    rows,
    seats,
    features: [
      { id: 'aisle-centre', kind: 'aisle', label: null, x: 0.4935, y: 0.25, width: 0.013, height: 0.5 },
      { id: 'entrance', kind: 'entrance', label: 'Entrance', x: 0.03, y: height - 0.05, width: 0.12, height: 0.035 },
      { id: 'exit', kind: 'exit', label: 'Exit', x: 0.85, y: 0.12, width: 0.12, height: 0.035 },
    ],
  };
}

/** Screen 2: larger auditorium with curved, staggered rows and three seating blocks. */
export function curvedLayout(id: string): AuditoriumLayout {
  const aspect = 1.1;
  const seatSize = 0.034;
  const gap = 0.007;
  const rowPitch = 0.048;
  const arcCenter = { x: 0.5, y: -1.7 };
  const seats: Seat[] = [];
  const rows: AuditoriumLayout['rows'] = [];
  const rowCount = 13;

  for (let r = 0; r < rowCount; r++) {
    const rowId = rowLetters[r];
    const premium = r >= rowCount - 3;
    const sectionId = premium ? 'premium' : 'stalls';
    rows.push({ id: rowId, sectionId, label: rowId, order: r });
    const blockSide = r < 2 ? 3 : 4;
    const centre = r < 2 ? 8 : 10;
    let n = 1;
    const block = (count: number) => {
      const out: RowSeatSpec[] = [];
      for (let i = 0; i < count; i++) out.push({ label: String(n++) });
      return out;
    };
    const specs: RowSeatSpec[] = [...block(blockSide), { label: null }, ...block(centre), { label: null }, ...block(blockSide)];
    if (r === 6) {
      // Wheelchair positions on the cross-aisle row, with companions.
      specs.splice(0, 2, { label: 'W1', type: 'wheelchair', accessibility: ['wheelchair'], span: 1.5 }, { label: 'C1', type: 'companion', companionFor: [`${rowId}-W1`] });
      specs.splice(specs.length - 2, 2, { label: 'C2', type: 'companion', companionFor: [`${rowId}-W2`] }, { label: 'W2', type: 'wheelchair', accessibility: ['wheelchair'], span: 1.5 });
    }
    seats.push(
      ...buildRow({
        rowId,
        sectionId,
        y: 0.17 + r * rowPitch + (r >= 7 ? 0.03 : 0),
        seatSize,
        gap,
        arcCenter,
        stagger: r % 2 === 1 ? (seatSize + gap) / 2 : 0,
        seats: specs,
        defaultType: premium ? 'premium' : 'standard',
        defaultPriceCategory: premium ? 'premium' : 'standard',
      }),
    );
  }

  return {
    id,
    version: 1,
    name: 'Screen 2',
    aspectRatio: aspect,
    screen: { center: { x: 0.5, y: 0.085 }, width: 0.78, curvature: 0.05, edge: 'top', label: 'SCREEN' },
    sections: [
      { id: 'stalls', name: 'Stalls', order: 0 },
      { id: 'premium', name: 'Premium', order: 1 },
    ],
    rows,
    seats,
    features: [
      { id: 'entrance-l', kind: 'entrance', label: 'Entrance', x: 0.005, y: 0.17 + 7 * rowPitch + 0.0, width: 0.075, height: 0.03 },
      { id: 'entrance-r', kind: 'entrance', label: 'Entrance', x: 0.92, y: 0.17 + 7 * rowPitch + 0.0, width: 0.075, height: 0.03 },
    ],
  };
}

/** Screen 3: boutique auditorium with recliners and sofa seats sold in pairs. */
export function luxeLayout(id: string): AuditoriumLayout {
  const aspect = 1.35;
  const seatSize = 0.058;
  const gap = 0.014;
  const rowPitch = 0.105;
  const seats: Seat[] = [];
  const rows: AuditoriumLayout['rows'] = [];

  const plan: { recliners: number; sofa?: boolean }[] = [{ recliners: 8 }, { recliners: 8 }, { recliners: 8 }, { recliners: 8 }, { recliners: 0, sofa: true }];
  plan.forEach((p, r) => {
    const rowId = rowLetters[r];
    rows.push({ id: rowId, sectionId: 'luxe', label: rowId, order: r });
    let specs: RowSeatSpec[];
    if (p.sofa) {
      specs = [];
      for (let s = 1; s <= 4; s++) {
        const g = `${rowId}-sofa${s}`;
        specs.push({ label: String(s * 2 - 1), type: 'sofa', priceCategory: 'sofa', groupId: g, span: 1.15 });
        specs.push({ label: String(s * 2), type: 'sofa', priceCategory: 'sofa', groupId: g, span: 1.15 });
        if (s < 4) specs.push({ label: null, span: 0.35 });
      }
    } else {
      specs = [...labels(1, p.recliners / 2), { label: null }, ...labels(p.recliners / 2 + 1, p.recliners)];
      if (r === 0) specs = [{ label: 'W1', type: 'wheelchair', accessibility: ['wheelchair'], span: 1.2, priceCategory: 'recliner' }, ...specs.map((s) => (s.label === '1' ? { ...s, type: 'companion' as const, companionFor: [`${rowId}-W1`] } : s))];
    }
    seats.push(
      ...buildRow({ rowId, sectionId: 'luxe', y: 0.2 + r * rowPitch, seatSize, gap, seats: specs, defaultType: 'recliner', defaultPriceCategory: 'recliner' }),
    );
  });

  return {
    id,
    version: 1,
    name: 'Screen 3 · Luxe',
    aspectRatio: aspect,
    screen: { center: { x: 0.5, y: 0.075 }, width: 0.66, curvature: 0.04, edge: 'top', label: 'SCREEN' },
    sections: [{ id: 'luxe', name: 'Luxe', order: 0 }],
    rows,
    seats,
    features: [{ id: 'entrance', kind: 'entrance', label: 'Entrance', x: 0.86, y: 1 / aspect - 0.055, width: 0.12, height: 0.035 }],
  };
}
