import assert from 'node:assert/strict';
import test from 'node:test';
import { databaseUrl, listMigrationFiles, pendingMigrations } from '../src/db/migrate.js';

test('lists numbered sql files in order and skips applied ones', () => {
  assert.deepEqual(
    listMigrationFiles(['README.md', '002_retention_index.sql', '001_init.sql', 'notes.txt']),
    ['001_init.sql', '002_retention_index.sql'],
  );
  assert.deepEqual(
    pendingMigrations(['001_init.sql', '002_retention_index.sql'], ['001_init.sql']),
    ['002_retention_index.sql'],
  );
});

test('requires a PostgreSQL DATABASE_URL', () => {
  assert.equal(databaseUrl({ DATABASE_URL: 'postgres://db.example/ais' }), 'postgres://db.example/ais');
  assert.throws(() => databaseUrl({}), /DATABASE_URL is required/);
  assert.throws(() => databaseUrl({ DATABASE_URL: 'mysql://db.example/ais' }), /PostgreSQL connection URL/);
});
