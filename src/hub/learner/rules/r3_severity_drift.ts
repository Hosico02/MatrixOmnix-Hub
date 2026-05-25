import type { DbHandle } from '../../db/client.js';
import { standards } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import type { ProposalCandidate } from '../types.js';

const WINDOW_FINDINGS = 20;
const DISAGREE_THRESHOLD = 0.80;

function extractCheckSeverities(bodyMd: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const l of bodyMd.split('\n')) {
    const m = /^[-*]\s+([a-z0-9_]+)\s*:\s*(blocker|high|medium|low)/i.exec(l);
    if (m) out.set(m[1], m[2].toLowerCase());
  }
  return out;
}

export async function r3SeverityDrift(handle: DbHandle): Promise<ProposalCandidate[]> {
  const cands: ProposalCandidate[] = [];
  const stds = handle.db.select().from(standards).where(eq(standards.isCurrent, true)).all();
  for (const s of stds) {
    const decls = extractCheckSeverities(s.bodyMd);
    for (const [check, declSev] of decls) {
      const rows = handle.sqlite.prepare(`
        SELECT f.severity FROM findings f
        JOIN verdicts v ON v.id = f.verdict_id
        JOIN iterations i ON i.id = v.iteration_id
        JOIN runs r ON r.id = i.run_id
        WHERE r.detected_archetype = ? AND f.category = ?
        ORDER BY r.started_at DESC
        LIMIT ?
      `).all(s.archetype, check, WINDOW_FINDINGS) as { severity: string }[];
      if (rows.length < WINDOW_FINDINGS) continue;
      const counts = new Map<string, number>();
      for (const r of rows) counts.set(r.severity, (counts.get(r.severity) ?? 0) + 1);
      let dominant: string | null = null, dominantPct = 0;
      for (const [sev, n] of counts) {
        const pct = n / rows.length;
        if (pct > dominantPct) { dominant = sev; dominantPct = pct; }
      }
      if (dominant && dominant !== declSev && dominantPct >= DISAGREE_THRESHOLD) {
        cands.push({
          archetype: s.archetype,
          proposalType: 'adjust_weight',
          bodyMd: `adjust severity of ${check}: declared ${declSev}, observed ${dominant} in ${Math.round(dominantPct * 100)}% of last ${WINDOW_FINDINGS}.`,
          rationaleMd: `R3: severity disagreement for ${check}.`,
          source: 'rule', evidenceFindingIds: [],
        });
      }
    }
  }
  return cands;
}
