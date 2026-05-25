import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { openDb, migrate } from '../../src/hub/db/client.js';
import { d2pInstances, events } from '../../src/hub/db/schema.js';
import { buildApp } from '../../src/hub/server.js';

describe('POST /events', () => {
  let handle: ReturnType<typeof openDb>;
  let app: ReturnType<typeof buildApp>;
  const TOKEN = 'tk-secret';

  beforeEach(() => {
    const p = join(mkdtempSync(join(tmpdir(), 'evt-')), 'h.db');
    handle = openDb(p);
    migrate(handle.sqlite);
    handle.db.insert(d2pInstances).values({
      id: randomUUID(), name: 'dev', tokenHash: bcrypt.hashSync(TOKEN, 4),
    }).run();
    app = buildApp(handle, { adminToken: 'a' });
  });

  it('401 without bearer', async () => {
    const r = await app.request('/api/events', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'run_started', run_id: 'r1', payload: {} }),
    });
    expect(r.status).toBe(401);
  });

  it('200 inserts event', async () => {
    const r = await app.request('/api/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ type: 'run_started', run_id: 'r1', payload: { foo: 1 } }),
    });
    expect(r.status).toBe(200);
    const rows = handle.db.select().from(events).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].eventType).toBe('run_started');
  });

  it('duplicate same-payload is de-duped', async () => {
    const body = JSON.stringify({ type: 'iteration_complete', run_id: 'r1', payload: { iter: 1 } });
    const headers = { 'content-type': 'application/json', Authorization: `Bearer ${TOKEN}` };
    await app.request('/api/events', { method: 'POST', headers, body });
    await app.request('/api/events', { method: 'POST', headers, body });
    const rows = handle.db.select().from(events).all();
    expect(rows).toHaveLength(1);
  });
});
