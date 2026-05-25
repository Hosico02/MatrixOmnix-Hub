import type { DbHandle } from '../../db/client.js';
import type { ProposalCandidate } from '../types.js';

const WINDOW_RUNS = 10;
const THRESHOLD = 5;

export async function r1PersistentFinding(handle: DbHandle): Promise<ProposalCandidate[]> {
  const rows = handle.sqlite.prepare(`
    WITH recent_runs AS (
      SELECT id, detected_archetype, ROW_NUMBER() OVER (
        PARTITION BY detected_archetype ORDER BY started_at DESC
      ) AS rn
      FROM runs
      WHERE detected_archetype IS NOT NULL
    ),
    in_window AS (
      SELECT id, detected_archetype FROM recent_runs WHERE rn <= ?
    ),
    cat_counts AS (
      SELECT iw.detected_archetype AS archetype, f.category,
             COUNT(DISTINCT iw.id) AS run_count
      FROM in_window iw
      JOIN iterations i ON i.run_id = iw.id
      JOIN verdicts v ON v.iteration_id = i.id
      JOIN findings f ON f.verdict_id = v.id
      GROUP BY iw.detected_archetype, f.category
      HAVING run_count >= ?
    )
    SELECT cc.archetype, cc.category, cc.run_count, s.body_md
    FROM cat_counts cc
    LEFT JOIN standards s ON s.archetype = cc.archetype AND s.is_current = 1
  `).all(WINDOW_RUNS, THRESHOLD) as Array<{
    archetype: string; category: string; run_count: number; body_md: string | null;
  }>;

  const cands: ProposalCandidate[] = [];
  for (const r of rows) {
    if (r.body_md && r.body_md.includes(r.category)) continue;
    cands.push({
      archetype: r.archetype,
      proposalType: 'add_check',
      bodyMd: `check ${r.category}: this category appeared in ${r.run_count} of the last ${WINDOW_RUNS} runs but is not yet in standards.`,
      rationaleMd: `R1: ${r.category} appears in ${r.run_count}/${WINDOW_RUNS} recent ${r.archetype} runs; not currently checked.`,
      source: 'rule',
      evidenceFindingIds: collectFindingIds(handle, r.archetype, r.category, WINDOW_RUNS),
    });
  }
  return cands;
}

function collectFindingIds(
  handle: DbHandle, archetype: string, category: string, windowRuns: number,
): string[] {
  const rows = handle.sqlite.prepare(`
    SELECT f.id FROM findings f
    JOIN verdicts v ON v.id = f.verdict_id
    JOIN iterations i ON i.id = v.iteration_id
    JOIN runs r ON r.id = i.run_id
    WHERE r.detected_archetype = ? AND f.category = ?
    ORDER BY r.started_at DESC
    LIMIT ?
  `).all(archetype, category, windowRuns * 5) as { id: string }[];
  return rows.map((r) => r.id);
}
