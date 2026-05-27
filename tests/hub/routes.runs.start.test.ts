import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import * as child_process from 'node:child_process';
import { openDb, migrate } from '../../src/hub/db/client.js';
import { buildApp } from '../../src/hub/server.js';
import { RunSupervisor } from '../../src/hub/runner/supervisor.js';

function mkApp(runnerEnabled = true) {
  const root = mkdtempSync(join(tmpdir(), 'st-'));
  const handle = openDb(join(root, 'h.db'));
  migrate(handle.sqlite);
  const supervisor = new RunSupervisor({
    handle, dataDir: root, d2pPath: '/fake/d2p',
  });
  const app = buildApp(handle, {
    adminToken: 'sec',
    dataDir: '.',
    runner: supervisor,
    runnerCfg: runnerEnabled ? {
      enabled: true,
      d2pPath: '/fake/d2p',
      minimaxApiKey: 'k',
      instanceToken: 't',
      hubBaseUrl: 'http://127.0.0.1:3030',
      pathPrefixes: [homedir(), '/tmp'],
    } : null,
  });
  return { app, supervisor, handle, root };
}

describe('POST /admin/runs/start', () => {
  let spawnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    spawnSpy = vi.spyOn(child_process, 'spawn').mockImplementation(
      // @ts-expect-error — return shape is the subset we use
      (() => {
        const { EventEmitter } = require('node:events');
        const child: any = new EventEmitter();
        child.pid = 99999;
        const { PassThrough } = require('node:stream');
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        child.kill = () => true;
        return child;
      }) as any,
    );
  });

  afterEach(() => {
    spawnSpy.mockRestore();
  });

  it('403 without admin token', async () => {
    const { app } = mkApp();
    const r = await app.request('/admin/runs/start', { method: 'POST' });
    expect(r.status).toBe(403);
  });

  it('503 when runner disabled', async () => {
    const { app } = mkApp(false);
    const r = await app.request('/admin/runs/start', {
      method: 'POST',
      headers: { Authorization: 'Bearer sec', 'content-type': 'application/json' },
      body: JSON.stringify({ project_path: '/tmp/x', iter: 3 }),
    });
    expect(r.status).toBe(503);
  });

  it('400 when project_path is missing', async () => {
    const { app } = mkApp();
    const r = await app.request('/admin/runs/start', {
      method: 'POST',
      headers: { Authorization: 'Bearer sec', 'content-type': 'application/json' },
      body: JSON.stringify({ iter: 3 }),
    });
    expect(r.status).toBe(400);
  });

  it('400 when project_path is outside the whitelist', async () => {
    const { app } = mkApp();
    const r = await app.request('/admin/runs/start', {
      method: 'POST',
      headers: { Authorization: 'Bearer sec', 'content-type': 'application/json' },
      body: JSON.stringify({ project_path: '/etc/passwd-dir', iter: 3 }),
    });
    expect(r.status).toBe(400);
  });

  it('400 when iter is out of range', async () => {
    const { app } = mkApp();
    const r = await app.request('/admin/runs/start', {
      method: 'POST',
      headers: { Authorization: 'Bearer sec', 'content-type': 'application/json' },
      body: JSON.stringify({ project_path: '/tmp/whatever', iter: 99 }),
    });
    expect(r.status).toBe(400);
  });

  it('200 happy path: spawns once and returns { run_id, pid }', async () => {
    const { app } = mkApp();
    const r = await app.request('/admin/runs/start', {
      method: 'POST',
      headers: { Authorization: 'Bearer sec', 'content-type': 'application/json' },
      body: JSON.stringify({ project_path: '/tmp/x-demo', iter: 2 }),
    });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.run_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(j.pid).toBe(99999);
    expect(spawnSpy).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = spawnSpy.mock.calls[0] as any;
    // python3 — /fake/d2p has no .venv in test setup, so falls back to system
    expect(cmd).toBe('python3');
    expect(args).toContain(join('/fake/d2p', 'run.py'));
    expect(args).toContain('--iter');
    expect(args).toContain('2');
    expect(opts.env.D2P_RUN_ID).toBe(j.run_id);
    expect(opts.env.HUB_URL).toBeDefined();
    expect(opts.env.HUB_TOKEN).toBeDefined();
    expect(opts.env.MINIMAX_API_KEY).toBeDefined();
  });

  it('409 when a run is already in flight', async () => {
    const { app } = mkApp();
    const ok = await app.request('/admin/runs/start', {
      method: 'POST',
      headers: { Authorization: 'Bearer sec', 'content-type': 'application/json' },
      body: JSON.stringify({ project_path: '/tmp/x-demo', iter: 1 }),
    });
    expect(ok.status).toBe(200);
    const second = await app.request('/admin/runs/start', {
      method: 'POST',
      headers: { Authorization: 'Bearer sec', 'content-type': 'application/json' },
      body: JSON.stringify({ project_path: '/tmp/y', iter: 1 }),
    });
    expect(second.status).toBe(409);
  });
});
