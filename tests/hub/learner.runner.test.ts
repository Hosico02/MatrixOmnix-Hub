import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDb, migrate } from '../../src/hub/db/client.js';
import {
  d2pInstances, runs, iterations, verdicts, findings, standards, proposals,
} from '../../src/hub/db/schema.js';
import { runRulePass } from '../../src/hub/learner/runner.js';

describe('runner.runRulePass', () => {
  let handle: ReturnType<typeof openDb>;
  beforeEach(() => {
    const p = join(mkdtempSync(join(tmpdir(), 'rn-')), 'h.db');
    handle = openDb(p);
    migrate(handle.sqlite);
    const instId = randomUUID();
    handle.db.insert(d2pInstances).values({ id: instId, name: 'i', tokenHash: 'x' }).run();
    handle.db.insert(standards).values({
      id: randomUUID(), archetype: 'fastapi-api', version: 1,
      bodyMd: '- known_check', isCurrent: true, source: 'manual',
    }).run();
    for (let i = 0; i < 7; i++) {
      const runId = randomUUID();
      handle.db.insert(runs).values({
        id: runId, instanceId: instId, projectPath: '/p',
        detectedArchetype: 'fastapi-api',
        startedAt: new Date(Date.now() - i * 60_000).toISOString(),
      }).run();
      const itId = randomUUID();
      handle.db.insert(iterations).values({
        id: itId, runId, iterN: 1, startedAt: new Date().toISOString(),
      }).run();
      const vdId = randomUUID();
      handle.db.insert(verdicts).values({
        id: vdId, iterationId: itId, verdict: 'needs_repair',
      }).run();
      handle.db.insert(findings).values({
        id: randomUUID(), verdictId: vdId, category: 'cors_missing',
        severity: 'high', isNew: true,
      }).run();
    }
  });

  it('produces proposals into table', async () => {
    const created = await runRulePass(handle, { disabledRules: new Set() });
    expect(created).toBeGreaterThanOrEqual(1);
    const ps = handle.db.select().from(proposals).all();
    expect(ps.some((p) => p.bodyMd.includes('cors_missing'))).toBe(true);
  });

  it('skips disabled rules', async () => {
    const created = await runRulePass(handle, { disabledRules: new Set(['R1']) });
    const ps = handle.db.select().from(proposals).all();
    expect(ps.some((p) => p.bodyMd.includes('cors_missing'))).toBe(false);
  });
});
