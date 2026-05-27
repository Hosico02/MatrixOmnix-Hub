import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, migrate } from '../../src/hub/db/client.js';
import { buildApp } from '../../src/hub/server.js';

describe('POST /admin/learner/trigger', () => {
  let handle: ReturnType<typeof openDb>;
  let app: ReturnType<typeof buildApp>;
  beforeEach(() => {
    const p = join(mkdtempSync(join(tmpdir(), 'ad-')), 'h.db');
    handle = openDb(p);
    migrate(handle.sqlite);
    app = buildApp(handle, { adminToken: 'sec', dataDir: '.' });
  });

  it('403 without admin token', async () => {
    const r = await app.request('/admin/learner/trigger', { method: 'POST' });
    expect(r.status).toBe(403);
  });

  it('200 returns proposals_created count', async () => {
    const r = await app.request('/admin/learner/trigger', {
      method: 'POST',
      headers: { Authorization: 'Bearer sec' },
    });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(typeof j.proposals_created).toBe('number');
  });
});
