-- Product images, and durable storage for operator uploads.
ALTER TYPE "AssetKind" ADD VALUE IF NOT EXISTS 'PRODUCT';

CREATE TABLE "MediaBlob" (
    "storageKey" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MediaBlob_pkey" PRIMARY KEY ("storageKey")
);
