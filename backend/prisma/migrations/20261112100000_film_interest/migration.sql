-- Pulse audience interest (Wikipedia page views via Wikidata, both CC0).
CREATE TABLE "FilmInterest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "filmId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "article" TEXT,
    "series" BOOLEAN NOT NULL DEFAULT false,
    "views" INTEGER NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FilmInterest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FilmInterest_filmId_key" ON "FilmInterest"("filmId");
CREATE INDEX "FilmInterest_tenantId_idx" ON "FilmInterest"("tenantId");

ALTER TABLE "FilmInterest" ADD CONSTRAINT "FilmInterest_filmId_fkey" FOREIGN KEY ("filmId") REFERENCES "Film"("id") ON DELETE CASCADE ON UPDATE CASCADE;
