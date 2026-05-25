import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from './schema.js';

export interface DbHandle {
  db: BetterSQLite3Database<typeof schema>;
  sqlite: Database.Database;
}

export function openDb(path: string): DbHandle {
  mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}

export function migrate(sqlite: Database.Database) {
  const here = dirname(fileURLToPath(import.meta.url));
  const dir = join(here, 'migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    const sqlText = readFileSync(join(dir, f), 'utf-8');
    // Make statements idempotent by converting CREATE TABLE to CREATE TABLE IF NOT EXISTS
    const idempotentSql = sqlText
      .replace(/CREATE TABLE `/g, 'CREATE TABLE IF NOT EXISTS `')
      .replace(/CREATE UNIQUE INDEX `/g, 'CREATE UNIQUE INDEX IF NOT EXISTS `')
      .replace(/CREATE INDEX `/g, 'CREATE INDEX IF NOT EXISTS `');
    sqlite.exec(idempotentSql);
  }
}
