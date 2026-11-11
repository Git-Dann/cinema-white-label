import type { PrismaClient } from '@prisma/client';

/** Size of the demo cinema photos in shared/fixtures/artwork/venues (see SOURCES.md there). */
const SIZE = { width: 1200, height: 900 };

/** Unsplash photo per demo cinema (Unsplash License), with its dominant colour for the loading placeholder. */
const PHOTOS = {
  'leeds-riverside': { unsplash: 'photo-1639408396859-38827de3a883', colour: '#2D1C17' },
  'manchester-ancoats': { unsplash: 'photo-1631702825172-a9a848c473ad', colour: '#532D1E' },
  'sheffield-kelham': { unsplash: 'photo-1722321974501-059dff03e970', colour: '#6A2C1A' },
  'york-walls': { unsplash: 'photo-1758216535135-2411b8b6c310', colour: '#54472F' },
} as const;
type PhotoKey = keyof typeof PHOTOS;

/** Demo cinema slug → photo. The second operator's demo cinemas reuse two of them. */
export const FIXTURE_VENUE_PHOTOS: Record<string, PhotoKey> = {
  'leeds-riverside': 'leeds-riverside',
  'manchester-ancoats': 'manchester-ancoats',
  'sheffield-kelham': 'sheffield-kelham',
  'york-walls': 'york-walls',
  'bath-abbey-green': 'sheffield-kelham',
  'brighton-lanes': 'manchester-ancoats',
};

/**
 * Gives demo cinemas their demo photo when they have none. Safe on every deploy:
 * a cinema with a photo (including one an operator uploaded) is never touched.
 * Returns how many were filled.
 */
export async function ensureFixtureVenueImages(prisma: PrismaClient): Promise<number> {
  const venues = await prisma.venue.findMany({
    where: { imageAssetId: null, slug: { in: Object.keys(FIXTURE_VENUE_PHOTOS) } },
    select: { id: true, tenantId: true, slug: true },
  });
  for (const v of venues) {
    const key = FIXTURE_VENUE_PHOTOS[v.slug];
    const photo = PHOTOS[key];
    await prisma.$transaction(async (tx) => {
      const asset = await tx.mediaAsset.create({
        data: {
          tenantId: v.tenantId, kind: 'VENUE', provider: 'unsplash', sourceRef: `unsplash:${photo.unsplash}`,
          licenceRef: 'Unsplash License', storageKey: `fixture/venues/${key}.jpg`, width: SIZE.width, height: SIZE.height,
          mimeType: 'image/jpeg', dominantColor: photo.colour, approvedContexts: ['venue'], attribution: 'Photo: Unsplash',
        },
      });
      await tx.venue.update({ where: { id: v.id }, data: { imageAssetId: asset.id } });
    });
  }
  return venues.length;
}
