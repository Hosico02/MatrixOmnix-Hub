import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDb, migrate } from '../../src/hub/db/client.js';
import { buildApp } from '../../src/hub/server.js';
import { RunSupervisor } from '../../src/hub/runner/supervisor.js';

function mkApp() {
  const root = mkdtempSync(join(tmpdir(), 'std-'));
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
  return { app, root, handle };
}

describe('GET /admin/runs/:id/stdout', () => {
  let env: ReturnType<typeof mkApp>;
  beforeEach(() => { env = mkApp(); });

  it('404 when the log file does not exist', async () => {
    const r = await env.app.request(
      `/admin/runs/${randomUUID()}/stdout?from=0`,
      { headers: { Authorization: 'Bearer sec' } },
    );
    expect(r.status).toBe(404);
  });

  it('returns content + next_offset when a log exists', async () => {
    const id = randomUUID();
    const logDir = join(env.root, 'runner-logs');
    mkdirSync(logDir, { recursive: true });
    writeFileSync(join(logDir, `${id}.log`), 'hello world\n');
    const r = await env.app.request(
      `/admin/runs/${id}/stdout?from=0`,
      { headers: { Authorization: 'Bearer sec' } },
    );
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.content).toBe('hello world\n');
    expect(j.next_offset).toBe(12);
    expect(j.eof).toBe(true);
  });

  it('honours from= offset for incremental tail', async () => {
    const id = randomUUID();
    const logDir = join(env.root, 'runner-logs');
    mkdirSync(logDir, { recursive: true });
    writeFileSync(join(logDir, `${id}.log`), '0123456789');
    const r = await env.app.request(
      `/admin/runs/${id}/stdout?from=4`,
      { headers: { Authorization: 'Bearer sec' } },
    );
    const j = await r.json();
    expect(j.content).toBe('456789');
    expect(j.next_offset).toBe(10);
  });

  it('uses runs.stdout_path for external runs (no supervisor entry)', async () => {
    const { runs, d2pInstances } = await import('../../src/hub/db/schema.js');
    const inst = { id: randomUUID(), name: 'ext', tokenHash: 'x' };
    const handle = env.handle;
    handle.db.insert(d2pInstances).values(inst).run();
    const extDir = join(env.root, 'ext');
    mkdirSync(extDir, { recursive: true });
    const extPath = join(extDir, 'd2p.log');
    writeFileSync(extPath, 'external content\n');
    handle.db.insert(runs).values({
      id: 'run-ext-1',
      instanceId: inst.id,
      projectPath: '/p',
      startedAt: 't0',
      stdoutPath: extPath,
    }).run();
    const r = await env.app.request(
      `/admin/runs/run-ext-1/stdout?from=0`,
      { headers: { Authorization: 'Bearer sec' } },
    );
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.content).toBe('external content\n');
    expect(j.eof).toBe(false); // run has no terminatedAt → still live
  });

  it('external run with terminatedAt=null reports eof:false at end of file', async () => {
    const { runs, d2pInstances } = await import('../../src/hub/db/schema.js');
    const inst = { id: randomUUID(), name: 'ext', tokenHash: 'x' };
    const handle = env.handle;
    handle.db.insert(d2pInstances).values(inst).run();
    const extPath = join(env.root, 'live.log');
    writeFileSync(extPath, 'partial\n');
    handle.db.insert(runs).values({
      id: 'run-live', instanceId: inst.id, projectPath: '/p',
      startedAt: 't0', stdoutPath: extPath, terminatedAt: null,
    }).run();
    const r = await env.app.request(
      `/admin/runs/run-live/stdout?from=0`,
      { headers: { Authorization: 'Bearer sec' } },
    );
    const j = await r.json();
    expect(j.content).toBe('partial\n');
    expect(j.eof).toBe(false);
  });

  it('external run with terminatedAt set reports eof:true at end of file', async () => {
    const { runs, d2pInstances } = await import('../../src/hub/db/schema.js');
    const inst = { id: randomUUID(), name: 'ext', tokenHash: 'x' };
    const handle = env.handle;
    handle.db.insert(d2pInstances).values(inst).run();
    const extPath = join(env.root, 'done.log');
    writeFileSync(extPath, 'finished\n');
    handle.db.insert(runs).values({
      id: 'run-done', instanceId: inst.id, projectPath: '/p',
      startedAt: 't0', stdoutPath: extPath, terminatedAt: 't9',
      terminalState: 'CLEAN',
    }).run();
    const r = await env.app.request(
      `/admin/runs/run-done/stdout?from=0`,
      { headers: { Authorization: 'Bearer sec' } },
    );
    const j = await r.json();
    expect(j.content).toBe('finished\n');
    expect(j.eof).toBe(true);
  });

  it('external run with NULL stdout_path falls back to runner-logs (404 if absent)', async () => {
    const { runs, d2pInstances } = await import('../../src/hub/db/schema.js');
    const inst = { id: randomUUID(), name: 'ext', tokenHash: 'x' };
    const handle = env.handle;
    handle.db.insert(d2pInstances).values(inst).run();
    handle.db.insert(runs).values({
      id: 'run-nopath', instanceId: inst.id, projectPath: '/p',
      startedAt: 't0', stdoutPath: null,
    }).run();
    const r = await env.app.request(
      `/admin/runs/run-nopath/stdout?from=0`,
      { headers: { Authorization: 'Bearer sec' } },
    );
    expect(r.status).toBe(404);
  });
});
