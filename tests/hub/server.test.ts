import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../../src/hub/server.js';
import { openDb, migrate } from '../../src/hub/db/client.js';

describe('server skeleton', () => {
  let app: ReturnType<typeof buildApp>;
  beforeAll(() => {
    const dbPath = join(mkdtempSync(join(tmpdir(), 'srv-')), 'h.db');
    const handle = openDb(dbPath);
    migrate(handle.sqlite);
    app = buildApp(handle, { adminToken: 'admin-secret', dataDir: '.' });
  });

  it('GET /admin/health returns 403 without token', async () => {
    const res = await app.request('/admin/health');
    expect(res.status).toBe(403);
  });

  it('GET /admin/health returns 200 with admin token', async () => {
    const res = await app.request('/admin/health', {
      headers: { Authorization: 'Bearer admin-secret' },
    });
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.db_ok).toBe(true);
  });
});
