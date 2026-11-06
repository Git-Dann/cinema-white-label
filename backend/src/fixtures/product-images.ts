import type { PrismaClient } from '@prisma/client';

/** Size of the demo menu photos in shared/fixtures/artwork/food (see SOURCES.md there). */
const SIZE = { width: 1200, height: 900 };

/** Unsplash photo per demo SKU (Unsplash License), with its dominant colour for the loading placeholder. */
export const FIXTURE_PRODUCT_IMAGES: Record<string, { unsplash: string; colour: string }> = {
  'POP-SWEET': { unsplash: 'photo-1572177191856-3cde618dee1f', colour: '#181828' },
  'POP-SALT': { unsplash: 'photo-1578849278619-e73505e9610f', colour: '#A89878' },
  'POP-MIX': { unsplash: 'photo-1505686994434-e3cc5abf1330', colour: '#A8B8B8' },
  DRINK: { unsplash: 'photo-1581636625402-29b2a704ef13', colour: '#080808' },
  WATER: { unsplash: 'photo-1523362628745-0c100150b504', colour: '#E8E8E8' },
  NACHOS: { unsplash: 'photo-1513456852971-30c0b8199d4d', colour: '#C8C8C8' },
  HOTDOG: { unsplash: 'photo-1612392062631-94dd858cba88', colour: '#F8B838' },
  CHOC: { unsplash: 'photo-1599599810769-bcde5a160d32', colour: '#E8E8E8' },
  ICECREAM: { unsplash: 'photo-1570197788417-0e82375c9371', colour: '#D8D8E8' },
  'COMBO-DUO': { unsplash: 'photo-1585647347384-2593bc35786b', colour: '#681818' },
  'EMBER-BUCKET': { unsplash: 'photo-1691480213129-106b2c7d1ee8', colour: '#F0D8A8' },
  'TIDE-CARAMEL': { unsplash: 'photo-1620177088258-c84147ee601f', colour: '#B07848' },
  'HOT-CHOC': { unsplash: 'photo-1637572815755-c4b80092dce1', colour: '#685848' },
  'COMBO-FAMILY': { unsplash: 'photo-1623179007436-1d366e78ba68', colour: '#987860' },
};

/**
 * Gives demo products their demo photo when they have no image yet.
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
          tenantId: p.tenantId, kind: 'PRODUCT', provider: 'unsplash', sourceRef: `unsplash:${FIXTURE_PRODUCT_IMAGES[p.sku].unsplash}`,
          licenceRef: 'Unsplash License', storageKey: `fixture/food/${p.sku.toLowerCase()}.jpg`, width: SIZE.width, height: SIZE.height,
          mimeType: 'image/jpeg', dominantColor: FIXTURE_PRODUCT_IMAGES[p.sku].colour, approvedContexts: ['menu'], attribution: 'Photo: Unsplash',
        },
      });
      await tx.concessionProduct.update({ where: { id: p.id }, data: { imageAssetId: asset.id } });
    });
  }
  return products.length;
}
