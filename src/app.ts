import Fastify from 'fastify';
import type { VesselStore } from './vessels/types.js';
import { registerVesselRoutes } from './vessels/routes.js';

export function buildApp(store: VesselStore) {
  const app = Fastify({ logger: true });

  app.get('/health', async () => ({ status: 'ok' }));
  registerVesselRoutes(app, store);

  return app;
}
