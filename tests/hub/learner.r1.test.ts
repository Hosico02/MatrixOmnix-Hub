import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDb, migrate } from '../../src/hub/db/client.js';
import {
  d2pInstances, runs, iterations, verdicts, findings, standards,
} from '../../src/hub/db/schema.js';
import { r1PersistentFinding } from '../../src/hub/learner/rules/r1_persistent_finding.js';

describe('R1 persistent_finding', () => {
  let handle: ReturnType<typeof openDb>;
  let instId: string;

  function seedRunWithFinding(category: string) {
    const runId = randomUUID();
    handle.db.insert(runs).values({
      id: runId, instanceId: instId, projectPath: '/p',
      detectedArchetype: 'fastapi-api',
      startedAt: new Date().toISOString(),
      terminalState: 'CLEAN',
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
      id: randomUUID(), verdictId: vdId, category, severity: 'medium',
      isNew: true,
    }).run();
  }

  beforeEach(() => {
    const p = join(mkdtempSync(join(tmpdir(), 'r1-')), 'h.db');
    handle = openDb(p);
    migrate(handle.sqlite);
    instId = randomUUID();
    handle.db.insert(d2pInstances).values({ id: instId, name: 'i', tokenHash: 'x' }).run();
    handle.db.insert(standards).values({
      id: randomUUID(), archetype: 'fastapi-api', version: 1,
      bodyMd: '- tests_run_and_pass\n- readme_cmd_matches_manifest',
      isCurrent: true, source: 'manual',
    }).run();
  });

  it('produces candidate when category in >=5 of last 10 runs not in standards', async () => {
    for (let i = 0; i < 7; i++) seedRunWithFinding('cors_policy_missing');
    for (let i = 0; i < 3; i++) seedRunWithFinding('other_thing');
    const cands = await r1PersistentFinding(handle);
    const corsCand = cands.find((c) => c.bodyMd.includes('cors_policy_missing'));
    expect(corsCand).toBeDefined();
    expect(corsCand!.proposalType).toBe('add_check');
  });

  it('does not propose for categories already in current standards', async () => {
    for (let i = 0; i < 7; i++) seedRunWithFinding('readme_cmd_matches_manifest');
    const cands = await r1PersistentFinding(handle);
    expect(cands.find((c) => c.bodyMd.includes('readme_cmd_matches_manifest')))
      .toBeUndefined();
  });
});
