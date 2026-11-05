import type { PrismaClient } from '@prisma/client';

/** Size of the generated menu artwork in shared/fixtures/artwork/food (see scripts/generate-food-artwork.ts). */
const SIZE = { width: 1200, height: 900 };

/** Generated artwork per demo SKU, with the colour used as a loading placeholder. */
export const FIXTURE_PRODUCT_IMAGES: Record<string, string> = {
  'POP-SWEET': '#2A160D',
  'POP-SALT': '#1F1C19',
  'POP-MIX': '#28190F',
  DRINK: '#2A0B0D',
  WATER: '#0B1F28',
  NACHOS: '#2A1F0A',
  HOTDOG: '#2A100A',
  CHOC: '#22130D',
  ICECREAM: '#201B26',
  'COMBO-DUO': '#2A130E',
};

/**
 * Gives demo products their generated artwork when they have no image yet.
 * Safe to run on every deploy: products with an image (including ones an
 * operator uploaded) are never touched. Returns how many were filled.
 */
export async function ensureFixtureProductImages(prisma: PrismaClient): Promise<number> {
  const products = await prisma.concessionProduct.findMany({
    where: { imageAssetId: null, sku: { in: Object.keys(FIXTURE_PRODUCT_IMAGES) } },
    select: { id: true, tenantId: true, sku: true },
  });
  for (const p of products) {
    await prisma.$transaction(async (tx) => {
      const asset = await tx.mediaAsset.create({
        data: {
          tenantId: p.tenantId, kind: 'PRODUCT', provider: 'fixture', sourceRef: `fixture:food/${p.sku.toLowerCase()}`,
          storageKey: `fixture/food/${p.sku.toLowerCase()}.jpg`, width: SIZE.width, height: SIZE.height, mimeType: 'image/jpeg',
          dominantColor: FIXTURE_PRODUCT_IMAGES[p.sku], approvedContexts: ['menu'], attribution: 'Illustration (demo artwork)',
        },
      });
      await tx.concessionProduct.update({ where: { id: p.id }, data: { imageAssetId: asset.id } });
    });
  }
  return products.length;
}
