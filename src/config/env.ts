export type BoundingBox = [[number, number], [number, number]];

export interface Config {
  aisstreamApiKey: string;
  aisBoundingBoxes: BoundingBox[];
  databaseUrl: string;
  port: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const aisstreamApiKey = env.AISSTREAM_API_KEY?.trim();
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!aisstreamApiKey) throw new Error('AISSTREAM_API_KEY is required');
  if (!databaseUrl) throw new Error('DATABASE_URL is required');

  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL must be a PostgreSQL connection URL');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('DATABASE_URL must be a PostgreSQL connection URL');
  }

  let boxes: unknown;
  try {
    boxes = JSON.parse(env.AIS_BOUNDING_BOXES ?? '');
  } catch {
    throw new Error('AIS_BOUNDING_BOXES must be a JSON array of latitude/longitude corner pairs');
  }
  if (!Array.isArray(boxes) || boxes.length === 0 || !boxes.every(isBoundingBox)) {
    throw new Error('AIS_BOUNDING_BOXES must contain valid non-empty latitude/longitude boxes');
  }

  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer from 1 to 65535');
  }

  return { aisstreamApiKey, databaseUrl, aisBoundingBoxes: boxes, port };
}

function isBoundingBox(value: unknown): value is BoundingBox {
  if (!Array.isArray(value) || value.length !== 2) return false;
  const [northWest, southEast] = value;
  if (!isCorner(northWest) || !isCorner(southEast)) return false;
  return northWest[0] > southEast[0] && northWest[1] < southEast[1];
}

function isCorner(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 &&
    typeof value[0] === 'number' && Number.isFinite(value[0]) && value[0] >= -90 && value[0] <= 90 &&
    typeof value[1] === 'number' && Number.isFinite(value[1]) && value[1] >= -180 && value[1] <= 180;
}
