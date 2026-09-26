import type { Viewport } from './types.js';

export function parseViewport(value: unknown): Viewport | null {
  if (typeof value !== 'string') return null;
  const parts = value.split(',');
  if (parts.length !== 4 || parts.some((part) => part.trim() === '')) return null;
  const [minLng, minLat, maxLng, maxLat] = parts.map(Number);
  if (![minLng, minLat, maxLng, maxLat].every(Number.isFinite)) return null;
  if (minLng < -180 || minLng > 180 || maxLng < -180 || maxLng > 180 ||
      minLat < -90 || minLat > 90 || maxLat < -90 || maxLat > 90 || minLat >= maxLat) return null;

  const longitudeSpan = minLng < maxLng ? maxLng - minLng : 360 - minLng + maxLng;
  if (longitudeSpan <= 0 || longitudeSpan > 10 || maxLat - minLat > 10) return null;
  return { minLng, minLat, maxLng, maxLat };
}
