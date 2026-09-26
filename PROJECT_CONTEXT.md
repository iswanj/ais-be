# AIS Vessel Viewer — Backend Project Context

## Goal

Build the backend for an AIS vessel viewer that consumes `PositionReport` messages from aisstream.io, persists the latest vessel positions in PostGIS, and serves fresh positions inside a mobile map viewport. A React Native client using Mapbox Maps SDK will poll the API and display directional vessel markers.

The challenge prioritizes a simple implementation that remains useful with approximately 30,000 vessels and many simultaneous map viewers. A report received by the backend should appear on an active map within 10 seconds. The map must never show positions older than 2 minutes and must show vessels only at zoom level 12 or higher.

## MVP scope

- Ingest only aisstream.io `PositionReport` messages.
- Keep one durable latest-position record per MMSI in PostgreSQL with PostGIS.
- Expose fresh positions for the requested viewport through a REST API.
- Keep the aisstream.io API key on the backend.
- Recover the stream connection after interruptions without losing already persisted positions.
- Support a demonstration of ingestion, map updates, freshness, and persistence after a backend restart.

Twenty-four-hour trajectory storage, vessel type, flag, and vessel detail history are outside the MVP. Add them only after the challenge requirements work end to end. `PositionReport` and its envelope do not supply all static vessel metadata.

## Architecture

```text
aisstream.io WebSocket (PositionReport only)
    -> one ingestion worker
    -> PostGIS vessel_latest table
    -> Fastify viewport API
    -> Mapbox React Native client (5-second polling while active)
```

Node.js, TypeScript, and Fastify serve the API. A single long-lived WebSocket consumer runs alongside the API for the initial one-instance deployment. If the API is later scaled to multiple instances, run the consumer as a separate singleton worker so replicas do not open duplicate provider subscriptions.

### Ingestion

1. Open `wss://stream.aisstream.io/v0/stream` with `permessage-deflate` enabled.
2. Send a complete subscription within 3 seconds, including the server-side API key, configured geographic bounding boxes, and `FilterMessageTypes: ["PositionReport"]`. The provider subscription uses **latitude, longitude** corner pairs; the client API uses **longitude, latitude** bounding-box values.
3. Read and decode WebSocket frames continuously. Ignore subscription confirmations and other message types.
4. For each `PositionReport`, validate the MMSI, `Valid` flag, finite latitude and longitude, and coordinate ranges. Read COG and SOG when valid; treat unavailable course as unknown rather than inventing a direction. Use the envelope's ship name when supplied.
5. Record `received_at` as the UTC time the backend receives the valid message and upsert the latest row immediately. The AIS report's `Timestamp` is a second within a minute and is not a full event timestamp for freshness checks.
6. Reconnect with exponential backoff and jitter after disconnection, then send a new complete subscription. Log connection state and ingestion errors without exposing the API key.

The provider does not promise durable replay. A restart retains rows already committed to PostgreSQL; rows older than 2 minutes remain stored but are excluded from the live API until new reports arrive.

### Database

Use a small current-state table for viewport reads:

```sql
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE vessel_latest (
  mmsi BIGINT PRIMARY KEY,
  name TEXT,
  location GEOMETRY(Point, 4326) NOT NULL,
  sog REAL,
  cog REAL,
  received_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX vessel_latest_location_gist
  ON vessel_latest USING GIST (location);
```

Construct points as `ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)`. Upsert by MMSI. Keep coordinates and `received_at` in the same committed update so a viewport request sees a consistent latest position. A separate append-only history table can be introduced later if trajectories become a requirement.

### API contract

`GET /api/vessels?bbox=minLng,minLat,maxLng,maxLat&zoom=12.5`

- `bbox` contains the visible map bounds in longitude, latitude order.
- Validate numeric values, latitude/longitude ranges, latitude ordering, and a plausible viewport size. A box crossing the antimeridian (`minLng > maxLng`) is split into two spatial queries.
- Return an empty `data` array when `zoom < 12`. The client also suppresses fetching and clears markers below zoom 12.
- Query only `received_at >= NOW() - INTERVAL '2 minutes'` and locations intersecting the requested viewport. Use `ST_Intersects(location, ST_MakeEnvelope(..., 4326))` with the GiST index.
- Return one item per MMSI. `course` is COG in degrees, or `null` when unavailable.

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

`GET /health` provides a basic liveness response. Log or expose separate ingestion and database status for operations so a running HTTP server does not hide a disconnected feed.

## Mobile integration contract

The client uses `@rnmapbox/maps` (with an Expo custom development build if using Expo). At zoom 12 or higher, it polls the current viewport every 5 seconds while the app and map are active, and refetches after a settled pan or zoom. It renders GeoJSON points in a `ShapeSource` with a `SymbolLayer`, rotating a directional icon by `course`. It clears markers below zoom 12, removes markers outside the current viewport, and expires locally cached positions after 2 minutes even if a request fails. Keep the aisstream.io key out of the client.

A five-second polling interval leaves limited margin for network and rendering time. Measure latency from backend `received_at` to visible map update; adjust the interval or API performance if the 10-second requirement is missed.

## Deployment and scaling

- Use persistent PostgreSQL/PostGIS storage and an always-on backend process for the final demonstration. A sleeping web service cannot reliably meet the 10-second update target or maintain the ingestion connection.
- Start with one API/ingestion instance and a bounded database connection pool. Do not create one provider connection per viewer.
- Each viewer requests only its current viewport. Debounce map movement and avoid requests below zoom 12. Measure API and database load with roughly 30,000 latest rows and several concurrent viewers before adding caching or delta responses.
- Store `AISSTREAM_API_KEY`, `AIS_BOUNDING_BOXES`, `DATABASE_URL`, and `PORT` as backend configuration. The client needs only the public API URL and its Mapbox token.

## Delivery and acceptance checks

1. A valid streamed report is committed and immediately returned by a matching viewport request.
2. An active map shows a changed course/position within 10 seconds of backend receipt.
3. A vessel disappears from both API results and the map after 2 minutes without a new report, including when polling fails.
4. The map shows no vessels below zoom 12 and does not request the full worldwide dataset.
5. Restarting the backend preserves committed vessel rows in PostgreSQL; fresh rows become available again as reports arrive.
6. The source code and a short demonstration video show these behaviors.

## References

- [AIS overview](https://globalfishingwatch.org/faqs/what-is-ais)
- [aisstream.io documentation](https://aisstream.io/documentation)
- [Mapbox Maps SDK for React Native](https://github.com/rnmapbox/maps)
- [PostGIS `ST_Intersects`](https://postgis.net/docs/ST_Intersects.html)
