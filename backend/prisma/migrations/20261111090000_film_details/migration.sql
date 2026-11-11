-- Rich film details (cast, crew, about, content advice) as JSON.
ALTER TABLE "Film" ADD COLUMN "details" JSONB NOT NULL DEFAULT '{}';
