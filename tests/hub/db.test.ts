import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, migrate } from '../../src/hub/db/client.js';
import { d2pInstances, runs } from '../../src/hub/db/schema.js';
import { randomUUID } from 'node:crypto';

describe('db client', () => {
  let dbPath: string;
  beforeEach(() => {
    dbPath = join(mkdtempSync(join(tmpdir(), 'hub-db-')), 'test.db');
  });

  it('migrate creates tables', () => {
    const { sqlite } = openDb(dbPath);
    migrate(sqlite);
    const tables = sqlite.prepare(
      "SELECT name FROM sqlite_master WHERE type='table'"
    ).all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain('d2p_instances');
    expect(names).toContain('runs');
    expect(names).toContain('findings');
    expect(names).toContain('proposals');
    expect(names).toContain('events');
  });

  it('migrate is idempotent across multiple runs (incl. ALTER TABLE ADD COLUMN)', () => {
    const { sqlite } = openDb(dbPath);
    migrate(sqlite);
    // Second run simulates a Hub restart against an existing DB. The framework
    // re-applies every migration file on every boot; ALTER TABLE ADD COLUMN
    // must not throw on the second pass.
    expect(() => migrate(sqlite)).not.toThrow();
    expect(() => migrate(sqlite)).not.toThrow();
    // Sanity: the runs table still has stdout_path
    const cols = sqlite.prepare("PRAGMA table_info(runs)").all() as { name: string }[];
    expect(cols.map((c) => c.name)).toContain('stdout_path');
  });

  it('insert and select round-trips', () => {
    const { db, sqlite } = openDb(dbPath);
    migrate(sqlite);
    const instId = randomUUID();
    db.insert(d2pInstances).values({
      id: instId, name: 'dev', tokenHash: 'xxx',
    }).run();
    const runId = randomUUID();
    db.insert(runs).values({
      id: runId, instanceId: instId, projectPath: '/tmp/p',
      startedAt: new Date().toISOString(),
    }).run();
    const got = db.select().from(runs).all();
    expect(got).toHaveLength(1);
    expect(got[0].id).toBe(runId);
  });
});
