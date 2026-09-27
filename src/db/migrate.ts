import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { parseDatabaseUrl } from '../config/database-url.js';

const databaseDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../database');

export function listMigrationFiles(names: readonly string[]): string[] {
  return names.filter((name) => /^\d{3}_.+\.sql$/.test(name)).sort();
}

export function pendingMigrations(files: readonly string[], applied: readonly string[]): string[] {
  const done = new Set(applied);
  return files.filter((file) => !done.has(file));
}

export function databaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return parseDatabaseUrl(env.DATABASE_URL);
}

export async function applyMigrations(client: Client, directory: string): Promise<string[]> {
  await client.query('CREATE SCHEMA IF NOT EXISTS app');
  await client.query(`
    CREATE TABLE IF NOT EXISTS app.schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  const applied = await client.query<{ filename: string }>('SELECT filename FROM app.schema_migrations');
  const names = await readdir(directory);
  const pending = pendingMigrations(listMigrationFiles(names), applied.rows.map((row) => row.filename));
  for (const filename of pending) {
    const sql = await readFile(path.join(directory, filename), 'utf8');
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO app.schema_migrations (filename) VALUES ($1)', [filename]);
      await client.query('COMMIT');
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* Connection may already be closed. */ }
      throw error;
    }
  }
  return pending;
}

async function main(): Promise<void> {
  const client = new Client({
    connectionString: databaseUrl(),
    connectionTimeoutMillis: 10_000,
    query_timeout: 60_000,
  });
  await client.connect();
  try {
    const applied = await applyMigrations(client, databaseDir);
    if (applied.length === 0) {
      console.log('database schema is up to date');
      return;
    }
    for (const filename of applied) console.log(`applied ${filename}`);
  } finally {
    await client.end();
  }
}

const entry = process.argv[1];
if (entry && path.resolve(entry) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
