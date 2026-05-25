import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { openDb, migrate } from '../../src/hub/db/client.js';
import { d2pInstances, runs } from '../../src/hub/db/schema.js';
import { RunSupervisor } from '../../src/hub/runner/supervisor.js';

function mkHandle() {
  const root = mkdtempSync(join(tmpdir(), 'sup-'));
  const h = openDb(join(root, 'h.db'));
  migrate(h.sqlite);
  return { handle: h, root };
}

describe('RunSupervisor', () => {
  let env: { handle: ReturnType<typeof openDb>; root: string };
  let sup: RunSupervisor;

  beforeEach(() => {
    env = mkHandle();
    sup = new RunSupervisor({
      handle: env.handle, dataDir: env.root, d2pPath: '/does/not/matter',
    });
  });

  afterEach(() => {
    sup.shutdown();
  });

  it('current() returns null when nothing is in flight', () => {
    expect(sup.current()).toBeNull();
  });

  it('acquire spawns and records an active run', () => {
    const runId = randomUUID();
    const ar = sup.acquire({
      runId, projectPath: '/tmp/x', command: 'echo',
      args: ['hello'], env: {},
    });
    expect(ar.runId).toBe(runId);
    expect(typeof ar.pid).toBe('number');
    expect(existsSync(ar.stdoutPath)).toBe(true);
    expect(sup.current()?.runId).toBe(runId);
  });

  it('acquire throws when a run is already in flight', () => {
    const runId = randomUUID();
    sup.acquire({
      runId, projectPath: '/tmp/x', command: 'sleep',
      args: ['1'], env: {},
    });
    expect(() => sup.acquire({
      runId: randomUUID(), projectPath: '/tmp/y', command: 'echo',
      args: [], env: {},
    })).toThrowError(/already.+flight/i);
  });

  it('marks orphan run as crashed when child exits without terminal_state', async () => {
    const runId = randomUUID();
    const instId = randomUUID();
    env.handle.db.insert(d2pInstances).values({
      id: instId, name: 'i', tokenHash: 'x',
    }).run();
    env.handle.db.insert(runs).values({
      id: runId, instanceId: instId, projectPath: '/tmp/x',
      startedAt: new Date().toISOString(),
    }).run();
    const ar = sup.acquire({
      runId, projectPath: '/tmp', command: 'echo',
      args: ['hi'], env: {},
    });
    await new Promise<void>((resolve) => {
      ar.child.on('exit', () => setTimeout(resolve, 50));
    });
    const row = env.handle.db.select().from(runs)
      .where(eq(runs.id, runId)).get();
    expect(row?.terminalState).toBe('crashed');
    expect(row?.terminatedAt).toBeTruthy();
  });

  it('does NOT overwrite terminal_state if d2p set it', async () => {
    const runId = randomUUID();
    const instId = randomUUID();
    env.handle.db.insert(d2pInstances).values({
      id: instId, name: 'i', tokenHash: 'x',
    }).run();
    env.handle.db.insert(runs).values({
      id: runId, instanceId: instId, projectPath: '/tmp/x',
      startedAt: new Date().toISOString(),
      terminalState: 'complete',
    }).run();
    const ar = sup.acquire({
      runId, projectPath: '/tmp', command: 'echo',
      args: ['hi'], env: {},
    });
    await new Promise<void>((resolve) => {
      ar.child.on('exit', () => setTimeout(resolve, 50));
    });
    const row = env.handle.db.select().from(runs)
      .where(eq(runs.id, runId)).get();
    expect(row?.terminalState).toBe('complete');
  });

  it('shutdown SIGTERMs the active child', async () => {
    const runId = randomUUID();
    const ar = sup.acquire({
      runId, projectPath: '/tmp', command: 'sleep',
      args: ['30'], env: {},
    });
    const exited = new Promise<number | null>((resolve) =>
      ar.child.on('exit', (code, _signal) => resolve(code)),
    );
    sup.shutdown();
    const code = await Promise.race([
      exited,
      new Promise<null>((r) => setTimeout(() => r(null), 1000)),
    ]);
    expect(sup.current()).toBeNull();
    expect(code !== undefined).toBe(true);
  });
});
