'use client';

import type { ResolvedTheme, SemanticTokens } from '@cinema/contracts';
import { SafeImage } from './SafeImage';

export interface PreviewFilm {
  id: string;
  title: string;
  certificate: string;
  posterUrl: string | null;
  focal: { x: number; y: number };
  dominantColor: string | null;
}

type SeatState = 'available' | 'selected' | 'sold' | 'premium' | 'accessible' | 'gap';

// A compact, fixed auditorium strip that exercises each seat state.
const SEAT_ROWS: { label: string; seats: SeatState[] }[] = [
  { label: 'A', seats: ['accessible', 'available', 'available', 'sold', 'sold', 'available', 'available', 'accessible'] },
  { label: 'B', seats: ['available', 'available', 'selected', 'selected', 'available', 'sold', 'available', 'available'] },
  { label: 'C', seats: ['sold', 'available', 'available', 'available', 'sold', 'sold', 'available', 'available'] },
  { label: 'D', seats: ['premium', 'premium', 'premium', 'gap', 'gap', 'premium', 'premium', 'premium'] },
];

function seatStyle(state: SeatState, t: SemanticTokens): React.CSSProperties {
  switch (state) {
    case 'available':
      return { background: t.seatAvailable, border: `1.5px solid ${t.seatAvailableBorder}` };
    case 'selected':
      return { background: t.seatSelected, border: `1.5px solid ${t.seatSelected}` };
    case 'sold':
      return { background: t.seatSold, border: `1.5px solid ${t.seatSold}` };
    case 'premium':
      return { background: 'transparent', border: `1.5px solid ${t.seatPremium}`, boxShadow: `inset 0 -3px 0 ${t.seatPremium}` };
    case 'accessible':
      return { background: t.seatAccessible, border: `1.5px solid ${t.seatAccessible}` };
    default:
      return { visibility: 'hidden' };
  }
}

export function PhonePreview({
  theme,
  appearance,
  wordmark,
  logoUrl,
  films,
  inactive,
}: {
  theme: ResolvedTheme;
  appearance: 'light' | 'dark';
  wordmark: string;
  logoUrl: string | null;
  films: PreviewFilm[];
  /** True when the appearance policy means customers never see this appearance. */
  inactive?: boolean;
}) {
  const t = theme[appearance];
  const r = theme.cornerRadius;
  const label = appearance === 'light' ? 'Light appearance' : 'Dark appearance';

  return (
    <figure className={`phone-wrap${inactive ? ' inactive' : ''}`}>
      <div
        className="phone"
        role="img"
        aria-label={`${label} preview of the customer app using the ${theme.name} theme`}
        style={{ background: t.background, color: t.textPrimary }}
      >
        <div className="phone-status" style={{ color: t.textPrimary }}>
          <span>9:41</span>
          <span className="phone-notch" style={{ background: '#000' }} />
          <span aria-hidden="true">●●● ▮</span>
        </div>

        <div className="phone-scroll">
          <div className="phone-header">
            <SafeImage
              src={logoUrl}
              alt=""
              className="phone-logo"
              fallback={
                <span className="phone-wordmark" style={{ color: t.textPrimary }}>
                  {wordmark || 'Wordmark'}
                </span>
              }
            />
            <span className="phone-avatar" style={{ background: t.surfaceElevated, color: t.textSecondary, borderColor: t.divider }}>
              AB
            </span>
          </div>

          <div className="phone-title" style={{ color: t.textPrimary }}>
            Now Showing
          </div>
          <div className="phone-subtitle" style={{ color: t.textSecondary }}>
            In cinemas now
          </div>

          <div className="phone-posters">
            {films.slice(0, 4).map((f) => (
              <div key={f.id} className="phone-poster">
                <div
                  className="phone-poster-img"
                  style={{ borderRadius: r.small, background: f.dominantColor ?? t.surfaceElevated }}
                >
                  <SafeImage src={f.posterUrl} alt="" style={{ objectPosition: `${f.focal.x * 100}% ${f.focal.y * 100}%` }} />
                </div>
                <div className="phone-poster-title" style={{ color: t.textPrimary }}>
                  {f.title}
                </div>
                <div className="phone-poster-meta" style={{ color: t.textMuted }}>
                  {f.certificate}
                </div>
              </div>
            ))}
            {films.length === 0 && (
              <div className="phone-poster">
                <div className="phone-poster-img" style={{ borderRadius: r.small, background: t.surfaceElevated }} />
              </div>
            )}
          </div>

          <div className="phone-card" style={{ background: t.surface, borderRadius: r.medium, borderColor: t.divider }}>
            <div className="phone-card-head">
              <span style={{ color: t.textPrimary, fontWeight: 600 }}>Choose seats</span>
              <span className="phone-chip" style={{ background: t.membership, color: t.membershipText }}>
                Members
              </span>
            </div>
            <div className="phone-screen" style={{ borderTopColor: t.screen }} />
            <div className="phone-screen-label" style={{ color: t.textMuted }}>
              Screen
            </div>
            <div className="phone-seats" aria-hidden="true">
              {SEAT_ROWS.map((row) => (
                <div key={row.label} className="phone-seat-row">
                  <span className="phone-row-label" style={{ color: t.textMuted }}>
                    {row.label}
                  </span>
                  {row.seats.map((s, i) => (
                    <span key={i} className="phone-seat" style={seatStyle(s, t)} />
                  ))}
                </div>
              ))}
            </div>
            <div className="phone-legend">
              {(
                [
                  ['available', 'Free'],
                  ['selected', 'Yours'],
                  ['sold', 'Taken'],
                  ['premium', 'Premium'],
                  ['accessible', 'Access'],
                ] as [SeatState, string][]
              ).map(([s, l]) => (
                <span key={s} style={{ color: t.textSecondary }}>
                  <span className="phone-seat tiny" style={seatStyle(s, t)} />
                  {l}
                </span>
              ))}
            </div>
          </div>

          <button
            type="button"
            tabIndex={-1}
            className="phone-button"
            style={{ background: t.actionPrimary, color: t.actionPrimaryText, borderRadius: r.medium }}
          >
            Book 2 tickets · £23.40
          </button>
        </div>

        <div className="phone-tabs" style={{ background: t.backgroundElevated, borderTopColor: t.divider }}>
          {['Home', 'Cinemas', 'Tickets', 'Account'].map((tab, i) => (
            <span key={tab} style={{ color: i === 0 ? t.selected : t.textMuted }}>
              <span className="phone-tab-dot" style={{ background: i === 0 ? t.selected : 'transparent', borderColor: i === 0 ? t.selected : t.textMuted }} />
              {tab}
            </span>
          ))}
        </div>
      </div>
      <figcaption className="phone-caption">
        {label}
        {inactive && <span className="badge badge-neutral">Not shown to customers</span>}
      </figcaption>
    </figure>
  );
}
