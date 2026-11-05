import { z } from 'zod';
import { bestTextOn, contrastRatio, Hex, isHex, mix, withAlpha } from './color';

/**
 * Theme system.
 *
 * Themes (Classic, Midnight Cinema, ...) are independent of brand identity.
 * A tenant picks a theme and supplies an approved brand palette; the resolver
 * combines them into concrete semantic tokens for light and dark appearances.
 * The native apps only ever consume *resolved* tokens.
 */

export const THEME_IDS = ['classic', 'midnight', 'premium', 'light', 'highContrast'] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export const hexSchema = z.string().refine(isHex, 'Expected #RRGGBB or #RRGGBBAA');

export const brandPaletteSchema = z.object({
  id: z.string(),
  name: z.string(),
  /**
   * Primary brand accent, used for primary actions and selection.
   * Approved palettes supply a variant per appearance, like Apple's system colours,
   * because one hex value rarely meets contrast on both light and dark backgrounds.
   */
  accent: z.object({ light: hexSchema, dark: hexSchema }),
  /** Secondary accent used for highlights such as membership and premium seats. */
  secondary: z.object({ light: hexSchema, dark: hexSchema }),
});
export type BrandPalette = z.infer<typeof brandPaletteSchema>;

export const appearancePolicySchema = z.enum(['system', 'alwaysDark', 'alwaysLight']);
export type AppearancePolicy = z.infer<typeof appearancePolicySchema>;

export const SEMANTIC_TOKEN_KEYS = [
  'background',
  'backgroundElevated',
  'surface',
  'surfaceElevated',
  'textPrimary',
  'textSecondary',
  'textMuted',
  'actionPrimary',
  'actionPrimaryText',
  'actionSecondary',
  'actionSecondaryText',
  'selected',
  'selectedText',
  'divider',
  'border',
  'focus',
  'error',
  'warning',
  'success',
  'artworkScrim',
  'membership',
  'membershipText',
  'seatAvailable',
  'seatAvailableBorder',
  'seatSelected',
  'seatSelectedText',
  'seatHeld',
  'seatSold',
  'seatUnavailable',
  'seatPremium',
  'seatAccessible',
  'seatCompanion',
  'seatRestricted',
  'seatBlocked',
  'screen',
] as const;
export type SemanticTokenKey = (typeof SEMANTIC_TOKEN_KEYS)[number];
export type SemanticTokens = Record<SemanticTokenKey, Hex>;

export const semanticTokensSchema = z.object(
  Object.fromEntries(SEMANTIC_TOKEN_KEYS.map((k) => [k, hexSchema])) as Record<SemanticTokenKey, typeof hexSchema>,
);

export const resolvedThemeSchema = z.object({
  themeId: z.enum(THEME_IDS),
  name: z.string(),
  appearancePolicy: appearancePolicySchema,
  light: semanticTokensSchema,
  dark: semanticTokensSchema,
  /** Corner radius scale used for cards and controls, in points. */
  cornerRadius: z.object({ small: z.number(), medium: z.number(), large: z.number() }),
});
export type ResolvedTheme = z.infer<typeof resolvedThemeSchema>;

type Appearance = 'light' | 'dark';

interface ThemeTemplate {
  id: ThemeId;
  name: string;
  appearancePolicy: AppearancePolicy;
  cornerRadius: ResolvedTheme['cornerRadius'];
  base: Record<Appearance, { bg: Hex; elevated: Hex; surface: Hex; surfaceElevated: Hex; text: Hex; text2: Hex; muted: Hex; divider: Hex }>;
}

