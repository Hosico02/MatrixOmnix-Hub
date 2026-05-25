import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDb, migrate } from '../../src/hub/db/client.js';
import { proposals } from '../../src/hub/db/schema.js';
import { upsertCandidate } from '../../src/hub/learner/dedup.js';
import type { ProposalCandidate } from '../../src/hub/learner/types.js';

const cand = (over: Partial<ProposalCandidate> = {}): ProposalCandidate => ({
  archetype: 'fastapi-api',
  proposalType: 'add_check',
  bodyMd: 'check cors_policy_explicit',
  rationaleMd: 'seen 7/10',
  source: 'rule',
  evidenceFindingIds: [],
  ...over,
});

describe('dedup', () => {
  let handle: ReturnType<typeof openDb>;
  beforeEach(() => {
    const p = join(mkdtempSync(join(tmpdir(), 'dd-')), 'h.db');
    handle = openDb(p);
    migrate(handle.sqlite);
  });

  it('first candidate inserts as pending', () => {
    upsertCandidate(handle, cand());
    const ps = handle.db.select().from(proposals).all();
    expect(ps).toHaveLength(1);
    expect(ps[0].status).toBe('pending');
  });

  it('similar candidate supersedes the prior', () => {
    upsertCandidate(handle, cand({ bodyMd: 'check cors_policy_explicit (v1)' }));
    upsertCandidate(handle, cand({ bodyMd: 'check cors_policy_explicit (v2)' }));
    const ps = handle.db.select().from(proposals).all();
    expect(ps).toHaveLength(2);
    const superseded = ps.filter((p) => p.status === 'superseded');
    const pending = ps.filter((p) => p.status === 'pending');
    expect(superseded).toHaveLength(1);
    expect(pending).toHaveLength(1);
  });

  it('does not re-propose if a similar one was rejected recently', () => {
    const propId = randomUUID();
    handle.db.insert(proposals).values({
      id: propId, archetype: 'fastapi-api', proposalType: 'add_check',
      bodyMd: 'check cors_policy_explicit', rationaleMd: 'r', source: 'rule',
      status: 'rejected', decidedAt: new Date().toISOString(), decidedBy: 'human',
    }).run();
    upsertCandidate(handle, cand());
    const pending = handle.db.select().from(proposals).all()
      .filter((p) => p.status === 'pending');
    expect(pending).toHaveLength(0);
  });
});
