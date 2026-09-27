import { createHash } from 'node:crypto';
import type { VesselPosition } from './types.js';

export function vesselCollectionEtag(vessels: VesselPosition[]): string {
  const digest = vessels
    .map((vessel) => `${vessel.mmsi}:${vessel.receivedAt.toISOString()}`)
    .sort()
    .join('|');
  const hash = createHash('sha1').update(digest).digest('hex').slice(0, 16);
  return `"${hash}-${vessels.length}"`;
}

export function ifNoneMatchContains(header: unknown, etag: string): boolean {
  if (typeof header !== 'string' || header.trim() === '') return false;
  return header.split(',').some((part) => normalizeEtag(part) === normalizeEtag(etag));
}

function normalizeEtag(value: string): string {
  return value.trim().replace(/^W\//, '');
}
