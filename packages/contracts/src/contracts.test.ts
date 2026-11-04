import { describe, expect, it } from 'vitest';
import {
  buildRow,
  contrastRatio,
  resolveTheme,
  THEME_IDS,
  validateLayout,
  validateThemeContrast,
  AuditoriumLayout,
} from './index';

describe('contrastRatio', () => {
  it('matches WCAG reference values', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
    // #767676 on white is the canonical 4.54:1 grey.
    expect(contrastRatio('#767676', '#FFFFFF')).toBeCloseTo(4.54, 2);
  });

  it('composites translucent colours before measuring', () => {
    expect(contrastRatio('#FFFFFF80', '#000000')).toBeLessThan(contrastRatio('#FFFFFF', '#000000'));
  });
});

describe('theme resolution', () => {
  const palettes = [
    { id: 'p1', name: 'Northlight teal', accent: { light: '#0F766E', dark: '#2DD4BF' }, secondary: { light: '#9A6700', dark: '#F5C451' } },
    { id: 'p2', name: 'Palace red', accent: { light: '#B0102A', dark: '#FF4D5E' }, secondary: { light: '#8A6A12', dark: '#D4AF37' } },
    { id: 'p3', name: 'Electric blue', accent: { light: '#1D4ED8', dark: '#60A5FA' }, secondary: { light: '#6D28D9', dark: '#A78BFA' } },
  ];

  for (const themeId of THEME_IDS) {
    for (const palette of palettes) {
      it(`${themeId} + ${palette.name} passes WCAG AA`, () => {
        const theme = resolveTheme(themeId, palette);
        expect(validateThemeContrast(theme)).toEqual([]);
      });
    }
  }

  it('flags an unreadable palette on a light theme', () => {
    const theme = resolveTheme('light', { id: 'bad', name: 'Pale yellow', accent: { light: '#FFF59D', dark: '#FFF59D' }, secondary: { light: '#FFFDE7', dark: '#FFFDE7' } });
    const issues = validateThemeContrast(theme);
    expect(issues.some((i) => i.fg === 'seatSelected')).toBe(true);
  });

  it('keeps brand identity independent from theme', () => {
    const a = resolveTheme('midnight', palettes[0]);
    const b = resolveTheme('midnight', palettes[1]);
    expect(a.dark.background).toEqual(b.dark.background);
    expect(a.dark.actionPrimary).not.toEqual(b.dark.actionPrimary);
  });
});

describe('layout validation', () => {
  const base = (seats: AuditoriumLayout['seats']): AuditoriumLayout => ({
    id: 'l', version: 1, name: 'Test', aspectRatio: 1.25,
    screen: { center: { x: 0.5, y: 0.05 }, width: 0.6, curvature: 0.05, edge: 'top', label: 'SCREEN' },
    sections: [{ id: 'stalls', name: 'Stalls', order: 0 }],
    rows: [{ id: 'A', sectionId: 'stalls', label: 'A', order: 0 }],
    seats,
    features: [],
  });

  it('accepts a generated row with an aisle gap', () => {
    const seats = buildRow({
      rowId: 'A', sectionId: 'stalls', y: 0.2, seatSize: 0.04, gap: 0.008,
      seats: [{ label: '1' }, { label: '2' }, { label: null }, { label: '3' }, { label: '4' }],
    });
    expect(seats.map((s) => s.id)).toEqual(['A-1', 'A-2', 'A-3', 'A-4']);
    expect(validateLayout(base(seats))).toEqual([]);
  });

  it('detects overlapping and out-of-bounds seats', () => {
    const seats = buildRow({ rowId: 'A', sectionId: 'stalls', y: 0.2, seatSize: 0.04, gap: 0.008, seats: [{ label: '1' }, { label: '2' }] });
    seats[1].x = seats[0].x + 0.001;
    seats.push({ ...seats[0], id: 'A-9', label: '9', x: 1.2 });
    const codes = validateLayout(base(seats)).map((i) => i.code);
    expect(codes).toContain('seat.overlap');
    expect(codes).toContain('seat.bounds');
  });

  it('bends curved rows around the arc centre', () => {
    const seats = buildRow({
      rowId: 'A', sectionId: 'stalls', y: 0.3, seatSize: 0.04, gap: 0.01, arcCenter: { x: 0.5, y: -0.4 },
      seats: [{ label: '1' }, { label: '2' }, { label: '3' }],
    });
    // Outer seats sit higher (closer to arc centre in y) than the middle seat and are rotated symmetrically.
    expect(seats[0].y).toBeLessThan(seats[1].y);
    expect(seats[0].rotation).toBeCloseTo(-seats[2].rotation, 4);
  });
});
