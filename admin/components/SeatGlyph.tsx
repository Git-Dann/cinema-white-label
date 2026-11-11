/**
 * A drawn seat in a category's shape and colours, so categories read as different
 * seats at a glance (Standard vs Sofa vs VIP Bed). Uses the category's dark-mode
 * colours when it has custom ones, else the portal accent.
 */
const W: Record<string, number> = { seat: 48, recliner: 56, pod: 60, bed: 88, sofa: 88, space: 44 };

/** Premium touches drawn on top of the seat, from the category's app icon. */
function Badge({ icon, x, accent }: { icon: string; x: number; accent: string }) {
  if (icon.includes('star')) return <path transform={`translate(${x - 18} 0)`} d="M9 0l2.6 5.4 5.9.8-4.3 4.1 1 5.9L9 13.4 3.8 16.2l1-5.9L.5 6.2l5.9-.8z" fill={accent} />;
  if (icon.includes('sparkle')) return <path transform={`translate(${x - 18} 0)`} d="M9 0c.8 4.6 2.4 6.2 7 7-4.6.8-6.2 2.4-7 7-.8-4.6-2.4-6.2-7-7 4.6-.8 6.2-2.4 7-7z" fill={accent} />;
  return null;
}

export function SeatGlyph({ shape, colours, badge, size = 56 }: { shape: string; colours?: { fill: string; accent: string } | null; badge?: string | null; size?: number }) {
  const fill = colours?.fill ?? 'var(--seat-fill)';
  const accent = colours?.accent ?? 'var(--accent)';
  const w = W[shape] ?? 44;
  const common = { fill, stroke: accent, strokeWidth: 2, strokeLinejoin: 'round' as const };
  let body: React.ReactNode;
  switch (shape) {
    case 'recliner':
      body = (
        <>
          <path d="M6 8a5 5 0 0 1 5-5h14a5 5 0 0 1 5 5v18H6z" {...common} />
          <path d="M4 26h28l16 6v7a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z" {...common} />
          <path d="M8 42v3M44 42v3" stroke={accent} strokeWidth={2} strokeLinecap="round" />
        </>
      );
      break;
    case 'pod':
      body = (
        <>
          <path d="M4 44V16C4 9 10 3 17 3h22c7 0 13 6 13 13v28" {...common} />
          <path d="M12 22h32v14H12z" fill={accent} opacity={0.35} />
          <path d="M10 36h36v6H10z" {...common} />
        </>
      );
      break;
    case 'bed':
      body = (
        <>
          <path d="M4 10a6 6 0 0 1 6-6h64a6 6 0 0 1 6 6v8H4z" {...common} />
          <path d="M4 18h76v20a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z" {...common} />
          <rect x={12} y={21} width={24} height={8} rx={4} fill={accent} opacity={0.45} />
          <rect x={48} y={21} width={24} height={8} rx={4} fill={accent} opacity={0.45} />
        </>
      );
      break;
    case 'sofa':
      body = (
        <>
          <path d="M10 8a5 5 0 0 1 5-5h54a5 5 0 0 1 5 5v20H10z" {...common} />
          <path d="M42 6v20" stroke={accent} strokeWidth={1.5} opacity={0.6} />
          <path d="M4 22a4 4 0 0 1 8 0v6h60v-6a4 4 0 0 1 8 0v16a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z" {...common} />
          <path d="M10 42v3M74 42v3" stroke={accent} strokeWidth={2} strokeLinecap="round" />
        </>
      );
      break;
    case 'space':
      body = <rect x={4} y={4} width={36} height={38} rx={8} fill="none" stroke={accent} strokeWidth={2} strokeDasharray="5 4" />;
      break;
    default:
      body = (
        <>
          <path d="M8 8a5 5 0 0 1 5-5h18a5 5 0 0 1 5 5v18H8z" {...common} />
          <path d="M4 24a4 4 0 0 1 8 0v4h20v-4a4 4 0 0 1 8 0v14a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z" {...common} />
          <path d="M10 42v3M34 42v3" stroke={accent} strokeWidth={2} strokeLinecap="round" />
        </>
      );
  }
  return (
    <svg className="seat-glyph" viewBox={`0 0 ${w} 48`} width={(size * w) / 48} height={size} aria-hidden="true" focusable="false">
      {body}
      {badge && <Badge icon={badge} x={w} accent={accent} />}
    </svg>
  );
}
