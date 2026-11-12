import { rng } from './outcomes';
import { CustomerHistory } from './loyalty';

/**
 * Demo-only stand-ins for data a new operator doesn't have yet: food orders for basket
 * analysis and customer visit histories for loyalty segments. Used only for the demo
 * operators while their real data is thin, and always reported as demo in `basis`.
 */

/** Typical food orders built from the operator's menu, with the pairings cinemas see. */
export function demoBaskets(menu: string[], count = 600, seed = 11): string[][] {
  if (!menu.length) return [];
  const r = rng(seed);
  const find = (re: RegExp) => menu.find((m) => re.test(m));
  const popcorn = find(/popcorn/i);
  const drink = find(/drink|cola|soft|fizzy/i);
  const nachos = find(/nacho/i);
  const hotdog = find(/hot ?dog/i);
  const sweets = find(/choc|sweet|candy|ice/i);
  const water = find(/water/i);
  const orders: string[][] = [];
  for (let i = 0; i < count; i++) {
    const o = new Set<string>();
    const x = r();
    if (popcorn && x < 0.62) {
      o.add(popcorn);
      if (drink && r() < 0.78) o.add(drink);
    } else if (nachos && x < 0.8) {
      o.add(nachos);
      if (drink && r() < 0.85) o.add(drink);
    } else if (hotdog && x < 0.9) {
      o.add(hotdog);
      if (drink && r() < 0.7) o.add(drink);
    } else o.add(menu[Math.floor(r() * menu.length)]);
    // Sweets mostly go with popcorn; water mostly with nachos.
    if (sweets && r() < (popcorn && o.has(popcorn) ? 0.3 : 0.06)) o.add(sweets);
    if (water && r() < (nachos && o.has(nachos) ? 0.25 : 0.04)) o.add(water);
    orders.push([...o]);
  }
  return orders;
}

/** Customer visit histories with the shapes a loyalty programme sees (regulars, families, lapsed). */
export function demoCustomers(now: Date, count = 400, seed = 23): CustomerHistory[] {
  const r = rng(seed);
  const DAY = 86400_000;
  const out: CustomerHistory[] = [];
  for (let i = 0; i < count; i++) {
    const kind = r();
    const gap = kind < 0.15 ? 10 : kind < 0.45 ? 28 : kind < 0.7 ? 60 : 120;
    const family = r() < 0.25;
    // A quarter have stopped coming: silent for 4 to 10 times their usual gap, longer than chance explains.
    const lapsedFor = r() < 0.25 ? gap * (4 + r() * 6) : r() * gap;
    const visits = [];
    let t = now.getTime() - lapsedFor * DAY;
    const n = 1 + Math.floor(r() * (kind < 0.15 ? 18 : 8));
    for (let v = 0; v < n && t > now.getTime() - 500 * DAY; v++) {
      visits.push({ at: new Date(t), spendMinor: 1200 + Math.round(r() * (family ? 4200 : 2600)), familyMatinee: family && r() < 0.8 });
      t -= gap * (0.6 + r() * 0.8) * DAY;
    }
    out.push({ customerId: `demo-${i + 1}`, visits });
  }
  return out;
}
