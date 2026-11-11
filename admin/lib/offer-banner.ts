/**
 * How an offer's title splits into the banner's two lines: a small lead and a big
 * headline. Mirrors Promotion.bannerLines in CinemaCore (the app), so the portal
 * preview matches the phone.
 *
 * - A saving in the title ("10% off", "£2 off", "2 for 1") is the headline; the rest is the lead.
 * - A film offer leads with its title and makes the film's name the headline.
 * - Otherwise the last word is the headline ("Pre-order your" / "SNACKS").
 */
export function bannerLines(title: string, filmTitle?: string | null): { lead: string; headline: string } {
  const t = title.trim();
  for (const re of [/\d+%\s*off/i, /£\d+(?:\.\d{2})?\s*off/i, /\d\s*for\s*\d/i]) {
    const m = t.match(re);
    if (m) return { lead: tidy(t.replace(m[0], '')), headline: m[0].toUpperCase() };
  }
  if (filmTitle) return { lead: tidy(t), headline: filmTitle.toUpperCase() };
  const words = t.split(/\s+/);
  if (words.length < 2) return { lead: '', headline: t.toUpperCase() };
  return { lead: tidy(words.slice(0, -1).join(' ')), headline: tidy(words[words.length - 1]).toUpperCase() };
}

const tidy = (s: string) => s.replace(/^[\s,.:;–-]+|[\s,.:;–-]+$/g, '').replace(/\s{2,}/g, ' ');

/** The starburst sticker's words. Mirrors Promotion.stickerLines in CinemaCore. */
export function stickerLines(action: 'voucher' | 'film' | 'link' | 'none', code?: string | null): string[] {
  if (action === 'voucher' && code) return ['USE CODE', code];
  if (action === 'film') return ['ON SALE', 'NOW'];
  return ['NEW'];
}

/** CSS polygon for a starburst with `points` spikes. */
export function starburstPolygon(points = 18, inner = 0.86): string {
  const out: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = (i % 2 === 0 ? 1 : inner) * 50;
    const a = (i / (points * 2)) * 2 * Math.PI - Math.PI / 2;
    out.push(`${(50 + Math.cos(a) * r).toFixed(2)}% ${(50 + Math.sin(a) * r).toFixed(2)}%`);
  }
  return `polygon(${out.join(', ')})`;
}
