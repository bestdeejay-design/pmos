-- Migration 0001_init for tasks
-- Schema: tasks_
-- TODO(svc-tasks): replace stub with real DDL from schema.ts / FEATURES.md.
CREATE TABLE IF NOT EXISTS tasks_tasks_meta (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotency table (SAGA.md / ADR-004): every service has this.
CREATE TABLE IF NOT EXISTS tasks_processed_events (
  event_id UUID PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
