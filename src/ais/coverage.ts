import type { BoundingBox } from '../config/env.js';
import type { Viewport } from '../vessels/types.js';

const MAX_LOCATIONS = 3;

interface WatchedLocation {
  viewport: Viewport;
  requestedAt: number;
}

export class ViewportCoverage {
  private readonly locations: WatchedLocation[];

  constructor(seed: BoundingBox[], private readonly maxLocations = MAX_LOCATIONS) {
    this.locations = seed.slice(0, maxLocations).map((box) => ({
      viewport: boundingBoxToViewport(box),
      requestedAt: 0,
    }));
  }

  boxes(): BoundingBox[] {
    return this.locations.flatMap((location) => viewportToBoundingBoxes(location.viewport));
  }

  watch(viewport: Viewport, requestedAt = Date.now()): boolean {
    const next = copyViewport(viewport);
    const match = bestOverlap(this.locations, next);
    if (match) {
      match.requestedAt = requestedAt;
      if (sameViewport(match.viewport, next)) return false;
      match.viewport = next;
      return true;
    }

    this.locations.push({ viewport: next, requestedAt });
    while (this.locations.length > this.maxLocations) {
      let oldestIndex = 0;
      for (let index = 1; index < this.locations.length; index++) {
        const location = this.locations[index];
        const oldest = this.locations[oldestIndex];
        if (location && oldest && location.requestedAt < oldest.requestedAt) oldestIndex = index;
      }
      this.locations.splice(oldestIndex, 1);
    }
    return true;
  }
}

export function viewportToBoundingBoxes(viewport: Viewport): BoundingBox[] {
  if (viewport.minLng <= viewport.maxLng) {
    return [[[viewport.maxLat, viewport.minLng], [viewport.minLat, viewport.maxLng]]];
  }
  return [
    [[viewport.maxLat, viewport.minLng], [viewport.minLat, 180]],
    [[viewport.maxLat, -180], [viewport.minLat, viewport.maxLng]],
  ];
}

function boundingBoxToViewport(box: BoundingBox): Viewport {
  const [northWest, southEast] = box;
  return { minLng: northWest[1], minLat: southEast[0], maxLng: southEast[1], maxLat: northWest[0] };
}

function copyViewport(viewport: Viewport): Viewport {
  return { minLng: viewport.minLng, minLat: viewport.minLat, maxLng: viewport.maxLng, maxLat: viewport.maxLat };
}

function sameViewport(left: Viewport, right: Viewport): boolean {
  return left.minLng === right.minLng && left.minLat === right.minLat &&
    left.maxLng === right.maxLng && left.maxLat === right.maxLat;
}

function bestOverlap(locations: WatchedLocation[], viewport: Viewport): WatchedLocation | undefined {
  let best: WatchedLocation | undefined;
  let bestArea = 0;
  for (const location of locations) {
    const area = overlapArea(location.viewport, viewport);
    if (area > bestArea) {
      best = location;
      bestArea = area;
    }
  }
  return best;
}

function overlapArea(left: Viewport, right: Viewport): number {
  const latitude = Math.min(left.maxLat, right.maxLat) - Math.max(left.minLat, right.minLat);
  if (latitude <= 0) return 0;
  let longitude = 0;
  for (const leftRange of longitudeRanges(left)) {
    for (const rightRange of longitudeRanges(right)) {
      const width = Math.min(leftRange[1], rightRange[1]) - Math.max(leftRange[0], rightRange[0]);
      if (width > 0) longitude += width;
    }
  }
  return latitude * longitude;
}

function longitudeRanges(viewport: Viewport): Array<[number, number]> {
  if (viewport.minLng <= viewport.maxLng) return [[viewport.minLng, viewport.maxLng]];
  return [[viewport.minLng, 180], [-180, viewport.maxLng]];
}
