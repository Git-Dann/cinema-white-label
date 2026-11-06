-- Specials, bundles with a "was" price, film tie-ins and limited editions on the menu.
ALTER TABLE "ConcessionProduct" ADD COLUMN "featured" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ConcessionProduct" ADD COLUMN "badge" TEXT;
ALTER TABLE "ConcessionProduct" ADD COLUMN "compareAtMinor" INTEGER;
ALTER TABLE "ConcessionProduct" ADD COLUMN "filmId" TEXT;
ALTER TABLE "ConcessionProduct" ADD COLUMN "limitedEdition" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ConcessionProduct" ADD COLUMN "availableFrom" TIMESTAMP(3);
ALTER TABLE "ConcessionProduct" ADD COLUMN "availableUntil" TIMESTAMP(3);
