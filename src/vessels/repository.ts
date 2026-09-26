import type { Pool } from 'pg';
import type { VesselPosition, VesselStore, Viewport } from './types.js';

interface VesselRow {
  mmsi: string;
  name: string | null;
  longitude: number;
  latitude: number;
  speed: number | null;
  course: number | null;
  received_at: Date;
}

export class PostgresVesselStore implements VesselStore {
  constructor(private readonly pool: Pool) {}

  async persistBatch(reports: VesselPosition[]): Promise<void> {
    if (reports.length === 0) return;
    const latestByMmsi = new Map<number, {
      mmsi: number; name: string | null; longitude: number; latitude: number;
      sog: number | null; cog: number | null; received_at: string;
    }>();
    for (const report of reports) {
      const previous = latestByMmsi.get(report.mmsi);
      latestByMmsi.set(report.mmsi, {
        mmsi: report.mmsi,
        name: report.name ?? previous?.name ?? null,
        longitude: report.longitude,
        latitude: report.latitude,
        sog: report.speed,
        cog: report.course,
        received_at: report.receivedAt.toISOString(),
      });
    }
    await this.pool.query(`
      INSERT INTO app.vessel_latest AS existing (mmsi, name, location, sog, cog, received_at)
      SELECT incoming.mmsi, incoming.name,
        gis.ST_SetSRID(gis.ST_MakePoint(incoming.longitude, incoming.latitude), 4326),
        incoming.sog, incoming.cog, incoming.received_at
      FROM jsonb_to_recordset($1::jsonb) AS incoming(
        mmsi bigint, name text, longitude double precision, latitude double precision,
        sog real, cog real, received_at timestamptz
      )
      ON CONFLICT (mmsi) DO UPDATE SET
        name = COALESCE(EXCLUDED.name, existing.name),
        location = EXCLUDED.location,
        sog = EXCLUDED.sog,
        cog = EXCLUDED.cog,
        received_at = EXCLUDED.received_at
      WHERE existing.received_at <= EXCLUDED.received_at
    `, [JSON.stringify([...latestByMmsi.values()])]);
  }

  async listInViewport(viewport: Viewport): Promise<VesselPosition[]> {
    const crossesAntimeridian = viewport.minLng > viewport.maxLng;
    const spatialFilter = crossesAntimeridian ? `(
      gis.ST_Intersects(location, gis.ST_MakeEnvelope($1, $2, 180, $4, 4326)) OR
      gis.ST_Intersects(location, gis.ST_MakeEnvelope(-180, $2, $3, $4, 4326))
    )` : 'gis.ST_Intersects(location, gis.ST_MakeEnvelope($1, $2, $3, $4, 4326))';
    const result = await this.pool.query<VesselRow>(`
      SELECT mmsi::text AS mmsi, name,
        gis.ST_X(location) AS longitude, gis.ST_Y(location) AS latitude,
        sog AS speed, cog AS course, received_at
      FROM app.vessel_latest
      WHERE received_at >= NOW() - INTERVAL '2 minutes'
        AND ${spatialFilter}
    `, [viewport.minLng, viewport.minLat, viewport.maxLng, viewport.maxLat]);
    return result.rows.map((row) => ({
      mmsi: Number(row.mmsi), name: row.name, longitude: row.longitude, latitude: row.latitude,
      speed: row.speed, course: row.course, receivedAt: row.received_at,
    }));
  }

}
