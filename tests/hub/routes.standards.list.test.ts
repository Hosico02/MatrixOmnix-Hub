import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDb, migrate } from '../../src/hub/db/client.js';
import { standards, standardVersions } from '../../src/hub/db/schema.js';
import { buildApp } from '../../src/hub/server.js';

describe('standards list + history', () => {
  let handle: ReturnType<typeof openDb>;
  let app: ReturnType<typeof buildApp>;
  let stdId: string;

  beforeEach(() => {
    const p = join(mkdtempSync(join(tmpdir(), 'sl-')), 'h.db');
    handle = openDb(p);
    migrate(handle.sqlite);
    stdId = randomUUID();
    handle.db.insert(standards).values({
      id: stdId, archetype: 'fastapi-api', version: 2,
      bodyMd: '- v2 content', isCurrent: true, source: 'rule',
    }).run();
    handle.db.insert(standardVersions).values({
      id: randomUUID(), standardsId: stdId, version: 1, bodyMd: '- v1 content',
    }).run();
    handle.db.insert(standardVersions).values({
      id: randomUUID(), standardsId: stdId, version: 2, bodyMd: '- v2 content',
      diffFromPrevMd: '+ new line',
    }).run();
    app = buildApp(handle, { adminToken: 'a', dataDir: '.' });
  });

  it('GET /standards returns list of archetypes', async () => {
    const res = await app.request('/api/standards');
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.items).toHaveLength(1);
    expect(j.items[0].archetype).toBe('fastapi-api');
    expect(j.items[0].current_version).toBe(2);
  });

  it('GET /standards/:archetype/history returns version log', async () => {
    const res = await app.request('/api/standards/fastapi-api/history');
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.versions).toHaveLength(2);
    expect(j.versions[0].version).toBeGreaterThan(j.versions[1].version);
  });
});
