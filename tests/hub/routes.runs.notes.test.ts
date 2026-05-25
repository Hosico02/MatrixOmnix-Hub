import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDb, migrate } from '../../src/hub/db/client.js';
import { d2pInstances, runs, mentorNotes } from '../../src/hub/db/schema.js';
import { buildApp } from '../../src/hub/server.js';

describe('POST /runs/:id/notes', () => {
  let handle: ReturnType<typeof openDb>;
  let app: ReturnType<typeof buildApp>;
  beforeEach(() => {
    const p = join(mkdtempSync(join(tmpdir(), 'rn-')), 'h.db');
    handle = openDb(p);
    migrate(handle.sqlite);
    const instId = randomUUID();
    handle.db.insert(d2pInstances).values({
      id: instId, name: 'i', tokenHash: 'x',
    }).run();
    handle.db.insert(runs).values({
      id: 'r1', instanceId: instId, projectPath: '/p',
      startedAt: new Date().toISOString(),
    }).run();
    app = buildApp(handle, { adminToken: 'a' });
  });

  it('inserts a human note', async () => {
    const res = await app.request('/api/runs/r1/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body_md: 'looks good', author: 'human' }),
    });
    expect(res.status).toBe(200);
    const rows = handle.db.select().from(mentorNotes).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].bodyMd).toBe('looks good');
  });

  it('400 if body_md missing', async () => {
    const res = await app.request('/api/runs/r1/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});
