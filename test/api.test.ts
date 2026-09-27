import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../src/app.js';
import type { VesselPosition, VesselStore, Viewport } from '../src/vessels/types.js';
import { parseViewport } from '../src/vessels/viewport.js';

test('validates regular and antimeridian viewports', () => {
  assert.deepEqual(parseViewport('179,-1,-179,1'), { minLng: 179, minLat: -1, maxLng: -179, maxLat: 1 });
  assert.equal(parseViewport('0,0,20,1'), null);
  assert.equal(parseViewport('0,5,1,4'), null);
  assert.equal(parseViewport('NaN,0,1,1'), null);
});

test('public API returns viewport vessels without a zoom requirement', async () => {
  const now = new Date();
  let requestedViewport: Viewport | undefined;
  const store: VesselStore = {
    async persistBatch() {},
    async listInViewport(viewport) {
      requestedViewport = viewport;
      return [{ mmsi: 123456789, name: null, longitude: 1, latitude: 2, speed: null, course: 90, receivedAt: now }];
    },
  };
  const watched: Viewport[] = [];
  const app = buildApp(store, (viewport) => { watched.push(viewport); });
  try {
    const response = await app.inject('/api/vessels?bbox=0,0,2,3');
    assert.equal(response.statusCode, 200);
    assert.deepEqual(watched, [{ minLng: 0, minLat: 0, maxLng: 2, maxLat: 3 }]);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.deepEqual(requestedViewport, { minLng: 0, minLat: 0, maxLng: 2, maxLat: 3 });
    assert.deepEqual(response.json(), { data: [{
      mmsi: 123456789, name: null, longitude: 1, latitude: 2,
      speed: null, course: 90, receivedAt: now.toISOString(),
    }] });
    assert.equal((await app.inject('/api/vessels?bbox=0,0,20,3')).statusCode, 400);
    assert.equal(watched.length, 1);
    assert.equal((await app.inject('/health')).statusCode, 200);
  } finally {
    await app.close();
  }
});
