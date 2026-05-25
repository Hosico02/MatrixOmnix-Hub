import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import * as child_process from 'node:child_process';
import { openDb, migrate } from '../../src/hub/db/client.js';
import { d2pInstances, runs } from '../../src/hub/db/schema.js';
import { buildApp } from '../../src/hub/server.js';
import { RunSupervisor } from '../../src/hub/runner/supervisor.js';

function mkApp() {
  const root = mkdtempSync(join(tmpdir(), 'pg-'));
  const handle = openDb(join(root, 'h.db'));
  migrate(handle.sqlite);
  const supervisor = new RunSupervisor({
    handle, dataDir: root, d2pPath: '/fake',
  });
  const app = buildApp(handle, {
    adminToken: 'sec', runner: supervisor,
    runnerCfg: {
      enabled: true, d2pPath: '/fake', minimaxApiKey: 'k',
      instanceToken: 't', hubBaseUrl: 'http://127.0.0.1:3030',
      pathPrefixes: [homedir(), '/tmp'],
    },
  });
  return { app, handle, root };
}

function seedTerminalRun(handle: any, state = 'CLEAN') {
  const instId = randomUUID();
  handle.db.insert(d2pInstances).values({
    id: instId, name: 'i', tokenHash: 'x',
  }).run();
  const runId = randomUUID();
  handle.db.insert(runs).values({
    id: runId, instanceId: instId, projectPath: '/tmp/pg-demo',
    startedAt: new Date().toISOString(),
    terminatedAt: new Date().toISOString(),
    terminalState: state,
  }).run();
  return runId;
}

describe('POST /admin/runs/:id/push-github', () => {
  let runArgvSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    runArgvSpy = vi.spyOn(child_process, 'execFile').mockImplementation(
      // @ts-expect-error overload
      ((_cmd: string, _args: string[], _opts: any,
        cb: (err: any, out: { stdout: string; stderr: string }) => void) => {
        cb(null, { stdout: '', stderr: '' });
        return {} as any;
      }) as any,
    );
  });
  afterEach(() => runArgvSpy.mockRestore());

  it('404 when run does not exist', async () => {
    const { app } = mkApp();
    const r = await app.request(`/admin/runs/${randomUUID()}/push-github`, {
      method: 'POST',
      headers: { Authorization: 'Bearer sec', 'content-type': 'application/json' },
      body: JSON.stringify({
        remote_url: 'git@github.com:user/repo.git',
        branch: 'main', commit_message: 'x',
      }),
    });
    expect(r.status).toBe(404);
  });

  it('409 when run is still running', async () => {
    const { app, handle } = mkApp();
    const instId = randomUUID();
    handle.db.insert(d2pInstances).values({
      id: instId, name: 'i', tokenHash: 'x',
    }).run();
    const runId = randomUUID();
    handle.db.insert(runs).values({
      id: runId, instanceId: instId, projectPath: '/tmp/pg-demo',
      startedAt: new Date().toISOString(),
    }).run();
    const r = await app.request(`/admin/runs/${runId}/push-github`, {
      method: 'POST',
      headers: { Authorization: 'Bearer sec', 'content-type': 'application/json' },
      body: JSON.stringify({
        remote_url: 'git@github.com:user/repo.git',
        branch: 'main', commit_message: 'x',
      }),
    });
    expect(r.status).toBe(409);
  });

  it('400 on bad remote_url (not GitHub)', async () => {
    const { app, handle } = mkApp();
    const runId = seedTerminalRun(handle);
    const r = await app.request(`/admin/runs/${runId}/push-github`, {
      method: 'POST',
      headers: { Authorization: 'Bearer sec', 'content-type': 'application/json' },
      body: JSON.stringify({
        remote_url: 'git@gitlab.com:user/repo.git',
        branch: 'main', commit_message: 'x',
      }),
    });
    expect(r.status).toBe(400);
  });

  it('200 happy path runs git init/add/commit/remote/push', async () => {
    const { app, handle } = mkApp();
    const runId = seedTerminalRun(handle);
    const r = await app.request(`/admin/runs/${runId}/push-github`, {
      method: 'POST',
      headers: { Authorization: 'Bearer sec', 'content-type': 'application/json' },
      body: JSON.stringify({
        remote_url: 'git@github.com:user/repo.git',
        branch: 'main', commit_message: 'feat: d2p iteration 1',
      }),
    });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.ok).toBe(true);
    expect(j.remote_html).toBe('https://github.com/user/repo');
    const cmds = j.steps.map((s: any) => s.cmd);
    expect(cmds[0]).toBe('git init');
    expect(cmds[1]).toBe('git add -A');
    expect(cmds.find((c: string) => c.startsWith('git push'))).toBeTruthy();
    expect(runArgvSpy).toHaveBeenCalled();
  });

  it('500 with steps[] when a step fails', async () => {
    runArgvSpy.mockRestore();
    runArgvSpy = vi.spyOn(child_process, 'execFile').mockImplementation(
      // @ts-expect-error overload
      ((cmd: string, args: string[], _opts: any,
        cb: (err: any, out: any) => void) => {
        if (args[0] === 'push') {
          const err: any = new Error('non-fast-forward');
          err.code = 1;
          err.stdout = '';
          err.stderr = 'rejected: non-fast-forward\n';
          cb(err, { stdout: '', stderr: '' });
        } else {
          cb(null, { stdout: '', stderr: '' });
        }
        return {} as any;
      }) as any,
    );
    const { app, handle } = mkApp();
    const runId = seedTerminalRun(handle);
    const r = await app.request(`/admin/runs/${runId}/push-github`, {
      method: 'POST',
      headers: { Authorization: 'Bearer sec', 'content-type': 'application/json' },
      body: JSON.stringify({
        remote_url: 'git@github.com:user/repo.git',
        branch: 'main', commit_message: 'x',
      }),
    });
    expect(r.status).toBe(500);
    const j = await r.json();
    expect(j.ok).toBe(false);
    const failed = j.steps.find((s: any) => s.exit !== 0);
    expect(failed).toBeDefined();
    expect(failed.output).toContain('non-fast-forward');
  });
});
