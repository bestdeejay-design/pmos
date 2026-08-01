-- Reconcile external_events: the scaffold 0000_init.sql created a placeholder
-- shape (calendar_id/uid/title). This replaces it with the canonical schema
-- keyed by (external_calendar_id, external_event_id) per the OpenAPI contract.
DROP TABLE IF EXISTS "external_events";
CREATE TABLE "external_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_calendar_id" uuid NOT NULL,
	"external_event_id" text NOT NULL,
	"summary" text,
	"description" text,
	"start_time" text,
	"end_time" text,
	"recurrence_rule" text,
	"location" text,
	"linked_meeting_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_events_external_calendar_id_external_event_id_unique" UNIQUE("external_calendar_id", "external_event_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "processed_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "processed_events_event_id_unique" UNIQUE("event_id")
);
