import type { PrismaClient } from '@prisma/client';

/**
 * Demo offer banners. Photos are the demo food and cinema photos already in
 * shared/fixtures/artwork (Unsplash License, see SOURCES.md in each folder).
 * Film offers need none: they use the film's backdrop.
 */
const BANNERS = [
  { match: /welcome10|new here/i, storageKey: 'fixture/venues/leeds-riverside.jpg', sourceRef: 'unsplash:photo-1639408396859-38827de3a883', colour: '#2D1C17' },
  { match: /snack|popcorn|food/i, storageKey: 'fixture/food/combo-duo.jpg', sourceRef: 'unsplash:photo-1585647347384-2593bc35786b', colour: '#681818' },
];

/** The demo "pre-order your snacks" offer, added once to operators that sell food. */
const SNACKS = { title: 'Pre-order your snacks', body: 'Add popcorn and drinks when you book and skip the queue on the night.', ctaLabel: '', action: 'none' };

/**
 * Gives demo offers a banner photo when they have none, and adds the snacks
 * offer to demo operators that don't have it. Safe on every deploy: offers with
 * a photo (including uploads) are never touched. Returns how many were filled.
 */
export async function ensureFixturePromotionImages(prisma: PrismaClient, opts: { addSnacks?: boolean } = {}): Promise<number> {
  if (opts.addSnacks !== false) {
    for (const t of await prisma.tenant.findMany({ where: { slug: { in: ['northlight', 'kestrel'] } }, select: { id: true } })) {
      const has = await prisma.promotion.findFirst({ where: { tenantId: t.id, title: SNACKS.title } });
      if (!has) await prisma.promotion.create({ data: { tenantId: t.id, ...SNACKS, sortOrder: 2 } });
    }
  }
  const rows = await prisma.promotion.findMany({ where: { imageAssetId: null, action: { not: 'film' } }, select: { id: true, tenantId: true, title: true, body: true, voucherCode: true } });
  let filled = 0;
  for (const r of rows) {
    const banner = BANNERS.find((b) => b.match.test(`${r.title} ${r.body} ${r.voucherCode ?? ''}`));
    if (!banner) continue;
    await prisma.$transaction(async (tx) => {
      const asset = await tx.mediaAsset.create({
        data: {
          tenantId: r.tenantId, kind: 'BANNER', provider: 'unsplash', sourceRef: banner.sourceRef, licenceRef: 'Unsplash License',
          storageKey: banner.storageKey, width: 1200, height: 900, mimeType: 'image/jpeg', dominantColor: banner.colour,
          approvedContexts: ['promotion'], attribution: 'Photo: Unsplash',
        },
      });
      await tx.promotion.update({ where: { id: r.id }, data: { imageAssetId: asset.id } });
    });
    filled++;
  }
  return filled;
}
