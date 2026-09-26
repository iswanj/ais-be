import assert from 'node:assert/strict';
import test from 'node:test';
import { WebSocketServer } from 'ws';
import { buildApp } from '../src/app.js';
import { BatchWriter } from '../src/ais/batch-writer.js';
import { AisStreamClient } from '../src/ais/stream-client.js';
import type { VesselPosition, VesselStore } from '../src/vessels/types.js';

test('subscribes, accepts positions, and reconnects after a close', async () => {
  const server = new WebSocketServer({ port: 0 });
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (typeof address === 'string' || !address) throw new Error('mock server has no port');
  const positions: VesselPosition[] = [];
  const saved: VesselPosition[] = [];
  const subscriptions: unknown[] = [];
  let connections = 0;
  server.on('connection', (socket) => {
    connections++;
    socket.once('message', (data) => {
      subscriptions.push(JSON.parse(data.toString()) as unknown);
      socket.send(JSON.stringify({ MessageType: 'SubscriptionConfirmation', Message: { CompressionEnabled: true } }));
      socket.send(JSON.stringify({
        MessageType: 'PositionReport',
        MetaData: { MMSI: 123456789, Latitude: 1, Longitude: 2 },
        Message: { PositionReport: { UserID: 123456789, Valid: true, Sog: 3, Cog: 4 } },
      }));
      if (connections === 1) setTimeout(() => socket.close(), 20);
    });
  });
  const store: VesselStore = {
    async upsertBatch(batch) { saved.push(...batch); },
    async listInViewport() { return saved; },
    async deleteOlderThan() { return 0; },
  };
  const app = buildApp(store);
  const writer = new BatchWriter(store, app.log);
  const client = new AisStreamClient(
    'test-key', [[[2, 1], [0, 3]]], { enqueue: (position) => { positions.push(position); writer.enqueue(position); } },
    app.log, `ws://127.0.0.1:${address.port}`, 10,
  );
  try {
    writer.start();
    client.start();
    await waitUntil(() => subscriptions.length === 2 && positions.length === 2, 2_000);
    await waitUntil(() => saved.length > 0, 1_000);
    assert.deepEqual(subscriptions[0], {
      APIKey: 'test-key', BoundingBoxes: [[[2, 1], [0, 3]]], FilterMessageTypes: ['PositionReport'],
    });
    assert.equal(positions[0]?.mmsi, 123456789);
    assert.equal(positions[1]?.mmsi, 123456789);
    const response = await app.inject('/api/vessels?bbox=1,0,3,2');
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().data[0]?.mmsi, 123456789);
    assert.ok(Date.now() - saved[0]!.receivedAt.getTime() < 1_000, 'stream-to-API delay exceeded one second');
  } finally {
    await client.stop();
    await writer.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await app.close();
  }
});

async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for stream');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
