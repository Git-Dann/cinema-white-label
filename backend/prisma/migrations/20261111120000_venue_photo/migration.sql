-- A photo per cinema (kind VENUE), shown on its card in the portal and app.
ALTER TYPE "AssetKind" ADD VALUE 'VENUE';
ALTER TABLE "Venue" ADD COLUMN "imageAssetId" TEXT;
