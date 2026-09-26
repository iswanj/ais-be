export interface VesselPosition {
  mmsi: number;
  name: string | null;
  longitude: number;
  latitude: number;
  speed: number | null;
  course: number | null;
  receivedAt: Date;
}

export interface Viewport {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

export interface VesselStore {
  upsertBatch(positions: VesselPosition[]): Promise<void>;
  listInViewport(viewport: Viewport): Promise<VesselPosition[]>;
  deleteOlderThan(cutoff: Date): Promise<number>;
}
