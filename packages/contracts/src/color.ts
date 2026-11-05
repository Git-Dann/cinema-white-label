/**
 * Colour utilities implementing WCAG 2.2 relative luminance and contrast ratio.
 * https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio
 */

export type Hex = string;

const HEX_RE = /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/;

export function isHex(value: string): boolean {
  return HEX_RE.test(value);
}

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function parseHex(hex: Hex): RGBA {
  const m = HEX_RE.exec(hex);
  if (!m) throw new Error(`Invalid hex colour: ${hex}`);
  const n = parseInt(m[1], 16);
  const a = m[2] ? parseInt(m[2], 16) / 255 : 1;
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff, a };
}

export function toHex({ r, g, b }: Pick<RGBA, 'r' | 'g' | 'b'>): Hex {
  const c = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase();
}

/** Composite a (possibly translucent) foreground over an opaque background. */
export function composite(fg: Hex, bg: Hex): Hex {
  const f = parseHex(fg);
  const b = parseHex(bg);
  return toHex({
    r: f.r * f.a + b.r * (1 - f.a),
    g: f.g * f.a + b.g * (1 - f.a),
    b: f.b * f.a + b.b * (1 - f.a),
  });
}

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex: Hex): number {
  const { r, g, b } = parseHex(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Contrast ratio between two colours. Translucent foregrounds are composited over the background first. */
export function contrastRatio(fg: Hex, bg: Hex): number {
  const solidBg = parseHex(bg).a < 1 ? composite(bg, '#000000') : bg;
  const solidFg = parseHex(fg).a < 1 ? composite(fg, solidBg) : fg;
  const l1 = relativeLuminance(solidFg);
  const l2 = relativeLuminance(solidBg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/** Pick black or white text, whichever contrasts best with the background. */
export function bestTextOn(bg: Hex, light: Hex = '#FFFFFF', dark: Hex = '#0B0B0F'): Hex {
  return contrastRatio(light, bg) >= contrastRatio(dark, bg) ? light : dark;
}

export function mix(a: Hex, b: Hex, amount: number): Hex {
  const x = parseHex(a);
  const y = parseHex(b);
  return toHex({
    r: x.r + (y.r - x.r) * amount,
    g: x.g + (y.g - x.g) * amount,
    b: x.b + (y.b - x.b) * amount,
  });
}

export function withAlpha(hex: Hex, alpha: number): Hex {
  const base = toHex(parseHex(hex));
  return base + Math.round(Math.max(0, Math.min(1, alpha)) * 255).toString(16).padStart(2, '0').toUpperCase();
}
