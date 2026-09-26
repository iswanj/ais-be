# AISstream Backend Integration Plan

## Summary

Connect AISstream to the Fastify backend, store the latest valid position per vessel in PostGIS, and replace the hello-world endpoint with a public viewport API. Run one consumer and the API in a single Render instance initially.

## Implementation

- Organize code into `src/config`, `src/db`, `src/ais`, and `src/vessels`. Keep Fastify assembly and process startup in the existing entry points.
- Add validated `AISSTREAM_API_KEY`, `AIS_BOUNDING_BOXES`, and `DATABASE_URL` configuration, with an `.env.example`. Fail startup when required settings are missing or the database cannot connect.
- Subscribe to AISstream `PositionReport` messages for the configured regions. Validate each report, record backend receipt time, reconnect after interruptions, and avoid logging the API key.
- Coalesce updates by MMSI and upsert them in small batches within 250 ms. Prevent older writes from replacing newer positions; retain the stored name when a report has no name. Bound the pending queue and log write failures and ingestion delay.
- Change the public endpoint to `GET /api/vessels?bbox=minLng,minLat,maxLng,maxLat`. Validate the viewport, support antimeridian crossing, and return only vessels inside it whose last backend receipt was within two minutes. Send `Cache-Control: no-store`. The API does not accept or enforce a zoom level.
- Periodically remove rows older than one hour. Close the stream, pending writes, server, and database pool cleanly on shutdown. Update `context/PROJECT_CONTEXT.md` to match the API contract.

## Verification

- Test report validation, unavailable course and speed, duplicate MMSIs, name retention, and out-of-order writes.
- Test viewport queries, antimeridian crossing, invalid bounds, and the two-minute cutoff against PostGIS.
- Test subscription and reconnection with a mock stream. Measure backend receipt-to-query delay, targeting under one second.
- Perform a live-stream check when credentials are available. The React Native client must separately be tested for zoom 12 visibility, marker direction, local expiry, and the full 10-second receipt-to-map deadline.

## Assumptions

- `app.vessel_latest` remains the only vessel table; no position history is added.
- The React Native client controls the zoom rule and polls the viewport every five seconds while active at zoom 12 or higher.
- The initial deployment uses one always-on Render instance and the Supabase Session pooler.
