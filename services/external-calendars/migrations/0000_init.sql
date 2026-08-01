CREATE TABLE IF NOT EXISTS "external_calendars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"provider" text NOT NULL,
	"sync_enabled" boolean DEFAULT true NOT NULL,
	"auth_data" jsonb,
	"last_sync_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "external_events" (
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
