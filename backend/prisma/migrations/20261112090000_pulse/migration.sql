-- Pulse: one row per screening outcome (live rollup or labelled demo history).
CREATE TABLE "ShowOutcome" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "auditoriumId" TEXT NOT NULL,
    "screeningId" TEXT,
    "filmId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "admissions" INTEGER NOT NULL,
    "ticketRevenueMinor" INTEGER NOT NULL DEFAULT 0,
    "foodRevenueMinor" INTEGER NOT NULL DEFAULT 0,
    "foodOrders" INTEGER NOT NULL DEFAULT 0,
    "slot" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "filmWeek" INTEGER NOT NULL,
    "formats" TEXT[],
    "schoolHoliday" BOOLEAN NOT NULL DEFAULT false,
    "leadCurve" JSONB,
    "source" TEXT NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ShowOutcome_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ShowOutcome_screeningId_key" ON "ShowOutcome"("screeningId");
CREATE INDEX "ShowOutcome_tenantId_startsAt_idx" ON "ShowOutcome"("tenantId", "startsAt");
ALTER TABLE "ShowOutcome" ADD CONSTRAINT "ShowOutcome_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- UK bank holidays (gov.uk feed), refreshed daily.
CREATE TABLE "BankHoliday" (
    "division" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BankHoliday_pkey" PRIMARY KEY ("division","date")
);
