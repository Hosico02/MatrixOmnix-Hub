import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDb, migrate } from '../../src/hub/db/client.js';
import { buildApp } from '../../src/hub/server.js';
import { RunSupervisor } from '../../src/hub/runner/supervisor.js';
import { d2pInstances } from '../../src/hub/db/schema.js';
import bcrypt from 'bcryptjs';

function mkEnv() {
  const root = mkdtempSync(join(tmpdir(), 'ext-int-'));
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
  // Seed an instance the integration test can authenticate as.
  // Pattern lifted from tests/hub/instanceLookup.test.ts:19.
  const tokenPlain = 'inst-token-xyz';
  const instId = randomUUID();
  handle.db.insert(d2pInstances).values({
    id: instId,
    name: 'ext-test',
    tokenHash: bcrypt.hashSync(tokenPlain, 4),
  }).run();
  return { app, root, handle, instId, tokenPlain };
}

describe('end-to-end: external d2p run becomes visible', () => {
  let env: ReturnType<typeof mkEnv>;
  beforeEach(() => { env = mkEnv(); });

  it('run_started → stdout poll → iter_complete → terminate → eof', async () => {
    const runId = 'run-20260527-ext';
    const logDir = join(env.root, 'project', '.d2p', runId);
    mkdirSync(logDir, { recursive: true });
    const logPath = join(logDir, 'd2p.log');
    writeFileSync(logPath, '');  // touch first, per contract

    // d2p posts run_started
    const r1 = await env.app.request('/api/events', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.tokenPlain}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'run_started',
        run_id: runId,
        payload: {
          project_path: join(env.root, 'project'),
          stdout_path: logPath,
          started_at: '2026-05-27T09:42:42Z',
          detected_archetype: 'node-cli',
        },
      }),
    });
    expect(r1.status).toBe(200);

    // First poll — empty file, still live
    appendFileSync(logPath, 'starting iter 1\n');
    const p1 = await env.app.request(
      `/admin/runs/${runId}/stdout?from=0`,
      { headers: { Authorization: 'Bearer sec' } },
    );
    const j1 = await p1.json();
    expect(j1.content).toBe('starting iter 1\n');
    expect(j1.eof).toBe(false);

    // d2p appends more, posts iteration_complete
    appendFileSync(logPath, 'iter 1 done\n');
    await env.app.request('/api/events', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.tokenPlain}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'iteration_complete',
        run_id: runId,
        payload: {
          iter_n: 1,
          started_at: 't1',
          ended_at: 't2',
          analyzer_summary: 'looks ok',
        },
      }),
    });

    // Incremental poll from offset
    const p2 = await env.app.request(
      `/admin/runs/${runId}/stdout?from=${j1.next_offset}`,
      { headers: { Authorization: 'Bearer sec' } },
    );
    const j2 = await p2.json();
    expect(j2.content).toBe('iter 1 done\n');
    expect(j2.eof).toBe(false);

    // Confirm /api/runs/:id surfaces the iteration so milestones panel works
    const detail = await env.app.request(`/api/runs/${runId}`);
    expect(detail.status).toBe(200);
    const dj = await detail.json();
    expect(dj.run.id).toBe(runId);
    expect(dj.iterations).toHaveLength(1);
    expect(dj.iterations[0].analyzer_summary).toBe('looks ok');

    // d2p posts run_terminated
    await env.app.request('/api/events', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.tokenPlain}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'run_terminated',
        run_id: runId,
        payload: {
          terminal_state: 'CLEAN',
          terminated_at: '2026-05-27T10:00:00Z',
          total_iterations: 1,
        },
      }),
    });

    // Final poll — at end of file, now eof:true
    const p3 = await env.app.request(
      `/admin/runs/${runId}/stdout?from=${j2.next_offset}`,
      { headers: { Authorization: 'Bearer sec' } },
    );
    const j3 = await p3.json();
    expect(j3.content).toBe('');
    expect(j3.eof).toBe(true);
  });
});
