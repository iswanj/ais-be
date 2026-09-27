import type { VesselPosition, Viewport } from './types.js';
import { viewportContains } from './viewport.js';

export type VesselListener = (reports: VesselPosition[]) => void;

export class ViewportHub {
  private readonly subscribers = new Map<symbol, { viewport: Viewport; send: VesselListener }>();

  subscribe(viewport: Viewport, send: VesselListener): () => void {
    const id = Symbol('viewport-subscriber');
    this.subscribers.set(id, { viewport, send });
    return () => { this.subscribers.delete(id); };
  }

  publish(reports: VesselPosition[]): void {
    if (reports.length === 0 || this.subscribers.size === 0) return;
    for (const { viewport, send } of this.subscribers.values()) {
      const hits = reports.filter((report) =>
        viewportContains(viewport, report.longitude, report.latitude));
      if (hits.length > 0) send(hits);
    }
  }
}
