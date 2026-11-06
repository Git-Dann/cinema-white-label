import { Prisma, PrismaClient } from '@prisma/client';
import { FixtureProduct, MENU_SPECIALS } from './commerce';

/** Database row for a fixture product. `filmId` is resolved from `filmSlug` by the caller. */
export function fixtureProductData(tenantId: string, c: FixtureProduct, sortOrder: number, filmId: string | null): Prisma.ConcessionProductUncheckedCreateInput {
  return {
    tenantId, sku: c.sku, name: c.name, description: c.description ?? null, category: c.category, priceMinor: c.priceMinor, allergens: c.allergens, dietary: c.dietary,
    calories: c.calories, stockStatus: c.stockStatus ?? 'inStock', modifierGroups: c.modifierGroups as Prisma.InputJsonValue, bundleItems: c.bundleItems ?? [], sortOrder,
    featured: c.featured ?? false, badge: c.badge ?? null, compareAtMinor: c.compareAtMinor ?? null, limitedEdition: c.limitedEdition ?? false, filmId,
  };
}

/**
 * Gives operators the demo specials, bundles and film tie-ins once. Runs on every
 * deploy but only adds them to an operator that has no featured products yet, so
 * an operator who has started curating specials (or deleted these) is left alone.
 * Returns how many products were added.
 */
export async function ensureFixtureMenuSpecials(prisma: PrismaClient, opts: { seeding?: boolean } = {}): Promise<number> {
  let added = 0;
  const tenants = await prisma.tenant.findMany({ select: { id: true } });
  for (const t of tenants) {
    // A fresh seed always adds them (its own featured combo would otherwise count as curated).
    if (!opts.seeding && (await prisma.concessionProduct.count({ where: { tenantId: t.id, featured: true } }))) continue;
    const existing = new Set((await prisma.concessionProduct.findMany({ where: { tenantId: t.id }, select: { sku: true } })).map((p) => p.sku));
    const films = await prisma.film.findMany({ where: { tenantId: t.id, slug: { in: MENU_SPECIALS.map((m) => m.filmSlug).filter((x): x is string => !!x) } }, select: { id: true, slug: true } });
    const maxSort = (await prisma.concessionProduct.aggregate({ where: { tenantId: t.id }, _max: { sortOrder: true } }))._max.sortOrder ?? 0;
    for (const [i, c] of MENU_SPECIALS.entries()) {
      if (existing.has(c.sku)) continue;
      const filmId = c.filmSlug ? films.find((f) => f.slug === c.filmSlug)?.id ?? null : null;
      await prisma.concessionProduct.create({ data: fixtureProductData(t.id, c, maxSort + 1 + i, filmId) });
      added++;
    }
    // The date night combo became a featured deal at the same time.
    await prisma.concessionProduct.updateMany({ where: { tenantId: t.id, sku: 'COMBO-DUO', compareAtMinor: null }, data: { featured: true, compareAtMinor: 1745 } });
  }
  return added;
}
