import assert from 'node:assert/strict';
import test from 'node:test';
import { Pool } from 'pg';
import { PostgresVesselStore } from '../src/vessels/repository.js';
import type { VesselPosition } from '../src/vessels/types.js';

test('PostGIS keeps one latest row per vessel and serves only fresh viewport positions', {
  skip: !process.env.TEST_DATABASE_URL && 'Set TEST_DATABASE_URL to an empty disposable PostGIS database',
}, async () => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 2 });
  const store = new PostgresVesselStore(pool);
  const ids = [999999991, 999999992, 999999993, 999999994];
  let safeToCleanup = false;
  try {
    const count = await pool.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM app.vessel_latest');
    assert.equal(Number(count.rows[0]?.count), 0, 'TEST_DATABASE_URL must point to an empty disposable database');
    safeToCleanup = true;
    const now = new Date();
    const point = (mmsi: number, longitude: number, receivedAt: Date, name: string | null): VesselPosition => ({
      mmsi, name, longitude, latitude: 0, speed: 10, course: 45, receivedAt,
    });
    await store.persistBatch([
      point(ids[0], 179.4, now, 'TEST VESSEL'),
      point(ids[0], 179.5, new Date(now.getTime() + 1), null),
      point(ids[1], -179.5, now, null),
      point(ids[2], 179.7, new Date(now.getTime() - 3 * 60_000), null),
      point(ids[3], 179.8, new Date(now.getTime() - 25 * 60 * 60_000), null),
    ]);
    const newer = point(ids[0], 179.6, new Date(now.getTime() + 1_000), null);
    await store.persistBatch([newer]);
    await store.persistBatch([point(ids[0], 178.0, new Date(now.getTime() - 1_000), 'OLDER')]);
    await store.persistBatch([newer]);

    const crossing = await store.listInViewport({ minLng: 179, minLat: -1, maxLng: -179, maxLat: 1 });
    assert.deepEqual(crossing.map((row) => row.mmsi).sort(), [ids[0], ids[1]]);
    const updated = crossing.find((row) => row.mmsi === ids[0]);
    assert.equal(updated?.longitude, 179.6);
    assert.equal(updated?.name, 'TEST VESSEL');
    assert.deepEqual(await store.listInViewport({ minLng: 178, minLat: -1, maxLng: 179, maxLat: 1 }), []);
    const persisted = await pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM app.vessel_latest WHERE mmsi = ANY($1::bigint[])', [ids],
    );
    assert.equal(Number(persisted.rows[0]?.count), 4, 'stale latest positions remain stored');
  } finally {
    if (safeToCleanup) {
      await pool.query('DELETE FROM app.vessel_latest WHERE mmsi = ANY($1::bigint[])', [ids]);
    }
    await pool.end();
  }
});
