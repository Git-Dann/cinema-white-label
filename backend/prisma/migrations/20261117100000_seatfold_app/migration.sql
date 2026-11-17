-- Operators listed in the shared Seatfold app. The two fictional demo operators are listed so the app has something to show.
ALTER TABLE "Tenant" ADD COLUMN "listedInSeatfoldApp" BOOLEAN NOT NULL DEFAULT false;
UPDATE "Tenant" SET "listedInSeatfoldApp" = true WHERE "slug" IN ('northlight', 'kestrel');
