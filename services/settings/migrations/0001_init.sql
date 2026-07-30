-- Migration 0001_init for settings
-- Schema: settings_
-- TODO(svc-settings): replace stub with real DDL from schema.ts / FEATURES.md.
CREATE TABLE IF NOT EXISTS settings_settings_meta (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotency table (SAGA.md / ADR-004): every service has this.
CREATE TABLE IF NOT EXISTS settings_processed_events (
  event_id UUID PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
