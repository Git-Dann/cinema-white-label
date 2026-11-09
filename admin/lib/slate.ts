/*
 * Sample release slate and demand forecast shared by the Year ahead, Next 6 weeks
 * and My week views. Fictional titles stand in for studio tentpoles; nothing here
 * reads bookings or the API.
 */

export type Kind = 'Superhero' | 'Family animation' | 'Action franchise' | 'Horror' | 'Awards drama' | 'Romcom';
export interface Release { title: string; studio: string; kind: Kind; week: number; pull: number }

export const START = new Date('2026-11-09T00:00:00Z');
export const WEEKS = 52;
export const weekDate = (w: number) => new Date(START.getTime() + w * 7 * 86400_000);
export const monthLabel = (d: Date) => d.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
export const dayLabel = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export const KIND_COLOUR: Record<Kind, string> = {
  Superhero: '#3987e5',
  'Family animation': '#d95926',
  'Action franchise': '#199e70',
  Horror: '#c98500',
  'Awards drama': '#9085e9',
  Romcom: '#d55181',
};

export const SLATE: Release[] = [
  { title: 'Starfall: Legacy', studio: 'Major studio A', kind: 'Superhero', week: 4, pull: 1.0 },
  { title: 'The Snow Lantern', studio: 'Major studio B', kind: 'Family animation', week: 6, pull: 0.8 },
  { title: 'Ironclad Run', studio: 'Major studio C', kind: 'Action franchise', week: 11, pull: 0.55 },
  { title: 'The Quiet Orchard', studio: 'Independent', kind: 'Awards drama', week: 14, pull: 0.3 },
  { title: 'Second Chances', studio: 'Major studio C', kind: 'Romcom', week: 14, pull: 0.35 },
  { title: 'Night Ward', studio: 'Genre label', kind: 'Horror', week: 20, pull: 0.4 },
  { title: 'Vanguard Assemble', studio: 'Major studio A', kind: 'Superhero', week: 25, pull: 1.15 },
  { title: 'Tidepool Friends 3', studio: 'Major studio B', kind: 'Family animation', week: 33, pull: 0.95 },
  { title: 'Overdrive 9', studio: 'Major studio C', kind: 'Action franchise', week: 36, pull: 0.7 },
  { title: 'The Hollow Lane', studio: 'Genre label', kind: 'Horror', week: 50, pull: 0.5 },
];

/** Weekly admissions forecast: seasonal base plus each release's opening and tail. */
export function forecast() {
  return Array.from({ length: WEEKS }, (_, w) => {
    const d = weekDate(w);
    const m = d.getUTCMonth();
    const season = [0.95, 0.8, 0.85, 1.0, 0.9, 0.95, 1.2, 1.25, 0.85, 0.9, 1.0, 1.15][m];
    const holiday = (m === 11 && d.getUTCDate() > 18) || (m === 7) ? 0.15 : 0;
    const lift = SLATE.reduce((a, r) => (w >= r.week ? a + r.pull * Math.exp(-(w - r.week) / (r.kind === 'Family animation' ? 3.5 : 2.2)) : a), 0);
    const base = 9200 * (season + holiday);
    return { week: w, date: d, admissions: Math.round(base * (1 + lift * 0.9)), lastYear: Math.round(base * (1 + 0.28 * Math.sin(w / 3.7)) * 0.93) };
  });
}

export const ROTA_HOURS = 420;
/** Floor and bar hours a cinema needs in a week, from that week's chain-wide admissions. */
export const hoursNeeded = (admissions: number) => Math.round(280 + (admissions / 4) * 0.06);
export const weekdayLabel = (d: Date) => d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

export interface StockRow { item: string; when: string; due: number; why: string; change: string }

/** Sample ordering plan; `due` is days from START. */
export const STOCK: StockRow[] = [
    { item: 'Popcorn kernels', due: 11, when: 'Order by 20 Nov', why: 'Starfall: Legacy and The Snow Lantern open within 2 weeks', change: '+45%' },
    { item: 'Collectable buckets (Starfall)', due: 4, when: 'Order by 13 Nov', why: 'Limited run, 8 week lead time from the supplier', change: '3,000 units' },
    { item: 'Kids combos and juice', due: 25, when: 'Order by 4 Dec', why: 'Family animation over the school holidays', change: '+60%' },
    { item: 'Cups and lids (large)', due: 18, when: 'Order by 27 Nov', why: 'Large size share rises on tentpole weekends', change: '+35%' },
    { item: 'Hot food', due: 999, when: 'Hold steady', why: 'No uplift forecast until summer', change: '0%' },
  ];
