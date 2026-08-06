DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'embeddings' AND column_name = 'content_vector'
  ) THEN
    ALTER TABLE "embeddings" ADD COLUMN "content_vector" tsvector GENERATED ALWAYS AS (to_tsvector('simple', "content")) STORED;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "embeddings_content_vector_idx" ON "embeddings" USING gin ("content_vector");
