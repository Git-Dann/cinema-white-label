export interface BasketRule {
  items: [string, string];
  support: number;
  confidence: number;
  lift: number;
  orders: number;
  suggestion: string;
}

/**
 * Pairs bought together in the same food order: support (share of orders with both),
 * confidence (of orders with A, share with B) and lift (how much more than chance).
 * Keeps pairs in at least 2% of orders with lift above 1.1; strongest ten first.
 */
export function basketRules(orders: string[][], minSupport = 0.02, minLift = 1.1): BasketRule[] {
  const n = orders.length;
  if (!n) return [];
  const single = new Map<string, number>();
  const pair = new Map<string, number>();
  for (const o of orders) {
    const items = [...new Set(o)].sort();
    for (const a of items) single.set(a, (single.get(a) ?? 0) + 1);
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const k = `${items[i]}\u0000${items[j]}`;
      pair.set(k, (pair.get(k) ?? 0) + 1);
    }
  }
  const rules: BasketRule[] = [];
  for (const [k, both] of pair) {
    const [a, b] = k.split('\u0000');
    const support = both / n;
    if (support < minSupport) continue;
    // Direction with the higher confidence reads best ("people who buy A also buy B").
    const [x, y] = single.get(a)! <= single.get(b)! ? [a, b] : [b, a];
    const confidence = both / single.get(x)!;
    const lift = confidence / (single.get(y)! / n);
    if (lift <= minLift) continue;
    rules.push({
      items: [x, y],
      support: Math.round(support * 1000) / 1000,
      confidence: Math.round(confidence * 1000) / 1000,
      lift: Math.round(lift * 100) / 100,
      orders: both,
      suggestion: `${x} and ${y} are bought together in ${Math.round(support * 100)}% of food orders, ${lift.toFixed(1)} times more often than chance. ${Math.round(confidence * 100)}% of people who buy ${x} also buy ${y}: worth a bundle at a small saving.`,
    });
  }
  return rules.sort((p, q) => q.lift * q.support - p.lift * p.support).slice(0, 10);
}