const TEMPLATES: Record<ThemeId, ThemeTemplate> = {
  classic: {
    id: 'classic',
    name: 'Classic',
    appearancePolicy: 'system',
    cornerRadius: { small: 10, medium: 16, large: 24 },
    base: {
      light: { bg: '#F5F5F7', elevated: '#FFFFFF', surface: '#FFFFFF', surfaceElevated: '#F0F0F3', text: '#111114', text2: '#3C3C43', muted: '#6B6B73', divider: '#D8D8DE' },
      dark: { bg: '#0E0E11', elevated: '#18181C', surface: '#1C1C21', surfaceElevated: '#26262C', text: '#F5F5F7', text2: '#C7C7CC', muted: '#9A9AA2', divider: '#2E2E35' },
    },
  },
  midnight: {
    id: 'midnight',
    name: 'Midnight Cinema',
    appearancePolicy: 'alwaysDark',
    cornerRadius: { small: 12, medium: 20, large: 28 },
    base: {
      light: { bg: '#F2F4F8', elevated: '#FFFFFF', surface: '#FFFFFF', surfaceElevated: '#EBEEF4', text: '#0B1220', text2: '#334155', muted: '#5B6577', divider: '#D5DAE3' },
      dark: { bg: '#060B14', elevated: '#0D1524', surface: '#111A2B', surfaceElevated: '#18233A', text: '#F4F7FB', text2: '#C5CDDA', muted: '#8E9AB0', divider: '#1F2B42' },
    },
  },
  premium: {
    id: 'premium',
    name: 'Premium',
    appearancePolicy: 'system',
    cornerRadius: { small: 8, medium: 14, large: 22 },
    base: {
      light: { bg: '#F7F4EE', elevated: '#FFFFFF', surface: '#FFFDF8', surfaceElevated: '#EFEAE0', text: '#1A1612', text2: '#4A4238', muted: '#6E6458', divider: '#DDD4C4' },
      dark: { bg: '#0C0A08', elevated: '#16130F', surface: '#1C1813', surfaceElevated: '#26211A', text: '#F7F1E6', text2: '#D6CCBA', muted: '#A3977F', divider: '#2F2920' },
    },
  },
  light: {
    id: 'light',
    name: 'Light',
    appearancePolicy: 'alwaysLight',
    cornerRadius: { small: 10, medium: 16, large: 24 },
    base: {
      light: { bg: '#FFFFFF', elevated: '#FFFFFF', surface: '#F6F6F8', surfaceElevated: '#EDEDF1', text: '#0A0A0C', text2: '#3A3A40', muted: '#65656D', divider: '#E1E1E6' },
      dark: { bg: '#111114', elevated: '#1A1A1E', surface: '#1E1E23', surfaceElevated: '#28282E', text: '#F5F5F7', text2: '#C7C7CC', muted: '#9A9AA2', divider: '#303036' },
    },
  },
  highContrast: {
    id: 'highContrast',
    name: 'High Contrast',
    appearancePolicy: 'system',
    cornerRadius: { small: 8, medium: 12, large: 18 },
    base: {
      light: { bg: '#FFFFFF', elevated: '#FFFFFF', surface: '#FFFFFF', surfaceElevated: '#F0F0F0', text: '#000000', text2: '#1A1A1A', muted: '#333333', divider: '#000000' },
      dark: { bg: '#000000', elevated: '#000000', surface: '#0A0A0A', surfaceElevated: '#1A1A1A', text: '#FFFFFF', text2: '#F0F0F0', muted: '#D0D0D0', divider: '#FFFFFF' },
    },
  },
};

export function themeTemplates(): { id: ThemeId; name: string; appearancePolicy: AppearancePolicy }[] {
  return THEME_IDS.map((id) => ({ id, name: TEMPLATES[id].name, appearancePolicy: TEMPLATES[id].appearancePolicy }));
}

/**
 * Adjust an accent so it reaches `min` contrast against `bg` by mixing towards
 * white (dark backgrounds) or black (light backgrounds). Used only for
 * non-text accents such as seat indicators in the high-contrast theme.
 */
function ensureContrast(color: Hex, bg: Hex, min: number): Hex {
  if (contrastRatio(color, bg) >= min) return color;
  const target = contrastRatio('#FFFFFF', bg) > contrastRatio('#000000', bg) ? '#FFFFFF' : '#000000';
  for (let i = 1; i <= 20; i++) {
    const candidate = mix(color, target, i / 20);
    if (contrastRatio(candidate, bg) >= min) return candidate;
  }
  return target;
}

function resolveAppearance(t: ThemeTemplate, palette: BrandPalette, appearance: Appearance): SemanticTokens {
  const b = t.base[appearance];
  const isDark = appearance === 'dark';
  const hc = t.id === 'highContrast';
  // In high contrast the accent is forced to reach AA text contrast against the background.
  const accent = hc ? ensureContrast(palette.accent[appearance], b.bg, 7) : palette.accent[appearance];
  const secondary = hc ? ensureContrast(palette.secondary[appearance], b.bg, 4.5) : palette.secondary[appearance];

  const seatAvailable = isDark ? mix(b.surfaceElevated, '#FFFFFF', hc ? 0.0 : 0.06) : mix(b.surfaceElevated, '#000000', 0.02);
  const seatBorder = ensureContrast(isDark ? mix(b.text, b.bg, 0.55) : mix(b.text, b.bg, 0.55), b.bg, 3);

  return {
    background: b.bg,
    backgroundElevated: b.elevated,
    surface: b.surface,
    surfaceElevated: b.surfaceElevated,
    textPrimary: b.text,
    textSecondary: b.text2,
    textMuted: b.muted,
    actionPrimary: accent,
    actionPrimaryText: bestTextOn(accent),
    actionSecondary: isDark ? mix(b.surfaceElevated, '#FFFFFF', 0.08) : mix(b.surfaceElevated, '#000000', 0.04),
    actionSecondaryText: b.text,
    selected: accent,
    selectedText: bestTextOn(accent),
    divider: b.divider,
    border: seatBorder,
    focus: ensureContrast(isDark ? '#7DB4FF' : '#0A60D8', b.bg, 3),
    error: isDark ? '#FF6B6B' : '#C62828',
    warning: isDark ? '#FFC24B' : '#8A5300',
    success: isDark ? '#4ADE80' : '#1B7A3A',
    artworkScrim: withAlpha(b.bg, 0.72),
    membership: secondary,
    membershipText: bestTextOn(secondary),
    seatAvailable,
    seatAvailableBorder: seatBorder,
    // Brand colours are only auto-adjusted in High Contrast; elsewhere an
    // unreadable palette must fail validation rather than silently change.
    seatSelected: accent,
    seatSelectedText: bestTextOn(accent),
    seatHeld: ensureContrast(isDark ? '#B08A2E' : '#9C6B00', b.bg, 3),
    seatSold: isDark ? mix(b.bg, '#FFFFFF', 0.12) : mix(b.bg, '#000000', 0.14),
    seatUnavailable: isDark ? mix(b.bg, '#FFFFFF', 0.08) : mix(b.bg, '#000000', 0.08),
    seatPremium: secondary,
    seatAccessible: ensureContrast(isDark ? '#4C9AFF' : '#1858C4', b.bg, 3),
    seatCompanion: ensureContrast(isDark ? '#3FC1C9' : '#0B7A80', b.bg, 3),
    seatRestricted: ensureContrast(isDark ? '#C9A26B' : '#7A5A22', b.bg, 3),
    seatBlocked: isDark ? mix(b.bg, '#FFFFFF', 0.06) : mix(b.bg, '#000000', 0.06),
    screen: ensureContrast(isDark ? mix(b.text, b.bg, 0.25) : mix(b.text, b.bg, 0.35), b.bg, 3),
  };
}

