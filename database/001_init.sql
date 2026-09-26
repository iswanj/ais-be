-- Run in the Supabase SQL Editor on a new project.
-- PostGIS lives in gis; application data lives in app, outside the Data API's
-- default exposed public schema.
CREATE SCHEMA IF NOT EXISTS gis;
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA gis;

CREATE SCHEMA IF NOT EXISTS app;

CREATE TABLE IF NOT EXISTS app.vessel_latest (
  mmsi BIGINT PRIMARY KEY,
  name TEXT,
  location gis.geometry(Point, 4326) NOT NULL,
  sog REAL,
  cog REAL,
  received_at TIMESTAMPTZ NOT NULL
);

-- No anon/authenticated policies: only the backend's direct Postgres connection
-- should read or write this table.
ALTER TABLE app.vessel_latest ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS vessel_latest_location_gist
  ON app.vessel_latest USING GIST (location);
