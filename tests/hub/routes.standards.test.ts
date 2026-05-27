import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDb, migrate } from '../../src/hub/db/client.js';
import { standards } from '../../src/hub/db/schema.js';
import { buildApp } from '../../src/hub/server.js';

describe('GET /standards/:archetype', () => {
  let handle: ReturnType<typeof openDb>;
  let app: ReturnType<typeof buildApp>;
  const archetype = 'fastapi-api';

  beforeEach(() => {
    const p = join(mkdtempSync(join(tmpdir(), 'std-')), 'h.db');
    handle = openDb(p);
    migrate(handle.sqlite);
    handle.db.insert(standards).values({
      id: randomUUID(), archetype, version: 1,
      bodyMd: '# Initial fastapi-api standards\n- tests pass',
      isCurrent: true, source: 'manual',
    }).run();
    app = buildApp(handle, { adminToken: 'a', dataDir: '.' });
  });

  it('200 returns current body + etag', async () => {
    const res = await app.request(`/api/standards/${archetype}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('etag')).toBe('1');
    const j = await res.json();
    expect(j.version).toBe(1);
    expect(j.body_md).toMatch(/tests pass/);
  });

  it('304 when If-None-Match matches', async () => {
    const res = await app.request(`/api/standards/${archetype}`, {
      headers: { 'If-None-Match': '1' },
    });
    expect(res.status).toBe(304);
  });

  it('404 when archetype unknown', async () => {
    const res = await app.request('/api/standards/unknown-thing');
    expect(res.status).toBe(404);
  });
});
