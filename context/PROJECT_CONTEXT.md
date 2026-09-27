# AIS Vessel Viewer — Backend Project Context

## Goal

Build the backend for an AIS vessel viewer that consumes `PositionReport` messages from aisstream.io, persists the latest position per vessel in PostGIS, and serves fresh positions inside a mobile map viewport. A React Native client using Mapbox Maps SDK will poll the API and display directional vessel markers.

The challenge prioritizes a simple implementation that remains useful with approximately 30,000 vessels and many simultaneous map viewers. A report received by the backend should appear on an active map within 10 seconds. The map must never show positions older than 2 minutes and must show vessels only at zoom level 12 or higher.

## MVP scope

- Ingest only aisstream.io `PositionReport` messages.
- Keep one durable latest-position record per MMSI in PostgreSQL with PostGIS.
- Expose fresh positions for the requested viewport through a REST API.
- Keep the aisstream.io API key on the backend.
- Recover the stream connection after interruptions without losing already persisted positions.
- Support a demonstration of ingestion, map updates, freshness, and persistence after a backend restart.

Vessel type, flag, and static vessel details are outside the MVP. `PositionReport` and its envelope do not supply all static vessel metadata.

## Architecture

```text
aisstream.io WebSocket (PositionReport only)
    -> one ingestion worker
    -> short report batch
    -> upsert vessel_latest
    -> Fastify viewport API
    -> Mapbox React Native client (5-second polling while active)
```

Node.js, TypeScript, and Fastify serve the API. A single long-lived WebSocket consumer runs alongside the API for the initial one-instance deployment. If the API is later scaled to multiple instances, run the consumer as a separate singleton worker so replicas do not open duplicate provider subscriptions.

### Ingestion

1. Open `wss://stream.aisstream.io/v0/stream` with `permessage-deflate` enabled.
2. Send a complete subscription within 3 seconds, including the server-side API key, the `AIS_BOUNDING_BOXES` coverage, and `FilterMessageTypes: ["PositionReport"]`. Use one worldwide box, `[[[90,-180],[-90,180]]]`, so every viewer can query any area from the same stored data. The provider subscription uses **latitude, longitude** corner pairs; the client API uses **longitude, latitude** bounding-box values.
3. Read and decode WebSocket frames continuously. Ignore subscription confirmations and other message types.
4. For each `PositionReport`, validate the MMSI, `Valid` flag, finite latitude and longitude, and coordinate ranges. Read COG and SOG when valid; treat unavailable course as unknown rather than inventing a direction. Use the envelope's ship name when supplied.
5. Record `received_at` as the UTC time the backend receives the valid message. Queue every accepted report, then flush batches every 250 ms. Upsert only the newest report per MMSI into the latest-position table. The AIS report's `Timestamp` is a second within a minute and is not a full event timestamp for freshness checks.
6. Reconnect with exponential backoff and jitter after disconnection, then send a new complete subscription. Log connection state and ingestion errors without exposing the API key.

The provider does not promise durable replay. A restart retains rows already committed to PostgreSQL; reports still queued in memory at the moment of a crash can be lost. A prolonged database outage can fill the bounded queue and cause logged drops. Rows older than 2 minutes remain stored but are excluded from the live API until new reports arrive.

### Database

`yarn migrate` applies [`database/001_init.sql`](../database/001_init.sql), then [`database/002_retention_index.sql`](../database/002_retention_index.sql). They install PostGIS in the `gis` schema and create `app.vessel_latest` with spatial and freshness indexes. The table has RLS enabled without anon/authenticated policies. Clients access live data only through Fastify. Applied filenames are stored in `app.schema_migrations`, so each file runs once.

Construct points as `gis.ST_SetSRID(gis.ST_MakePoint(longitude, latitude), 4326)`. Do not delete the latest row merely because it becomes stale: it must survive backend restarts. The live API hides rows older than two minutes.

### API contract

`GET /api/vessels?bbox=minLng,minLat,maxLng,maxLat`

- `bbox` contains the visible map bounds in longitude, latitude order.
- Validate numeric values, latitude/longitude ranges, latitude ordering, and a maximum 10-degree span in each direction. A box crossing the antimeridian (`minLng > maxLng`) is split into two spatial queries.
- The API has no zoom parameter. The client suppresses fetching and clears markers below zoom 12.
- Query `app.vessel_latest` for only `received_at >= NOW() - INTERVAL '2 minutes'` and locations intersecting the requested viewport. Use `gis.ST_Intersects(location, gis.ST_MakeEnvelope(..., 4326))` with the GiST index.
- Return one item per MMSI. `course` is COG in degrees, or `null` when unavailable. Send an `ETag` of the current MMSI and `receivedAt` set. A matching `If-None-Match` returns `304` so a client can keep its last payload when the viewport has not changed.

