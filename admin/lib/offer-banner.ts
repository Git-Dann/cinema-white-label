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
