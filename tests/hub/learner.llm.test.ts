import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDb, migrate } from '../../src/hub/db/client.js';
import {
  d2pInstances, runs, iterations, verdicts, findings, standards, proposals,
} from '../../src/hub/db/schema.js';
import { runLlmSummariser } from '../../src/hub/learner/llm_summariser.js';

describe('LLM summariser', () => {
  let handle: ReturnType<typeof openDb>;
  beforeEach(() => {
    const p = join(mkdtempSync(join(tmpdir(), 'llm-')), 'h.db');
    handle = openDb(p);
    migrate(handle.sqlite);
    const instId = randomUUID();
    handle.db.insert(d2pInstances).values({ id: instId, name: 'i', tokenHash: 'x' }).run();
    handle.db.insert(standards).values({
      id: randomUUID(), archetype: 'fastapi-api', version: 1,
      bodyMd: '- baseline', isCurrent: true, source: 'manual',
    }).run();
    const runId = randomUUID();
    handle.db.insert(runs).values({
      id: runId, instanceId: instId, projectPath: '/p',
      detectedArchetype: 'fastapi-api',
      startedAt: new Date().toISOString(),
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
      id: randomUUID(), verdictId: vdId, category: 'wonky',
      severity: 'high', isNew: true,
    }).run();
  });

  it('inserts proposals based on mock LLM response', async () => {
    const mockClient = {
      messages: {
        create: async (_args: any) => ({
          content: [{
            type: 'text',
            text: JSON.stringify([
              {
                archetype: 'fastapi-api',
                proposal_type: 'reword',
                body_md: 'rephrase the baseline to be more specific',
                rationale_md: 'mock rationale',
                evidence_finding_ids: [],
              },
            ]),
          }],
        }),
      },
    };
    const n = await runLlmSummariser(handle, mockClient as any);
    expect(n).toBe(1);
    const ps = handle.db.select().from(proposals).all();
    expect(ps).toHaveLength(1);
    expect(ps[0].source).toBe('llm');
  });

  it('safely returns 0 when LLM returns unparseable response', async () => {
    const mockClient = {
      messages: {
        create: async () => ({ content: [{ type: 'text', text: 'not json' }] }),
      },
    };
    const n = await runLlmSummariser(handle, mockClient as any);
    expect(n).toBe(0);
  });
});
