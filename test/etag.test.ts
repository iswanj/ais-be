import assert from 'node:assert/strict';
import test from 'node:test';
import { ifNoneMatchContains, vesselCollectionEtag } from '../src/vessels/etag.js';

test('etag changes when a vessel report time changes', () => {
  const first = { mmsi: 1, name: null, longitude: 0, latitude: 0, speed: null, course: null, receivedAt: new Date('2026-09-27T00:00:00.000Z') };
  const later = { ...first, receivedAt: new Date('2026-09-27T00:00:05.000Z') };
  assert.notEqual(vesselCollectionEtag([first]), vesselCollectionEtag([later]));
  assert.equal(vesselCollectionEtag([first, later]), vesselCollectionEtag([later, first]));
  assert.equal(ifNoneMatchContains(vesselCollectionEtag([first]), vesselCollectionEtag([first])), true);
  assert.equal(ifNoneMatchContains(`W/${vesselCollectionEtag([first])}`, vesselCollectionEtag([first])), true);
  assert.equal(ifNoneMatchContains(undefined, vesselCollectionEtag([first])), false);
});
