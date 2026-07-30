-- Migration 0001_init for calendar
-- Schema: calendar_
-- TODO(svc-calendar): replace stub with real DDL from schema.ts / FEATURES.md.
CREATE TABLE IF NOT EXISTS calendar_calendar_meta (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotency table (SAGA.md / ADR-004): every service has this.
CREATE TABLE IF NOT EXISTS calendar_processed_events (
  event_id UUID PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
