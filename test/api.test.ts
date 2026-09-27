import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../src/app.js';
import type { VesselPosition, VesselStore, Viewport } from '../src/vessels/types.js';
import { parseViewport } from '../src/vessels/viewport.js';
import { ViewportHub } from '../src/vessels/hub.js';

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
  const app = buildApp(store, new ViewportHub());
  try {
    const response = await app.inject('/api/vessels?bbox=0,0,2,3');
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.deepEqual(requestedViewport, { minLng: 0, minLat: 0, maxLng: 2, maxLat: 3 });
    assert.deepEqual(response.json(), { data: [{
      mmsi: 123456789, name: null, longitude: 1, latitude: 2,
      speed: null, course: 90, receivedAt: now.toISOString(),
    }] });
    assert.equal((await app.inject('/api/vessels?bbox=0,0,20,3')).statusCode, 400);
    assert.equal((await app.inject('/api/vessels/stream?bbox=0,0,20,3')).statusCode, 400);
    assert.equal((await app.inject('/health')).statusCode, 200);
    assert.equal((await app.inject('/ready')).statusCode, 200);

    const etag = response.headers.etag;
    assert.equal(typeof etag, 'string');
    const unchanged = await app.inject({
      url: '/api/vessels?bbox=0,0,2,3',
      headers: { 'if-none-match': String(etag) },
    });
    assert.equal(unchanged.statusCode, 304);
    assert.equal(unchanged.body, '');
  } finally {
    await app.close();
  }
});

test('vessel stream sends a snapshot from the viewport query', async () => {
  const now = new Date();
  let snapshots = 0;
  const store: VesselStore = {
    async persistBatch() {},
    async listInViewport() {
      snapshots++;
      return [{ mmsi: 123456789, name: null, longitude: 1, latitude: 2, speed: null, course: 90, receivedAt: now }];
    },
  };
  const app = buildApp(store, new ViewportHub());
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('no listening port');
  const controller = new AbortController();
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/vessels/stream?bbox=0,0,2,3`, {
      signal: controller.signal,
    });
    assert.equal(response.status, 200);
    assert.match(String(response.headers.get('content-type')), /text\/event-stream/);
    const reader = response.body?.getReader();
    if (!reader) throw new Error('stream has no body');
    const decoder = new TextDecoder();
    let buffer = '';
    while (!buffer.includes('event: snapshot')) {
      const { done, value } = await reader.read();
      if (done) throw new Error('stream ended before snapshot');
      buffer += decoder.decode(value, { stream: true });
    }
    assert.match(buffer, /123456789/);
    assert.equal(snapshots, 1);
  } finally {
    controller.abort();
    await app.close();
  }
});

test('health and ready fail when the database ping fails', async () => {
  const store: VesselStore = {
    async persistBatch() {},
    async listInViewport() { return []; },
  };
  const app = buildApp(store, new ViewportHub(), async () => {
    throw new Error('database down');
  });
  try {
    assert.equal((await app.inject('/health')).statusCode, 503);
    assert.equal((await app.inject('/ready')).statusCode, 503);
  } finally {
    await app.close();
  }
});

test('rejects a new stream when the hub is full', async () => {
  const store: VesselStore = {
    async persistBatch() {},
    async listInViewport() { return []; },
  };
  const app = buildApp(store, new ViewportHub(0));
  try {
    const response = await app.inject('/api/vessels/stream?bbox=0,0,2,3');
    assert.equal(response.statusCode, 503);
  } finally {
    await app.close();
  }
});

test('drops stream subscribers when the app shuts down', async () => {
  const store: VesselStore = {
    async persistBatch() {},
    async listInViewport() { return []; },
  };
  const hub = new ViewportHub();
  const app = buildApp(store, hub);
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('no listening port');
  const controller = new AbortController();
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/vessels/stream?bbox=0,0,2,3`, {
      signal: controller.signal,
    });
    assert.equal(response.status, 200);
    const reader = response.body?.getReader();
    if (!reader) throw new Error('stream has no body');
    const decoder = new TextDecoder();
    let buffer = '';
    while (!buffer.includes('event: snapshot')) {
      const { done, value } = await reader.read();
      if (done) throw new Error('stream ended before snapshot');
      buffer += decoder.decode(value, { stream: true });
    }
    assert.equal(hub.size, 1);
  } finally {
    await app.close();
    controller.abort();
  }
  assert.equal(hub.size, 0);
});
