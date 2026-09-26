import type { VesselPosition } from '../vessels/types.js';

export function parsePositionReport(value: unknown, receivedAt: Date): VesselPosition | null {
  if (!isRecord(value) || value.MessageType !== 'PositionReport') return null;
  const message = isRecord(value.Message) ? value.Message.PositionReport : null;
  if (!isRecord(message) || message.Valid !== true || !isMmsi(message.UserID)) return null;

  const metadata = isRecord(value.MetaData) ? value.MetaData : null;
  if (metadata?.MMSI !== undefined && metadata.MMSI !== message.UserID) return null;

  const latitude = coordinate(message.Latitude, metadata?.Latitude, -90, 90);
  const longitude = coordinate(message.Longitude, metadata?.Longitude, -180, 180);
  if (latitude === null || longitude === null) return null;

  const rawName = metadata?.ShipName;
  const name = typeof rawName === 'string' ? rawName.trim().slice(0, 100) || null : null;
  return {
    mmsi: message.UserID,
    name,
    latitude,
    longitude,
    speed: finiteRange(message.Sog, 0, 102.3),
    course: finiteRange(message.Cog, 0, 360),
    receivedAt,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMmsi(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 999_999_999;
}

function coordinate(primary: unknown, fallback: unknown, min: number, max: number): number | null {
  const value = primary === undefined || primary === null ? fallback : primary;
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null;
}

function finiteRange(value: unknown, min: number, exclusiveMax: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value < exclusiveMax
    ? value : null;
}
