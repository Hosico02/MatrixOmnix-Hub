import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import * as child_process from 'node:child_process';
import { openDb, migrate } from '../../src/hub/db/client.js';
import { buildApp } from '../../src/hub/server.js';
import { RunSupervisor } from '../../src/hub/runner/supervisor.js';

function mkApp() {
  const root = mkdtempSync(join(tmpdir(), 'cur-'));
  const handle = openDb(join(root, 'h.db'));
  migrate(handle.sqlite);
  const supervisor = new RunSupervisor({
    handle, dataDir: root, d2pPath: '/fake',
  });
  const app = buildApp(handle, {
    adminToken: 'sec', dataDir: '.', runner: supervisor,
    runnerCfg: {
      enabled: true, d2pPath: '/fake', minimaxApiKey: 'k',
      instanceToken: 't', hubBaseUrl: 'http://127.0.0.1:3030',
      pathPrefixes: [homedir(), '/tmp'],
    },
  });
  return { app, supervisor, root };
}

describe('GET /admin/runs/current', () => {
  let spawnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    spawnSpy = vi.spyOn(child_process, 'spawn').mockImplementation(
      // @ts-expect-error subset shape
      (() => {
        const { EventEmitter } = require('node:events');
        const c: any = new EventEmitter();
        c.pid = 12345;
        const { PassThrough } = require('node:stream');
        c.stdout = new PassThrough();
        c.stderr = new PassThrough();
        c.kill = () => true;
        return c;
      }) as any,
    );
  });
  afterEach(() => spawnSpy.mockRestore());

  it('403 without admin token', async () => {
    const { app } = mkApp();
    const r = await app.request('/admin/runs/current');
    expect(r.status).toBe(403);
  });

  it('returns null when no run is in flight', async () => {
    const { app } = mkApp();
    const r = await app.request('/admin/runs/current', {
      headers: { Authorization: 'Bearer sec' },
    });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.run_id).toBeNull();
  });

  it('returns current run after start', async () => {
    const { app } = mkApp();
    const start = await app.request('/admin/runs/start', {
      method: 'POST',
      headers: { Authorization: 'Bearer sec', 'content-type': 'application/json' },
      body: JSON.stringify({ project_path: '/tmp/cur-x', iter: 1 }),
    });
    const { run_id } = await start.json();
    const r = await app.request('/admin/runs/current', {
      headers: { Authorization: 'Bearer sec' },
    });
    const j = await r.json();
    expect(j.run_id).toBe(run_id);
    expect(j.pid).toBe(12345);
    expect(j.project_path).toBe('/tmp/cur-x');
    expect(j.started_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