Example response:

```json
{
  "data": [
    {
      "mmsi": 211234560,
      "name": "NORTHERN STAR",
      "longitude": -122.4194,
      "latitude": 37.7749,
      "speed": 12.4,
      "course": 185.2,
      "receivedAt": "2026-09-26T08:30:00.000Z"
    }
  ]
}
```

`GET /health` provides a basic liveness response. Connection, queue, and database failures are logged so a running HTTP server does not hide a disconnected feed.

## Mobile integration contract

The client uses `@rnmapbox/maps` (with an Expo custom development build if using Expo). At zoom 12 or higher, it polls the current viewport every 5 seconds while the app and map are active, and refetches after a settled pan or zoom. It renders GeoJSON points in a `ShapeSource` with a `SymbolLayer`, rotating a directional icon by `course`. It clears markers below zoom 12, removes markers outside the current viewport, and expires locally cached positions after 2 minutes even if a request fails. Keep the aisstream.io key out of the client.

A five-second polling interval leaves limited margin for network and rendering time. Measure latency from backend `received_at` to visible map update; adjust the interval or API performance if the 10-second requirement is missed.

## Deployment and scaling

- Use persistent PostgreSQL/PostGIS storage and an always-on backend process for the final demonstration. A sleeping web service cannot reliably meet the 10-second update target or maintain the ingestion connection.
- For Render to Supabase, use the Supabase **Session pooler** connection string on port 5432 as `DATABASE_URL`. Render's outbound network is IPv4-only, while Supabase's direct connection is IPv6 unless its IPv4 add-on is enabled. Keep the URL in Render environment variables, never in source control.
- Start with one API/ingestion instance and a bounded database connection pool. Do not create one provider connection per viewer.
- The latest table stays one row per MMSI. Monitor write delay under load.
- Each viewer requests only its current viewport. Debounce map movement and avoid requests below zoom 12. Measure API and database load with roughly 30,000 latest rows and several concurrent viewers before adding caching or delta responses.
- Store `AISSTREAM_API_KEY`, `AIS_BOUNDING_BOXES`, `DATABASE_URL`, and `PORT` as backend configuration. The client needs only the public API URL and its Mapbox token.

## Run and maintain the backend

1. Run `yarn install --frozen-lockfile`.
2. Copy `.env.example` to `.env` and replace the example values. `AIS_BOUNDING_BOXES` is JSON with AISstream latitude/longitude corner pairs. Use the Supabase Session pooler URL for `DATABASE_URL`.
3. Run `yarn migrate`. It applies new files in `database/` in numeric order.
4. Run `yarn dev` for automatic restarts during development. `GET /health` checks HTTP liveness; `GET /api/vessels?bbox=103.720,1.200,103.880,1.270` returns fresh positions in the Singapore Harbor viewport.
5. Run `yarn typecheck`, `yarn test`, and `yarn build` before deployment. The PostGIS test requires `TEST_DATABASE_URL` pointing to an **empty disposable database** with `yarn migrate` already applied; it is skipped when that variable is absent.
6. On Render, use `yarn install --frozen-lockfile && yarn build` as the build command and `yarn start` as the start command. Configure one always-on instance and set the same backend environment variables in Render.

The app fails startup if the required settings are missing, the database is unreachable, or `app.vessel_latest` has not been created. `/health` is a liveness check; inspect connection and write-delay logs to diagnose ingestion health. AISstream does not replay reports missed while disconnected.

## Delivery and acceptance checks

1. A valid streamed report is committed and immediately returned by a matching viewport request.
2. An active map shows a changed course/position within 10 seconds of backend receipt.
3. A vessel disappears from both API results and the map after 2 minutes without a new report, including when polling fails.
4. The map shows no vessels below zoom 12 and does not request the full worldwide dataset.
5. Two updates for one MMSI leave one latest row. Restarting the backend preserves that row; fresh rows become available again as reports arrive.
6. The source code and a short demonstration video show these behaviors.

## References

- [AIS overview](https://globalfishingwatch.org/faqs/what-is-ais)
- [aisstream.io documentation](https://aisstream.io/documentation)
- [Mapbox Maps SDK for React Native](https://github.com/rnmapbox/maps)
- [PostGIS `ST_Intersects`](https://postgis.net/docs/ST_Intersects.html)
