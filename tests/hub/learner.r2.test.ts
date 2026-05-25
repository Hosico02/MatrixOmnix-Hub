import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDb, migrate } from '../../src/hub/db/client.js';
import {
  d2pInstances, runs, iterations, verdicts, findings, standards,
} from '../../src/hub/db/schema.js';
import { r2CheckNeverFires } from '../../src/hub/learner/rules/r2_check_never_fires.js';

describe('R2 check_never_fires', () => {
  let handle: ReturnType<typeof openDb>;
  let instId: string;
  beforeEach(() => {
    const p = join(mkdtempSync(join(tmpdir(), 'r2-')), 'h.db');
    handle = openDb(p);
    migrate(handle.sqlite);
    instId = randomUUID();
    handle.db.insert(d2pInstances).values({ id: instId, name: 'i', tokenHash: 'x' }).run();
    handle.db.insert(standards).values({
      id: randomUUID(), archetype: 'fastapi-api', version: 1,
      bodyMd: '- check_a\n- check_b\n- check_c',
      isCurrent: true, source: 'manual',
    }).run();
  });

  function recentFinding(category: string, daysAgo: number) {
    const runId = randomUUID();
    handle.db.insert(runs).values({
      id: runId, instanceId: instId, projectPath: '/p',
      detectedArchetype: 'fastapi-api',
      startedAt: new Date(Date.now() - daysAgo * 86400_000).toISOString(),
    }).run();
    const itId = randomUUID();
    handle.db.insert(iterations).values({
      id: itId, runId, iterN: 1, startedAt: new Date().toISOString(),
    }).run();
    const vdId = randomUUID();
    handle.db.insert(verdicts).values({
      id: vdId, iterationId: itId, verdict: 'pass',
    }).run();
    handle.db.insert(findings).values({
      id: randomUUID(), verdictId: vdId, category, severity: 'low', isNew: true,
    }).run();
  }

  it('proposes remove_check for checks with no findings in 30 days', async () => {
    recentFinding('check_a', 5);
    recentFinding('check_b', 15);
    const cands = await r2CheckNeverFires(handle);
    expect(cands.find((c) => c.bodyMd.includes('check_c'))).toBeDefined();
    expect(cands.find((c) => c.bodyMd.includes('check_a'))).toBeUndefined();
  });
});
