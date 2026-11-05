// Paints a phone preview (.demo) from the product's theme engine: an operator palette and a theme
// resolve to the same semantic tokens the iPhone app reads. Shared by the hero and the portal demo.
import { resolveTheme } from './theme-engine.js';

export const PALETTES = {
  northlight: { name: 'Northlight', accent: { dark: '#2DD4BF', light: '#0F766E' }, secondary: { dark: '#F5C451', light: '#9A6700' } },
  kestrel: { name: 'Kestrel', accent: { dark: '#FF5A6A', light: '#B0102A' }, secondary: { dark: '#D4AF37', light: '#8A6A12' } },
};

export function paint(screen, palette, themeId, appearance) {
  const r = resolveTheme(themeId, { id: palette.name, ...palette });
  const t = r[appearance];
  const set = (k, v) => screen.style.setProperty(k, v);
  set('--d-bg', t.background); set('--d-surface', t.surface); set('--d-surface2', t.surfaceElevated);
  set('--d-text', t.textPrimary); set('--d-text2', t.textSecondary); set('--d-muted', t.textMuted);
  set('--d-accent', t.actionPrimary); set('--d-accent-text', t.actionPrimaryText); set('--d-divider', t.divider);
  set('--d-seat', t.seatAvailable); set('--d-seat-line', t.seatAvailableBorder); set('--d-sel', t.seatSelected);
  set('--d-held', t.seatHeld); set('--d-sold', t.seatSold); set('--d-prem', t.seatPremium);
  set('--d-r', r.cornerRadius.medium / 2 + 'px');
  const brand = screen.querySelector('[data-demo-brand]');
  if (brand) brand.textContent = palette.name;
  return { resolved: r, tokens: t };
}
