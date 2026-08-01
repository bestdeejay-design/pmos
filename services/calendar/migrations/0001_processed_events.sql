-- Idempotency ledger for inbound events (SAGA.md §4: calendar consumes
-- pmos.external-calendars.external_events.created and checks processed_events
-- by event.id before mutating, so at-least-once redeliveries are skipped).
CREATE TABLE IF NOT EXISTS "processed_events" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
