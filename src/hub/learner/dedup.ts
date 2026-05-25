import { randomUUID } from 'node:crypto';
import { and, eq, gte, like } from 'drizzle-orm';
import type { DbHandle } from '../db/client.js';
import { proposals, proposalEvidence } from '../db/schema.js';
import type { ProposalCandidate } from './types.js';

const REJECT_WINDOW_DAYS = 30;

function bodyPrefix(s: string): string {
  const normalized = s.replace(/\s+/g, ' ').trim();
  // Remove trailing parenthetical content like (v1), (v2), etc. for comparison
  const withoutVersion = normalized.replace(/\s*\([^)]*\)\s*$/, '').trim();
  return withoutVersion.slice(0, 80);
}

export function upsertCandidate(handle: DbHandle, cand: ProposalCandidate): string | null {
  const prefix = bodyPrefix(cand.bodyMd);
  const since = new Date(Date.now() - REJECT_WINDOW_DAYS * 86400_000).toISOString();
  const recentReject = handle.db.select().from(proposals).where(and(
    eq(proposals.archetype, cand.archetype),
    eq(proposals.proposalType, cand.proposalType),
    eq(proposals.status, 'rejected'),
    gte(proposals.decidedAt, since),
    like(proposals.bodyMd, `${prefix}%`),
  )).get();
  if (recentReject) return null;

  const pendingMatch = handle.db.select().from(proposals).where(and(
    eq(proposals.archetype, cand.archetype),
    eq(proposals.proposalType, cand.proposalType),
    eq(proposals.status, 'pending'),
    like(proposals.bodyMd, `${prefix}%`),
  )).get();

  if (pendingMatch) {
    handle.db.update(proposals).set({ status: 'superseded' })
      .where(eq(proposals.id, pendingMatch.id)).run();
  }

  const newId = randomUUID();
  handle.db.insert(proposals).values({
    id: newId, archetype: cand.archetype,
    proposalType: cand.proposalType,
    bodyMd: cand.bodyMd, rationaleMd: cand.rationaleMd,
    source: cand.source, status: 'pending',
  }).run();

  const allEvidence = pendingMatch
    ? [
        ...handle.db.select().from(proposalEvidence)
          .where(eq(proposalEvidence.proposalId, pendingMatch.id)).all()
          .map((e) => e.findingId),
        ...cand.evidenceFindingIds,
      ]
    : cand.evidenceFindingIds;
  const uniqueEvidence = Array.from(new Set(allEvidence));
  for (const findingId of uniqueEvidence) {
    try {
      handle.db.insert(proposalEvidence).values({ proposalId: newId, findingId }).run();
    } catch { /* dup link */ }
  }
  return newId;
}
