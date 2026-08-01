ALTER TABLE "embeddings" ALTER COLUMN "embedding" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "embeddings" ADD COLUMN "metadata" jsonb DEFAULT '{}' NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "embeddings_entity_idx" ON "embeddings" ("entity_type", "entity_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "processed_events" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
