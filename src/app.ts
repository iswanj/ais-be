import Fastify, { type FastifyReply } from 'fastify';
import type { ViewportHub } from './vessels/hub.js';
import type { VesselStore } from './vessels/types.js';
import { registerVesselRoutes } from './vessels/routes.js';

export function buildApp(
  store: VesselStore,
  hub: ViewportHub,
  ping?: () => Promise<void>,
) {
  const app = Fastify({
    logger: true,
    // SSE connections must not be killed by a server-wide request timeout.
    requestTimeout: 0,
    connectionTimeout: 0,
    bodyLimit: 16 * 1024,
    forceCloseConnections: true,
  });

  const checkReady = async (reply: FastifyReply) => {
    if (!ping) return { status: 'ok' as const };
    try {
      await ping();
      return { status: 'ok' as const };
    } catch (error) {
      app.log.error({ err: error }, 'readiness check failed');
      return reply.code(503).send({ status: 'unhealthy' });
    }
  };

  app.get('/health', async (_request, reply) => checkReady(reply));
  app.get('/ready', async (_request, reply) => checkReady(reply));
  registerVesselRoutes(app, store, hub);

  return app;
}
