-- Run after 001_init.sql. Supports periodic cleanup of old latest-position rows.
CREATE INDEX IF NOT EXISTS vessel_latest_received_at_idx
  ON app.vessel_latest (received_at);
