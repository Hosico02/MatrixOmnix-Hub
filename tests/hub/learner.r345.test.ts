import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDb, migrate } from '../../src/hub/db/client.js';
import {
  d2pInstances, runs, iterations, verdicts, findings, standards,
} from '../../src/hub/db/schema.js';
import { r3SeverityDrift } from '../../src/hub/learner/rules/r3_severity_drift.js';
import { r4ArchetypeDrift } from '../../src/hub/learner/rules/r4_archetype_drift.js';
import { r5RepeatedResidual } from '../../src/hub/learner/rules/r5_repeated_residual.js';

describe('R3/R4/R5', () => {
  let handle: ReturnType<typeof openDb>;
  let instId: string;
  beforeEach(() => {
    const p = join(mkdtempSync(join(tmpdir(), 'r345-')), 'h.db');
    handle = openDb(p);
    migrate(handle.sqlite);
    instId = randomUUID();
    handle.db.insert(d2pInstances).values({ id: instId, name: 'i', tokenHash: 'x' }).run();
    handle.db.insert(standards).values({
      id: randomUUID(), archetype: 'fastapi-api', version: 1,
      bodyMd: '- check_x: high', isCurrent: true, source: 'manual',
    }).run();
  });

  function seedFindings(category: string, severity: string, count: number) {
    for (let i = 0; i < count; i++) {
      const runId = randomUUID();
      handle.db.insert(runs).values({
        id: runId, instanceId: instId, projectPath: '/p',
        detectedArchetype: 'fastapi-api',
        startedAt: new Date(Date.now() - i * 3600_000).toISOString(),
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
        id: randomUUID(), verdictId: vdId, category, severity, isNew: true,
      }).run();
    }
  }

  it('R3: severity disagreement -> adjust_weight', async () => {
    seedFindings('check_x', 'medium', 17);
    seedFindings('check_x', 'high', 3);
    const cands = await r3SeverityDrift(handle);
    expect(cands.find((c) => c.proposalType === 'adjust_weight' && c.bodyMd.includes('check_x'))).toBeDefined();
  });

  it('R4: archetype drift -> mentor_note style proposal', async () => {
    for (const arch of ['fastapi-api', 'node-server', 'fastapi-api']) {
      const runId = randomUUID();
      handle.db.insert(runs).values({
        id: runId, instanceId: instId, projectPath: '/same-project',
        detectedArchetype: arch,
        startedAt: new Date().toISOString(),
      }).run();
    }
    const cands = await r4ArchetypeDrift(handle);
    expect(cands.length).toBeGreaterThan(0);
  });

  it('R5: repeated residual within one run -> reword', async () => {
    const runId = randomUUID();
    handle.db.insert(runs).values({
      id: runId, instanceId: instId, projectPath: '/p',
      detectedArchetype: 'fastapi-api',
      startedAt: new Date().toISOString(),
    }).run();
    for (let iter = 1; iter <= 3; iter++) {
      const itId = randomUUID();
      handle.db.insert(iterations).values({
        id: itId, runId, iterN: iter, startedAt: new Date().toISOString(),
      }).run();
      const vdId = randomUUID();
      handle.db.insert(verdicts).values({
        id: vdId, iterationId: itId, verdict: 'needs_repair',
      }).run();
      handle.db.insert(findings).values({
        id: randomUUID(), verdictId: vdId,
        category: 'tricky_thing', severity: 'medium', isNew: iter === 1,
      }).run();
    }
    const cands = await r5RepeatedResidual(handle);
    expect(cands.find((c) => c.bodyMd.includes('tricky_thing'))).toBeDefined();
  });
});
