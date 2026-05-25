import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDb, migrate } from '../../src/hub/db/client.js';
import { standards, proposals } from '../../src/hub/db/schema.js';
import { buildApp } from '../../src/hub/server.js';

describe('proposals routes', () => {
  let handle: ReturnType<typeof openDb>;
  let app: ReturnType<typeof buildApp>;
  let propId: string;

  beforeEach(() => {
    const p = join(mkdtempSync(join(tmpdir(), 'pr-')), 'h.db');
    handle = openDb(p);
    migrate(handle.sqlite);
    handle.db.insert(standards).values({
      id: randomUUID(), archetype: 'fastapi-api', version: 1,
      bodyMd: '# baseline\n- tests', isCurrent: true, source: 'manual',
    }).run();
    propId = randomUUID();
    handle.db.insert(proposals).values({
      id: propId, archetype: 'fastapi-api', proposalType: 'add_check',
      bodyMd: 'cors_policy_explicit', rationaleMd: 'seen 7/10 runs',
      source: 'rule', status: 'pending',
    }).run();
    app = buildApp(handle, { adminToken: 'a' });
  });

  it('GET /proposals returns pending', async () => {
    const res = await app.request('/api/proposals?status=pending');
    const j = await res.json();
    expect(j.items).toHaveLength(1);
    expect(j.items[0].id).toBe(propId);
  });

  it('GET /proposals/:id returns full', async () => {
    const res = await app.request(`/api/proposals/${propId}`);
    const j = await res.json();
    expect(j.proposal.archetype).toBe('fastapi-api');
  });

  it('POST decision approve creates new standards version', async () => {
    const res = await app.request(`/api/proposals/${propId}/decision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'approve' }),
    });
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.new_standard_version_id).toBeTruthy();
    const std = handle.db.select().from(standards).all();
    expect(std[0].version).toBe(2);
    const p = handle.db.select().from(proposals).all();
    expect(p[0].status).toBe('approved');
  });

  it('POST decision reject marks rejected, no new version', async () => {
    const res = await app.request(`/api/proposals/${propId}/decision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'reject', note: 'too noisy' }),
    });
    expect(res.status).toBe(200);
    const p = handle.db.select().from(proposals).all();
    expect(p[0].status).toBe('rejected');
    const std = handle.db.select().from(standards).all();
    expect(std[0].version).toBe(1);
  });
});
