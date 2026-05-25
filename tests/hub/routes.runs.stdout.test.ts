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
  return { app, root };
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
});
