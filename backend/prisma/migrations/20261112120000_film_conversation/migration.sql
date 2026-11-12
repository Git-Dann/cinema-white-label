-- Pulse social conversation (Bluesky counts and post links; post text is never stored).
CREATE TABLE "FilmConversation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "filmId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "query" TEXT,
    "posts7" INTEGER NOT NULL,
    "prev7" INTEGER NOT NULL,
    "engagement7" INTEGER NOT NULL,
    "top" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FilmConversation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FilmConversation_filmId_key" ON "FilmConversation"("filmId");
CREATE INDEX "FilmConversation_tenantId_idx" ON "FilmConversation"("tenantId");

ALTER TABLE "FilmConversation" ADD CONSTRAINT "FilmConversation_filmId_fkey" FOREIGN KEY ("filmId") REFERENCES "Film"("id") ON DELETE CASCADE ON UPDATE CASCADE;
