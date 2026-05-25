import type { DbHandle } from '../../db/client.js';
import type { ProposalCandidate } from '../types.js';

const REPEAT_THRESHOLD = 3;

export async function r5RepeatedResidual(handle: DbHandle): Promise<ProposalCandidate[]> {
  const rows = handle.sqlite.prepare(`
    SELECT r.id AS run_id, r.detected_archetype AS archetype,
           f.category, COUNT(*) AS appearances
    FROM findings f
    JOIN verdicts v ON v.id = f.verdict_id
    JOIN iterations i ON i.id = v.iteration_id
    JOIN runs r ON r.id = i.run_id
    GROUP BY r.id, r.detected_archetype, f.category
    HAVING appearances >= ?
  `).all(REPEAT_THRESHOLD) as Array<{
    run_id: string; archetype: string; category: string; appearances: number;
  }>;

  return rows.filter((r) => r.archetype).map((r) => ({
    archetype: r.archetype,
    proposalType: 'reword' as const,
    bodyMd: `clarify ${r.category}: d2p reported it ${r.appearances} times within a single run (run ${r.run_id.slice(0, 8)}), suggesting the check description may be ambiguous or hard to fix.`,
    rationaleMd: `R5: repeated residual.`,
    source: 'rule',
    evidenceFindingIds: [],
  }));
}
