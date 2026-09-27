import Fastify from 'fastify';
import type { VesselStore, Viewport } from './vessels/types.js';
import { registerVesselRoutes } from './vessels/routes.js';

export function buildApp(store: VesselStore, onViewport?: (viewport: Viewport) => void) {
  const app = Fastify({ logger: true });

  app.get('/health', async () => ({ status: 'ok' }));
  registerVesselRoutes(app, store, onViewport);

  return app;
}
