import 'dotenv/config';
import { ViewportCoverage } from './ais/coverage.js';
import { AisStreamClient } from './ais/stream-client.js';
import { BatchWriter } from './ais/batch-writer.js';
import { buildApp } from './app.js';
import { loadConfig } from './config/env.js';
import { createPool } from './db/pool.js';
import { PostgresVesselStore } from './vessels/repository.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  const store = new PostgresVesselStore(pool);
  const coverage = new ViewportCoverage(config.aisBoundingBoxes);
  let stream: AisStreamClient | undefined;
  const app = buildApp(store, (viewport) => {
    if (coverage.watch(viewport)) stream?.updateBoundingBoxes(coverage.boxes());
  });
  pool.on('error', (error) => app.log.error({ err: error }, 'idle database client error'));

  const writer = new BatchWriter(store, app.log);
  const activeStream = new AisStreamClient(config.aisstreamApiKey, coverage.boxes(), writer, app.log);
  stream = activeStream;

  try {
    await pool.query('SELECT mmsi FROM app.vessel_latest LIMIT 0');
    await app.listen({ host: '0.0.0.0', port: config.port });
  } catch (error) {
    app.log.error({ err: error }, 'startup failed');
    await app.close();
    await pool.end();
    throw error;
  }

  writer.start();
  activeStream.start();

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await activeStream.stop();
    await writer.stop();
    await app.close();
    await pool.end();
  };
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void shutdown().catch((error: unknown) => {
        app.log.error({ err: error }, 'shutdown failed');
        process.exitCode = 1;
      });
    });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
