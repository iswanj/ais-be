import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../src/app.js';
import { BatchWriter } from '../src/ais/batch-writer.js';
import type { VesselPosition, VesselStore } from '../src/vessels/types.js';

test('coalesces updates by MMSI and writes within the flush interval', async () => {
  const batches: VesselPosition[][] = [];
  const store: VesselStore = {
    async upsertBatch(positions) { batches.push(positions); },
    async listInViewport() { return []; },
    async deleteOlderThan() { return 0; },
  };
  const app = buildApp(store);
  const writer = new BatchWriter(store, app.log);
  const first = { mmsi: 123456789, name: null, longitude: 1, latitude: 2, speed: 1, course: 90, receivedAt: new Date() };
  const newer = { ...first, longitude: 3, receivedAt: new Date(first.receivedAt.getTime() + 1) };
  try {
    writer.start();
    writer.enqueue(first);
    writer.enqueue(newer);
    await waitUntil(() => batches.length > 0, 750);
    assert.equal(batches.length, 1);
    assert.deepEqual(batches[0], [newer]);
  } finally {
    await writer.stop();
    await app.close();
  }
});

test('retries a failed batch without replacing a newer pending position', async () => {
  const saved: VesselPosition[] = [];
  let calls = 0;
  const store: VesselStore = {
    async upsertBatch(positions) {
      calls++;
      if (calls === 1) throw new Error('temporary database failure');
      saved.push(...positions);
    },
    async listInViewport() { return []; },
    async deleteOlderThan() { return 0; },
  };
  const app = buildApp(store);
  const writer = new BatchWriter(store, app.log);
  const old = { mmsi: 123456789, name: null, longitude: 1, latitude: 2, speed: null, course: null, receivedAt: new Date() };
  const newer = { ...old, longitude: 3, receivedAt: new Date(old.receivedAt.getTime() + 1) };
  try {
    writer.enqueue(old);
    await writer.flush();
    writer.enqueue(newer);
    await writer.flush(true);
    assert.deepEqual(saved, [newer]);
  } finally {
    await writer.stop();
    await app.close();
  }
});

async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for batch');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
