import type { FastifyInstance } from 'fastify';
import { ifNoneMatchContains, vesselCollectionEtag } from './etag.js';
import type { VesselStore } from './types.js';
import { parseViewport } from './viewport.js';

export function registerVesselRoutes(app: FastifyInstance, store: VesselStore): void {
  app.get('/api/vessels', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const query = request.query as Record<string, unknown>;
    const viewport = parseViewport(query.bbox);
    if (!viewport) {
      return reply.code(400).send({ error: 'bbox must be minLng,minLat,maxLng,maxLat within a 10-degree viewport' });
    }

    try {
      const vessels = await store.listInViewport(viewport);
      const etag = vesselCollectionEtag(vessels);
      reply.header('ETag', etag);
      if (ifNoneMatchContains(request.headers['if-none-match'], etag)) {
        return reply.code(304).send();
      }
      return { data: vessels.map(({ receivedAt, ...position }) => ({
        ...position, receivedAt: receivedAt.toISOString(),
      })) };
    } catch (error) {
      request.log.error({ err: error }, 'vessel query failed');
      return reply.code(503).send({ error: 'Vessel data is temporarily unavailable' });
    }
  });
}