export function resolveTheme(themeId: ThemeId, palette: BrandPalette, overrides?: { appearancePolicy?: AppearancePolicy }): ResolvedTheme {
  const t = TEMPLATES[themeId];
  return {
    themeId,
    name: t.name,
    appearancePolicy: overrides?.appearancePolicy ?? t.appearancePolicy,
    cornerRadius: t.cornerRadius,
    light: resolveAppearance(t, palette, 'light'),
    dark: resolveAppearance(t, palette, 'dark'),
  };
}

/** Required contrast pairs, per WCAG 2.2 AA (1.4.3 text, 1.4.11 non-text). */
export const CONTRAST_REQUIREMENTS: { fg: SemanticTokenKey; bg: SemanticTokenKey; min: number; label: string }[] = [
  { fg: 'textPrimary', bg: 'background', min: 4.5, label: 'Primary text on background' },
  { fg: 'textSecondary', bg: 'background', min: 4.5, label: 'Secondary text on background' },
  { fg: 'textMuted', bg: 'background', min: 4.5, label: 'Muted text on background' },
  { fg: 'textPrimary', bg: 'surface', min: 4.5, label: 'Primary text on surface' },
  { fg: 'textSecondary', bg: 'surface', min: 4.5, label: 'Secondary text on surface' },
  { fg: 'textMuted', bg: 'surface', min: 4.5, label: 'Muted text on surface' },
  { fg: 'actionPrimaryText', bg: 'actionPrimary', min: 4.5, label: 'Primary button label' },
  { fg: 'actionSecondaryText', bg: 'actionSecondary', min: 4.5, label: 'Secondary button label' },
  { fg: 'selectedText', bg: 'selected', min: 4.5, label: 'Selected control label' },
  { fg: 'membershipText', bg: 'membership', min: 4.5, label: 'Membership card text' },
  { fg: 'error', bg: 'background', min: 4.5, label: 'Error text' },
  { fg: 'warning', bg: 'background', min: 4.5, label: 'Warning text' },
  { fg: 'success', bg: 'background', min: 4.5, label: 'Success text' },
  { fg: 'focus', bg: 'background', min: 3, label: 'Focus indicator' },
  { fg: 'seatAvailableBorder', bg: 'background', min: 3, label: 'Available seat outline' },
  { fg: 'seatSelected', bg: 'background', min: 3, label: 'Selected seat' },
  { fg: 'seatSelectedText', bg: 'seatSelected', min: 4.5, label: 'Selected seat label' },
  { fg: 'seatHeld', bg: 'background', min: 3, label: 'Held seat' },
  { fg: 'seatPremium', bg: 'background', min: 3, label: 'Premium seat' },
  { fg: 'seatAccessible', bg: 'background', min: 3, label: 'Accessible seat' },
  { fg: 'seatCompanion', bg: 'background', min: 3, label: 'Companion seat' },
  { fg: 'seatRestricted', bg: 'background', min: 3, label: 'Restricted-view seat' },
  { fg: 'screen', bg: 'background', min: 3, label: 'Screen indicator' },
];

export interface ContrastIssue {
  appearance: Appearance;
  label: string;
  fg: SemanticTokenKey;
  bg: SemanticTokenKey;
  ratio: number;
  required: number;
}

export function validateThemeContrast(theme: ResolvedTheme): ContrastIssue[] {
  const issues: ContrastIssue[] = [];
  const appearances: Appearance[] =
    theme.appearancePolicy === 'alwaysDark' ? ['dark'] : theme.appearancePolicy === 'alwaysLight' ? ['light'] : ['light', 'dark'];
  for (const appearance of appearances) {
    const tokens = theme[appearance];
    for (const req of CONTRAST_REQUIREMENTS) {
      const ratio = contrastRatio(tokens[req.fg], tokens[req.bg]);
      if (ratio + 1e-9 < req.min) {
        issues.push({ appearance, label: req.label, fg: req.fg, bg: req.bg, ratio: Math.round(ratio * 100) / 100, required: req.min });
      }
    }
  }
  return issues;
}
