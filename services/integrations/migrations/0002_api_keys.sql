ALTER TABLE "api_keys" ADD COLUMN "key_prefix" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "last_used_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" DROP COLUMN IF EXISTS "attempt";
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "event_id" uuid;
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "last_error" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "processed_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "processed_events_event_id_unique" UNIQUE("event_id")
);
