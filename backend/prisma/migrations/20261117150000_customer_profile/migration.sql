-- Customer profile from the app: name, phone and marketing consent (email and displayName already exist).
ALTER TABLE "Customer" ADD COLUMN "givenName" TEXT;
ALTER TABLE "Customer" ADD COLUMN "familyName" TEXT;
ALTER TABLE "Customer" ADD COLUMN "phone" TEXT;
ALTER TABLE "Customer" ADD COLUMN "marketingOptIn" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Customer" ADD COLUMN "marketingConsentAt" TIMESTAMP(3);
ALTER TABLE "Customer" ADD COLUMN "profileUpdatedAt" TIMESTAMP(3);
