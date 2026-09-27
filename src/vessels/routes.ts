import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ifNoneMatchContains, vesselCollectionEtag } from './etag.js';
import type { ViewportHub } from './hub.js';
import { SSE_KEEPALIVE_MS, sseComment, sseEvent, sseHeaders, writeSse } from './sse.js';
import type { VesselPosition, VesselStore } from './types.js';
import { parseViewport, toPublicVessels } from './viewport.js';

const VIEWER_LIMIT_MESSAGE = 'Too many live viewers; try again shortly';

export function registerVesselRoutes(
  app: FastifyInstance,
  store: VesselStore,
  hub: ViewportHub,
): void {
  const streams = new Set<() => void>();
  app.addHook('onClose', async () => {
    for (const close of streams) close();
    streams.clear();
  });

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
    if (hub.isFull()) {
      return reply.code(503).send({ error: VIEWER_LIMIT_MESSAGE });
    }

    let vessels;
    try {
      vessels = await store.listInViewport(viewport);
    } catch (error) {
      request.log.error({ err: error }, 'vessel snapshot failed');
      return reply.code(503).send({ error: 'Vessel data is temporarily unavailable' });
    }

    const unsubscribe = hub.subscribe(viewport, (reports) => {
      writeSse(reply.raw, sseEvent('upsert', { data: toPublicVessels(reports) }));
    });
    if (!unsubscribe) {
      return reply.code(503).send({ error: VIEWER_LIMIT_MESSAGE });
    }

    openVesselStream(request, reply, streams, unsubscribe, vessels);
  });
}

function openVesselStream(
  request: FastifyRequest,
  reply: FastifyReply,
  streams: Set<() => void>,
  unsubscribe: () => void,
  vessels: VesselPosition[],
): void {
  reply.hijack();
  request.raw.setTimeout(0);
  reply.raw.writeHead(200, sseHeaders());
  writeSse(reply.raw, sseEvent('snapshot', { data: toPublicVessels(vessels) }));

  const heartbeat = setInterval(() => {
    if (!writeSse(reply.raw, sseComment('keepalive'))) close();
  }, SSE_KEEPALIVE_MS);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
    streams.delete(close);
    if (!reply.raw.writableEnded) reply.raw.end();
    if (!request.raw.destroyed) request.raw.destroy();
  };

  streams.add(close);
  request.raw.on('close', close);
  request.raw.on('error', close);
}
