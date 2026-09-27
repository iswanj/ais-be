import assert from 'node:assert/strict';
import test from 'node:test';
import { ViewportHub } from '../src/vessels/hub.js';
import type { VesselPosition } from '../src/vessels/types.js';

const inside: VesselPosition = {
  mmsi: 1, name: null, longitude: 1, latitude: 1, speed: null, course: null, receivedAt: new Date(),
};
const outside: VesselPosition = { ...inside, mmsi: 2, longitude: 20, latitude: 20 };
const dateline: VesselPosition = { ...inside, mmsi: 3, longitude: 179.5, latitude: 0 };

test('sends only reports inside a subscriber viewport and stops after unsubscribe', () => {
  const hub = new ViewportHub();
  const received: VesselPosition[][] = [];
  const unsubscribe = hub.subscribe({ minLng: 0, minLat: 0, maxLng: 2, maxLat: 2 }, (reports) => {
    received.push(reports);
  });
  if (!unsubscribe) throw new Error('expected subscribe to succeed');

  hub.publish([inside, outside]);
  assert.deepEqual(received, [[inside]]);

  unsubscribe();
  hub.publish([inside]);
  assert.equal(received.length, 1);
});

test('delivers a report on either side of an antimeridian viewport', () => {
  const hub = new ViewportHub();
  const received: VesselPosition[][] = [];
  hub.subscribe({ minLng: 179, minLat: -1, maxLng: -179, maxLat: 1 }, (reports) => {
    received.push(reports);
  });
  hub.publish([dateline, outside]);
  assert.deepEqual(received, [[dateline]]);
});

test('refuses a new subscriber when the hub is full', () => {
  const hub = new ViewportHub(1);
  const first = hub.subscribe({ minLng: 0, minLat: 0, maxLng: 1, maxLat: 1 }, () => {});
  if (!first) throw new Error('expected first subscribe to succeed');
  assert.equal(hub.isFull(), true);
  assert.equal(hub.subscribe({ minLng: 0, minLat: 0, maxLng: 1, maxLat: 1 }, () => {}), null);
  first();
  assert.equal(hub.isFull(), false);
});
