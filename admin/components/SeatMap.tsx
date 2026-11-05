'use client';

import { useRef } from 'react';
import type { AuditoriumLayout } from '@cinema/contracts';
import { CANVAS_W, SEAT_TYPE_COLOURS, SEAT_TYPE_LABELS } from '@/lib/layout-tools';

/*
 * SVG rendering of an auditorium layout. The maths mirrors toSvg in
 * backend/src/fixtures/write-layouts.ts so the editor matches the
 * shared/fixtures/layouts/*.preview.svg files exactly; selection and
 * validation highlights are drawn on top.
 */

const SCREEN_STROKE = '#C5CDDA';
const LABEL_FILL = '#8E9AB0';
const FEATURE_STROKE = '#1F2B42';
const FEATURE_TEXT = '#5B6577';
const CANVAS_BG = '#08080B';
const ISSUE = '#FF5C5C';
const SELECTED = '#FFFFFF';

export function SeatMap({
  layout,
  selected,
  issueSeatIds,
  onSeatClick,
  onBackgroundClick,
  drag,
}: {
  layout: AuditoriumLayout;
  selected?: Set<string>;
  issueSeatIds?: Set<string>;
  onSeatClick?: (id: string, additive: boolean) => void;
  onBackgroundClick?: () => void;
  /** Pointer dragging of seats. Deltas are in layout units (fractions of the canvas width), snapped to `snap` unless Alt is held. */
  drag?: { start: (id: string, additive: boolean) => void; move: (dx: number, dy: number) => void; end: () => void; snap: number };
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  // Active drag. Measured in screen pixels from the press point and converted with the
  // scale at that moment, so a page reflow mid-drag (the inspector opening) cannot make seats jump.
  const active = useRef<{ id: string; additive: boolean; cx: number; cy: number; perPx: number; ax: number; ay: number; started: boolean; pointer: number } | null>(null);
  const suppressClick = useRef(false);

  function onPointerDown(e: React.PointerEvent, id: string) {
    if (!drag || e.button !== 0) return;
    const m = svgRef.current?.getScreenCTM();
    if (!m || !m.a) return;
    active.current = { id, additive: e.shiftKey || e.metaKey || e.ctrlKey, cx: e.clientX, cy: e.clientY, perPx: 1 / (m.a * CANVAS_W), ax: 0, ay: 0, started: false, pointer: e.pointerId };
  }

  function onPointerMove(e: React.PointerEvent) {
    const a = active.current;
    if (!drag || !a || e.pointerId !== a.pointer) return;
    const px = e.clientX - a.cx;
    const py = e.clientY - a.cy;
    if (!a.started) {
      // About 4 pixels before a press becomes a drag, so clicks stay clicks.
      if (Math.hypot(px, py) < 4) return;
      a.started = true;
      svgRef.current?.setPointerCapture(e.pointerId);
      drag.start(a.id, a.additive);
    }
    let tx = px * a.perPx;
    let ty = py * a.perPx;
    if (!e.altKey && drag.snap > 0) {
      tx = Math.round(tx / drag.snap) * drag.snap;
      ty = Math.round(ty / drag.snap) * drag.snap;
    }
    const dx = tx - a.ax;
    const dy = ty - a.ay;
    if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return;
    a.ax = tx;
    a.ay = ty;
    drag.move(dx, dy);
  }

  function onPointerUp(e: React.PointerEvent) {
    const a = active.current;
    if (!a || e.pointerId !== a.pointer) return;
    if (a.started) {
      suppressClick.current = true;
      drag?.end();
      if (svgRef.current?.hasPointerCapture(e.pointerId)) svgRef.current.releasePointerCapture(e.pointerId);
    }
    active.current = null;
  }
  const W = CANVAS_W;
  const H = W / layout.aspectRatio;
  const s = layout.screen;
  const sx0 = (s.center.x - s.width / 2) * W;
  const sx1 = (s.center.x + s.width / 2) * W;
  const sy = s.center.y * W;
  const sag = s.curvature * s.width * W;

  const rowLabels: { id: string; x: number; y: number }[] = [];
  const seen = new Set<string>();
  for (const seat of layout.seats) {
    if (seen.has(seat.rowId)) continue;
    seen.add(seat.rowId);
    const rowSeats = layout.seats.filter((x) => x.rowId === seat.rowId);
    const left = rowSeats.reduce((a, b) => (a.x < b.x ? a : b));
    const label = layout.rows.find((r) => r.id === seat.rowId)?.label ?? seat.rowId;
    rowLabels.push({ id: label, x: left.x * W - left.width * W, y: left.y * W + 5 });
  }

  return (
    <svg
      ref={svgRef}
      className={drag ? 'seat-map draggable' : 'seat-map'}
      viewBox={`0 0 ${W} ${H}`}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      role="img"
      aria-label={`${layout.name}: ${layout.seats.length} seats in ${layout.rows.length} rows`}
      onClick={(e) => {
        if (suppressClick.current) {
          suppressClick.current = false;
          return;
        }
        if (e.target === e.currentTarget || (e.target as Element).getAttribute('data-bg') === '1') onBackgroundClick?.();
      }}
    >
      <rect width="100%" height="100%" fill={CANVAS_BG} data-bg="1" />
      <path d={`M ${sx0} ${sy} Q ${s.center.x * W} ${sy - sag * 2} ${sx1} ${sy}`} stroke={SCREEN_STROKE} strokeWidth={4} fill="none" pointerEvents="none" />
      <text x={s.center.x * W} y={sy + 24} fill={LABEL_FILL} fontFamily="sans-serif" fontSize={16} textAnchor="middle" letterSpacing={6} pointerEvents="none">
        {s.label}
      </text>
      {layout.features.map((f) => (
        <g key={f.id} pointerEvents="none">
          <rect x={f.x * W} y={f.y * W} width={f.width * W} height={f.height * W} fill="none" stroke={FEATURE_STROKE} strokeDasharray="4 3" />
          {f.label && (
            <text x={(f.x + f.width / 2) * W} y={(f.y + f.height / 2) * W + 4} fill={FEATURE_TEXT} fontSize={11} fontFamily="sans-serif" textAnchor="middle">
              {f.label}
            </text>
          )}
        </g>
      ))}
      {layout.seats.map((seat) => {
        const w = seat.width * W;
        const h = seat.height * W;
        const isSel = selected?.has(seat.id);
        const isIssue = issueSeatIds?.has(seat.id);
        return (
          <g
            key={seat.id}
            transform={`translate(${seat.x * W} ${seat.y * W}) rotate(${seat.rotation})`}
            className={onSeatClick ? 'seat clickable' : 'seat'}
            data-seat-id={seat.id}
            onPointerDown={drag ? (e) => onPointerDown(e, seat.id) : undefined}
            onClick={
              onSeatClick
                ? (e) => {
                    e.stopPropagation();
                    // The click that ends a drag is not a selection click.
                    if (suppressClick.current) {
                      suppressClick.current = false;
                      return;
                    }
                    onSeatClick(seat.id, e.shiftKey || e.metaKey || e.ctrlKey);
                  }
                : undefined
            }
          >
            <title>{`${seat.id}: ${SEAT_TYPE_LABELS[seat.type]}, ${seat.priceCategory}${seat.groupId ? `, group ${seat.groupId}` : ''}${seat.restrictedView ? `, ${seat.restrictedView}` : ''}`}</title>
            <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={h * 0.28} fill={SEAT_TYPE_COLOURS[seat.type]} stroke={isIssue ? ISSUE : 'none'} strokeWidth={isIssue ? 3 : 0} />
            {isSel && <rect x={-w / 2 - 4} y={-h / 2 - 4} width={w + 8} height={h + 8} rx={h * 0.28 + 3} fill="none" stroke={SELECTED} strokeWidth={2.5} pointerEvents="none" />}
            {seat.groupId && <line x1={-w / 2 + 4} x2={w / 2 - 4} y1={h / 2 - 3} y2={h / 2 - 3} stroke="#FFFFFF" strokeOpacity={0.55} strokeWidth={2} pointerEvents="none" />}
            <text y={4} fill="#fff" fontSize={Math.min(11, h * 0.4)} fontFamily="sans-serif" textAnchor="middle" pointerEvents="none">
              {seat.label}
            </text>
          </g>
        );
      })}
      {rowLabels.map((r) => (
        <text key={r.id} x={r.x} y={r.y} fill={LABEL_FILL} fontSize={13} fontFamily="sans-serif" textAnchor="end" pointerEvents="none">
          {r.id}
        </text>
      ))}
    </svg>
  );
}

export function SeatLegend({ layout }: { layout: AuditoriumLayout }) {
  const counts = new Map<string, number>();
  for (const s of layout.seats) counts.set(s.type, (counts.get(s.type) ?? 0) + 1);
  const types = Object.keys(SEAT_TYPE_COLOURS) as (keyof typeof SEAT_TYPE_COLOURS)[];
  return (
    <ul className="seat-legend" aria-label="Seat types">
      {types.map((t) => (
        <li key={t} className={counts.get(t) ? undefined : 'absent'}>
          <span className="legend-chip" style={{ background: SEAT_TYPE_COLOURS[t] }} aria-hidden="true" />
          {SEAT_TYPE_LABELS[t]}
          <span className="muted num">{counts.get(t) ?? 0}</span>
        </li>
      ))}
    </ul>
  );
}
