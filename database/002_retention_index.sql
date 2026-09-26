-- Run after 001_init.sql. Helps the API's two-minute freshness filter.
CREATE INDEX IF NOT EXISTS vessel_latest_received_at_idx
  ON app.vessel_latest (received_at);
