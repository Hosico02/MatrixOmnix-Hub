import type { DbHandle } from '../../db/client.js';
import { standards } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import type { ProposalCandidate } from '../types.js';

const WINDOW_DAYS = 30;

function extractChecks(bodyMd: string): string[] {
  const lines = bodyMd.split('\n');
  const out: string[] = [];
  for (const l of lines) {
    const m = /^[-*]\s+([a-z0-9_]+)/i.exec(l);
    if (m) out.push(m[1]);
  }
  return out;
}

export async function r2CheckNeverFires(handle: DbHandle): Promise<ProposalCandidate[]> {
  const since = new Date(Date.now() - WINDOW_DAYS * 86400_000).toISOString();
  const stds = handle.db.select().from(standards).where(eq(standards.isCurrent, true)).all();
  const cands: ProposalCandidate[] = [];
  for (const s of stds) {
    const checks = extractChecks(s.bodyMd);
    for (const ck of checks) {
      const hits = handle.sqlite.prepare(`
        SELECT COUNT(*) AS n FROM findings f
        JOIN verdicts v ON v.id = f.verdict_id
        JOIN iterations i ON i.id = v.iteration_id
        JOIN runs r ON r.id = i.run_id
        WHERE r.detected_archetype = ?
          AND f.category = ?
          AND r.started_at > ?
      `).get(s.archetype, ck, since) as { n: number };
      if (hits.n === 0) {
        cands.push({
          archetype: s.archetype,
          proposalType: 'remove_check',
          bodyMd: `remove check ${ck}: no finding observed for ${WINDOW_DAYS} days.`,
          rationaleMd: `R2: ${ck} never fired in the last ${WINDOW_DAYS} days; may be obsolete.`,
          source: 'rule',
          evidenceFindingIds: [],
        });
      }
    }
  }
  return cands;
}
