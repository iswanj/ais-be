import type { FastifyInstance } from 'fastify';
import type { VesselStore, Viewport } from './types.js';
import { parseViewport } from './viewport.js';

export function registerVesselRoutes(
  app: FastifyInstance,
  store: VesselStore,
  onViewport?: (viewport: Viewport) => void,
): void {
  app.get('/api/vessels', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const query = request.query as Record<string, unknown>;
    const viewport = parseViewport(query.bbox);
    if (!viewport) {
      return reply.code(400).send({ error: 'bbox must be minLng,minLat,maxLng,maxLat within a 10-degree viewport' });
    }

    try {
      onViewport?.(viewport);
    } catch (error) {
      request.log.error({ err: error }, 'viewport coverage update failed');
    }

    try {
      const vessels = await store.listInViewport(viewport);
      return { data: vessels.map(({ receivedAt, ...position }) => ({
        ...position, receivedAt: receivedAt.toISOString(),
      })) };
    } catch (error) {
      request.log.error({ err: error }, 'vessel query failed');
      return reply.code(503).send({ error: 'Vessel data is temporarily unavailable' });
    }
  });
}
