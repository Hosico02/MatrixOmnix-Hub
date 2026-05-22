import { AnalyzerAgent } from '../../agents/AnalyzerAgent.js';
import { QACaseStore } from '../../qa/QACaseStore.js';
import { defaultSystemRoot } from './_shared.js';

/**
 * Self-check (verifier-only build): run analyze + gap against the
 * MatrixOmnix repo itself, and report active QA cases. Returns non-zero
 * if the analyzer/gap path errors. Phase 6/7/8 self-improvement probes
 * are removed alongside the do-layer they tested.
 */
export async function selfCheck(_flags: Record<string, string | boolean>): Promise<number> {
  const root = defaultSystemRoot();
  try {
    const analyzer = new AnalyzerAgent();
    const { snapshot, score, gap } = await analyzer.fullAnalyze(root);
    const store = new QACaseStore(root);
    const cases = await store.loadCases();
    const activeCases = cases.filter((c) => c.status === 'active');
    process.stdout.write(JSON.stringify({
      ok: true,
      project_path: snapshot.project_path,
      detected_archetype: snapshot.detected_archetype?.id ?? 'unknown',
      score: score.total,
      grade: score.grade,
      finding_count: gap.findings.length,
      blocker_count: gap.findings.filter((f) => f.severity === 'blocker').length,
      high_count: gap.findings.filter((f) => f.severity === 'high').length,
      qa_cases_total: cases.length,
      qa_cases_active: activeCases.length,
    }, null, 2) + '\n');
    return 0;
  } catch (err) {
    process.stderr.write(`self-check failed: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}
