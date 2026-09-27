import assert from 'node:assert/strict';
import test from 'node:test';
import { ViewportCoverage, viewportToBoundingBoxes } from '../src/ais/coverage.js';
import type { Viewport } from '../src/vessels/types.js';

const miami: Viewport = { minLng: -80.208, minLat: 25.603, maxLng: -79.879, maxLat: 25.835 };

test('keeps the three most recent distinct viewports and refreshes an overlapping one', () => {
  const coverage = new ViewportCoverage([[[25.835, -80.208], [25.603, -79.879]]]);
  assert.deepEqual(coverage.boxes(), [[[25.835, -80.208], [25.603, -79.879]]]);

  assert.equal(coverage.watch(miami, 1), false);

  const singapore: Viewport = { minLng: 103.6, minLat: 1.2, maxLng: 103.9, maxLat: 1.3 };
  const rotterdam: Viewport = { minLng: 4, minLat: 51.85, maxLng: 4.2, maxLat: 51.95 };
  const tokyo: Viewport = { minLng: 139.7, minLat: 35.6, maxLng: 139.9, maxLat: 35.7 };
  assert.equal(coverage.watch(singapore, 2), true);
  assert.equal(coverage.watch(rotterdam, 3), true);
  assert.equal(coverage.watch(tokyo, 4), true);

  assert.deepEqual(coverage.boxes(), [
    ...viewportToBoundingBoxes(singapore),
    ...viewportToBoundingBoxes(rotterdam),
    ...viewportToBoundingBoxes(tokyo),
  ]);

  const movedSingapore: Viewport = { minLng: 103.7, minLat: 1.22, maxLng: 104, maxLat: 1.32 };
  assert.equal(coverage.watch(movedSingapore, 5), true);
  assert.equal(coverage.watch(movedSingapore, 6), false);
  assert.deepEqual(coverage.boxes(), [
    ...viewportToBoundingBoxes(movedSingapore),
    ...viewportToBoundingBoxes(rotterdam),
    ...viewportToBoundingBoxes(tokyo),
  ]);
});

test('drops the least recently requested viewport rather than the oldest insertion', () => {
  const coverage = new ViewportCoverage([[[25.835, -80.208], [25.603, -79.879]]]);
  const first: Viewport = { minLng: 10, minLat: 0, maxLng: 11, maxLat: 1 };
  const second: Viewport = { minLng: 20, minLat: 0, maxLng: 21, maxLat: 1 };
  const third: Viewport = { minLng: 30, minLat: 0, maxLng: 31, maxLat: 1 };
  const fourth: Viewport = { minLng: 40, minLat: 0, maxLng: 41, maxLat: 1 };
  coverage.watch(first, 1);
  coverage.watch(second, 2);
  coverage.watch(first, 3);
  coverage.watch(third, 4);
  coverage.watch(fourth, 5);

  assert.deepEqual(coverage.boxes(), [
    ...viewportToBoundingBoxes(first),
    ...viewportToBoundingBoxes(third),
    ...viewportToBoundingBoxes(fourth),
  ]);
});

test('splits a viewport across the antimeridian into two provider boxes', () => {
  assert.deepEqual(viewportToBoundingBoxes({ minLng: 179, minLat: -1, maxLng: -179, maxLat: 1 }), [
    [[1, 179], [-1, 180]],
    [[1, -180], [-1, -179]],
  ]);
});
