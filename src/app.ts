import Fastify from 'fastify';
import type { ViewportHub } from './vessels/hub.js';
import type { VesselStore } from './vessels/types.js';
import { registerVesselRoutes } from './vessels/routes.js';

export function buildApp(store: VesselStore, hub: ViewportHub) {
  const app = Fastify({ logger: true });

  app.get('/health', async () => ({ status: 'ok' }));
  registerVesselRoutes(app, store, hub);

  return app;
}
