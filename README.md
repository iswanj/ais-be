# AIS Backend

Ingests AIS `PositionReport` messages for the whole world from [aisstream.io](https://aisstream.io/documentation), keeps the latest position for each vessel in PostgreSQL with PostGIS, and serves fresh positions for a map viewport.

```text
aisstream.io WebSocket (worldwide, PositionReport only)
  -> 250 ms batches -> upsert app.vessel_latest (one row per MMSI)
  -> GET /api/vessels?bbox=minLng,minLat,maxLng,maxLat
```

## API

`GET /api/vessels?bbox=103.72,1.2,103.88,1.27` returns vessels inside the box whose last report arrived within the past 2 minutes. The box is longitude, latitude order and at most 10 degrees in each direction. `course` is `null` when the vessel does not report one.

```json
{
  "data": [
    {
      "mmsi": 563000001,
      "name": "HARBOUR",
      "longitude": 103.8,
      "latitude": 1.235,
      "speed": 8.2,
      "course": 91.5,
      "receivedAt": "2026-09-27T01:30:00.000Z"
    }
  ]
}
```

`GET /health` returns `{ "status": "ok" }`.

## Run locally

Requires Node.js 20 or later, Yarn 1, and a PostgreSQL database with PostGIS available.

1. Run `yarn install --frozen-lockfile`.
2. Copy `.env.example` to `.env` and set `AISSTREAM_API_KEY` and `DATABASE_URL`.
3. Run `yarn migrate` to create the `app.vessel_latest` table and indexes.
4. Run `yarn dev`.

Positions already stored stay in the database across restarts. Rows older than 2 minutes are hidden from the API until the vessel reports again.

## Checks

```bash
yarn typecheck
yarn test
yarn build
```

The PostGIS integration test runs only when `TEST_DATABASE_URL` points to an empty disposable database that has been migrated.

## Deploy on Render

- Build command: `yarn install --frozen-lockfile && yarn build`
- Start command: `yarn start`
- Environment: `AISSTREAM_API_KEY`, `AIS_BOUNDING_BOXES`, `DATABASE_URL`, and `PORT`
- Use one always-on instance. A sleeping instance drops the stream and misses the 10-second update target.
- With Supabase, use the Session pooler connection string on port 5432.
