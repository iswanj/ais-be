import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ifNoneMatchContains, vesselCollectionEtag } from './etag.js';
import type { ViewportHub } from './hub.js';
import { SSE_KEEPALIVE_MS, sseComment, sseEvent, sseHeaders, writeSse } from './sse.js';
import type { VesselPosition, VesselStore, Viewport } from './types.js';
import { parseViewport, toPublicVessels } from './viewport.js';

export function registerVesselRoutes(
  app: FastifyInstance,
  store: VesselStore,
  hub: ViewportHub,
): void {
  app.get('/api/vessels', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const viewport = parseViewport((request.query as Record<string, unknown>).bbox);
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
      return { data: toPublicVessels(vessels) };
    } catch (error) {
      request.log.error({ err: error }, 'vessel query failed');
      return reply.code(503).send({ error: 'Vessel data is temporarily unavailable' });
    }
  });

  app.get('/api/vessels/stream', async (request, reply) => {
    const viewport = parseViewport((request.query as Record<string, unknown>).bbox);
    if (!viewport) {
      return reply.code(400).send({ error: 'bbox must be minLng,minLat,maxLng,maxLat within a 10-degree viewport' });
    }

    let vessels;
    try {
      vessels = await store.listInViewport(viewport);
    } catch (error) {
      request.log.error({ err: error }, 'vessel snapshot failed');
      return reply.code(503).send({ error: 'Vessel data is temporarily unavailable' });
    }

    openVesselStream(request, reply, hub, viewport, vessels);
  });
}

function openVesselStream(
  request: FastifyRequest,
  reply: FastifyReply,
  hub: ViewportHub,
  viewport: Viewport,
  vessels: VesselPosition[],
): void {
  reply.hijack();
  request.raw.setTimeout(0);
  reply.raw.writeHead(200, sseHeaders());
  writeSse(reply.raw, sseEvent('snapshot', { data: toPublicVessels(vessels) }));

  const unsubscribe = hub.subscribe(viewport, (reports) => {
    writeSse(reply.raw, sseEvent('upsert', { data: toPublicVessels(reports) }));
  });
  const heartbeat = setInterval(() => {
    if (!writeSse(reply.raw, sseComment('keepalive'))) close();
  }, SSE_KEEPALIVE_MS);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
    if (!reply.raw.writableEnded) reply.raw.end();
  };

  request.raw.on('close', close);
  request.raw.on('error', close);
}
