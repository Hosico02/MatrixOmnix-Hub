import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDb, migrate } from '../../src/hub/db/client.js';
import { d2pInstances } from '../../src/hub/db/schema.js';
import { buildApp } from '../../src/hub/server.js';
import { dispatchIngest } from '../../src/hub/ingest/eventHandlers.js';

describe('GET /runs/:id', () => {
  let handle: ReturnType<typeof openDb>;
  let app: ReturnType<typeof buildApp>;
  let inst: { id: string; name: string; tokenHash: string };

  beforeEach(() => {
    const p = join(mkdtempSync(join(tmpdir(), 'rd-')), 'h.db');
    handle = openDb(p);
    migrate(handle.sqlite);
    inst = { id: randomUUID(), name: 'i', tokenHash: 'x' };
    handle.db.insert(d2pInstances).values(inst).run();
    app = buildApp(handle, { adminToken: 'a' });
    dispatchIngest(handle, inst, 'run_started', 'r1', {
      project_path: '/p', detected_archetype: 'fastapi-api', started_at: 't0',
    });
    dispatchIngest(handle, inst, 'iteration_complete', 'r1', {
      iter_n: 1, started_at: 't1', ended_at: 't2',
    });
    dispatchIngest(handle, inst, 'verdict_emitted', 'r1', {
      iter_n: 1, verdict: 'needs_repair',
    });
    dispatchIngest(handle, inst, 'finding_recorded', 'r1', {
      iter_n: 1, category: 'missing_env_example', severity: 'low', is_new: true,
    });
  });

  it('404 for unknown', async () => {
    const res = await app.request('/api/runs/nope');
    expect(res.status).toBe(404);
  });

  it('returns full nested structure', async () => {
    const res = await app.request('/api/runs/r1');
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.run.id).toBe('r1');
    expect(j.iterations).toHaveLength(1);
    expect(j.verdicts).toHaveLength(1);
    expect(j.findings).toHaveLength(1);
    expect(j.findings[0].category).toBe('missing_env_example');
  });
});
