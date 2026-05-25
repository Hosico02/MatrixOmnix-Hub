import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDb, migrate } from '../../src/hub/db/client.js';
import { d2pInstances, runs } from '../../src/hub/db/schema.js';
import { buildApp } from '../../src/hub/server.js';

describe('GET /runs', () => {
  let handle: ReturnType<typeof openDb>;
  let app: ReturnType<typeof buildApp>;
  let instId: string;

  beforeEach(() => {
    const p = join(mkdtempSync(join(tmpdir(), 'rl-')), 'h.db');
    handle = openDb(p);
    migrate(handle.sqlite);
    instId = randomUUID();
    handle.db.insert(d2pInstances).values({
      id: instId, name: 'i1', tokenHash: 'x',
    }).run();
    for (let i = 0; i < 5; i++) {
      handle.db.insert(runs).values({
        id: randomUUID(), instanceId: instId, projectPath: `/p${i}`,
        detectedArchetype: i % 2 === 0 ? 'fastapi-api' : 'node-server',
        startedAt: new Date(Date.now() - i * 60_000).toISOString(),
        terminalState: i === 0 ? 'RUNNING' : 'CLEAN',
      }).run();
    }
    app = buildApp(handle, { adminToken: 'a' });
  });

  it('returns all 5 by default, newest first', async () => {
    const res = await app.request('/runs');
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.items).toHaveLength(5);
    expect(new Date(j.items[0].started_at).getTime())
      .toBeGreaterThanOrEqual(new Date(j.items[1].started_at).getTime());
  });

  it('filters by archetype', async () => {
    const res = await app.request('/runs?archetype=fastapi-api');
    const j = await res.json();
    expect(j.items.every((r: any) => r.detected_archetype === 'fastapi-api')).toBe(true);
  });

  it('filters by state', async () => {
    const res = await app.request('/runs?state=RUNNING');
    const j = await res.json();
    expect(j.items).toHaveLength(1);
  });

  it('limits via limit param', async () => {
    const res = await app.request('/runs?limit=2');
    const j = await res.json();
    expect(j.items).toHaveLength(2);
  });
});
