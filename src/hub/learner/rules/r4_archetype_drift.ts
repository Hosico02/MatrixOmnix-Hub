import type { DbHandle } from '../../db/client.js';
import type { ProposalCandidate } from '../types.js';

export async function r4ArchetypeDrift(handle: DbHandle): Promise<ProposalCandidate[]> {
  const rows = handle.sqlite.prepare(`
    WITH ordered AS (
      SELECT project_path, detected_archetype, started_at,
             ROW_NUMBER() OVER (PARTITION BY project_path ORDER BY started_at DESC) AS rn
      FROM runs WHERE detected_archetype IS NOT NULL
    )
    SELECT project_path, GROUP_CONCAT(detected_archetype) AS arches
    FROM ordered WHERE rn <= 3
    GROUP BY project_path
    HAVING COUNT(DISTINCT detected_archetype) > 1
  `).all() as { project_path: string; arches: string }[];

  return rows.map((r) => ({
    archetype: r.arches.split(',')[0],
    proposalType: 'reword' as const,
    bodyMd: `archetype drift on ${r.project_path}: recent runs detected ${r.arches}. Consider tightening archetype heuristics.`,
    rationaleMd: `R4: 3 consecutive runs detected different archetypes for the same project.`,
    source: 'rule',
    evidenceFindingIds: [],
  }));
}
