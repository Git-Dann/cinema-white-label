-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "membershipDiscountMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "membershipPlanName" TEXT,
ADD COLUMN     "pointsDiscountMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pointsEarned" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pointsRedeemed" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "LoyaltyLedgerEntry" ADD COLUMN     "balanceAfter" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "description" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "MembershipPlan" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "description" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MembershipPurchase" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerRef" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MembershipPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyProgram" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "earnPointsPerPound" INTEGER NOT NULL,
    "redeemPointsPerPound" INTEGER NOT NULL,
    "minRedeemPoints" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoyaltyProgram_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Membership_customerId_key" ON "Membership"("customerId");

-- CreateIndex
CREATE INDEX "Membership_tenantId_planId_idx" ON "Membership"("tenantId", "planId");

-- CreateIndex
CREATE UNIQUE INDEX "MembershipPurchase_provider_providerRef_key" ON "MembershipPurchase"("provider", "providerRef");

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyProgram_tenantId_key" ON "LoyaltyProgram"("tenantId");

-- CreateIndex
CREATE INDEX "LoyaltyLedgerEntry_accountId_createdAt_idx" ON "LoyaltyLedgerEntry"("accountId", "createdAt");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MembershipPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipPurchase" ADD CONSTRAINT "MembershipPurchase_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyProgram" ADD CONSTRAINT "LoyaltyProgram_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyAccount" ADD CONSTRAINT "LoyaltyAccount_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyLedgerEntry" ADD CONSTRAINT "LoyaltyLedgerEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LoyaltyAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Defence in depth: redemption uses a conditional UPDATE, and the balance can never go negative.
ALTER TABLE "LoyaltyAccount" ADD CONSTRAINT "LoyaltyAccount_points_non_negative" CHECK ("points" >= 0);
