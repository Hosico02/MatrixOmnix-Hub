import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDb, migrate } from '../../src/hub/db/client.js';
import {
  d2pInstances, runs, iterations, verdicts, findings,
} from '../../src/hub/db/schema.js';
import { dispatchIngest } from '../../src/hub/ingest/eventHandlers.js';

describe('event handlers', () => {
  let handle: ReturnType<typeof openDb>;
  let inst: { id: string; name: string; tokenHash: string };
  beforeEach(() => {
    const p = join(mkdtempSync(join(tmpdir(), 'eh-')), 'h.db');
    handle = openDb(p);
    migrate(handle.sqlite);
    inst = { id: randomUUID(), name: 'dev', tokenHash: 'x' };
    handle.db.insert(d2pInstances).values(inst).run();
  });

  it('run_started upserts a run', () => {
    dispatchIngest(handle, inst, 'run_started', 'run-1', {
      project_path: '/p', detected_archetype: 'fastapi-api',
      started_at: '2026-05-25T10:00:00Z',
    });
    const r = handle.db.select().from(runs).all();
    expect(r).toHaveLength(1);
    expect(r[0].terminalState).toBe('RUNNING');
  });

  it('iteration_complete out-of-order creates placeholder then fills', () => {
    dispatchIngest(handle, inst, 'iteration_complete', 'run-2', {
      iter_n: 1, started_at: 't1', ended_at: 't2',
    });
    dispatchIngest(handle, inst, 'run_started', 'run-2', {
      project_path: '/q', detected_archetype: 'node-server',
      started_at: 't0',
    });
    const r = handle.db.select().from(runs).all();
    expect(r).toHaveLength(1);
    expect(r[0].projectPath).toBe('/q');
    expect(handle.db.select().from(iterations).all()).toHaveLength(1);
  });

  it('verdict + finding chain inserts correctly', () => {
    dispatchIngest(handle, inst, 'run_started', 'r3', {
      project_path: '/p', started_at: 't0',
    });
    dispatchIngest(handle, inst, 'iteration_complete', 'r3', {
      iter_n: 1, started_at: 't1', ended_at: 't2',
    });
    dispatchIngest(handle, inst, 'verdict_emitted', 'r3', {
      iter_n: 1, verdict: 'needs_repair', confidence: 0.7,
      stability_signal: 'new_findings',
    });
    dispatchIngest(handle, inst, 'finding_recorded', 'r3', {
      iter_n: 1, category: 'missing_env_example',
      severity: 'low', message: 'no .env.example', is_new: true,
    });
    expect(handle.db.select().from(verdicts).all()).toHaveLength(1);
    const f = handle.db.select().from(findings).all();
    expect(f).toHaveLength(1);
    expect(f[0].category).toBe('missing_env_example');
  });

  it('run_terminated sets terminal_state + totals', () => {
    dispatchIngest(handle, inst, 'run_started', 'r4', {
      project_path: '/p', started_at: 't0',
    });
    dispatchIngest(handle, inst, 'run_terminated', 'r4', {
      terminal_state: 'CLEAN', terminated_at: 't9',
      total_cost_usd: 1.20, total_iterations: 6,
    });
    const r = handle.db.select().from(runs).all();
    expect(r[0].terminalState).toBe('CLEAN');
    expect(r[0].totalIterations).toBe(6);
  });

  it('run_started persists stdout_path when provided', () => {
    dispatchIngest(handle, inst, 'run_started', 'run-sp1', {
      project_path: '/p',
      stdout_path: '/p/.d2p/run-sp1/d2p.log',
      started_at: 't0',
    });
    const r = handle.db.select().from(runs).all();
    expect(r).toHaveLength(1);
    expect(r[0].stdoutPath).toBe('/p/.d2p/run-sp1/d2p.log');
  });

  it('run_started leaves stdout_path NULL when omitted', () => {
    dispatchIngest(handle, inst, 'run_started', 'run-sp2', {
      project_path: '/p',
      started_at: 't0',
    });
    const r = handle.db.select().from(runs).all();
    expect(r[0].stdoutPath).toBeNull();
  });

  it('run_started twice for same id — second stdout_path wins', () => {
    dispatchIngest(handle, inst, 'run_started', 'run-dup', {
      project_path: '/p', stdout_path: '/p/.d2p/run-dup/first.log', started_at: 't0',
    });
    dispatchIngest(handle, inst, 'run_started', 'run-dup', {
      project_path: '/p', stdout_path: '/p/.d2p/run-dup/second.log', started_at: 't1',
    });
    const r = handle.db.select().from(runs).all();
    expect(r).toHaveLength(1);
    expect(r[0].stdoutPath).toBe('/p/.d2p/run-dup/second.log');
  });
});
