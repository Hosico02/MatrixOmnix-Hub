import type {
  ProjectSnapshot,
  ProjectScore,
  GapReport,
  ProjectStandard,
} from '../core/types.js';
import { takeSnapshot } from '../core/projectSnapshot.js';
import { scoreProject } from '../core/projectScorer.js';
import { scoreProjectWithEvidence, type EvidenceWeightedOptions } from '../core/evidenceWeightedScorer.js';
import { analyzeGaps } from '../core/gapAnalyzer.js';
import { detectArchetype } from '../core/projectArchetypeDetector.js';
import { DEFAULT_PROJECT_STANDARD } from '../standards/defaultProjectStandard.js';
import { selectStandardForProject, selectStandardForSnapshot } from '../standards/standardsLibrary.js';

export class AnalyzerAgent {
  /** If `undefined`, the analyzer auto-selects per snapshot. */
  constructor(private standard?: ProjectStandard) {}

  private async resolve(snapshot: ProjectSnapshot): Promise<{ standard: ProjectStandard; name: string }> {
    if (this.standard) return { standard: this.standard, name: 'caller-supplied' };
    try {
      return await selectStandardForProject(snapshot.project_path, snapshot);
    } catch {
      return { standard: DEFAULT_PROJECT_STANDARD, name: 'fallback-default' };
    }
  }

  /**
   * Attach the primary archetype to a snapshot. Pure annotation — never
   * mutates the input, returns a new object. Failures are swallowed so a
   * detector bug never blocks analyze/gap.
   */
  private async withArchetype(snap: ProjectSnapshot): Promise<ProjectSnapshot> {
    if (snap.detected_archetype) return snap;
    try {
      const report = await detectArchetype(snap.project_path, snap);
      const p = report.primary;
      return {
        ...snap,
        detected_archetype: {
          id: p.id,
          name: p.name,
          confidence: p.confidence,
          recommended_standard: p.recommended_standard,
          risk_profile: p.risk_profile,
        },
      };
    } catch {
      return snap;
    }
  }

  async snapshot(projectPath: string): Promise<ProjectSnapshot> {
    const snap = await takeSnapshot(projectPath);
    return this.withArchetype(snap);
  }

  async score(snapshot: ProjectSnapshot): Promise<ProjectScore> {
    const { standard } = await this.resolve(snapshot);
    return scoreProject(snapshot, standard);
  }

  async scoreWithEvidence(snapshot: ProjectSnapshot, opts: EvidenceWeightedOptions = {}): Promise<ProjectScore> {
    const { standard } = await this.resolve(snapshot);
    return scoreProjectWithEvidence(snapshot, standard, opts);
  }

  async gap(snapshot: ProjectSnapshot, score: ProjectScore): Promise<GapReport> {
    const { standard } = await this.resolve(snapshot);
    return analyzeGaps(snapshot, score, standard);
  }

  async fullAnalyze(projectPath: string): Promise<{
    snapshot: ProjectSnapshot;
    score: ProjectScore;
    gap: GapReport;
    standard_name: string;
  }> {
    const snap = await this.snapshot(projectPath);
    const { standard, name: standardName } = await this.resolve(snap);
    const score = await scoreProject(snap, standard);
    const gap = await analyzeGaps(snap, score, standard);
    return { snapshot: snap, score: gap.score, gap, standard_name: standardName };
  }

  async fullAnalyzeWithEvidence(projectPath: string, opts: EvidenceWeightedOptions = {}): Promise<{
    snapshot: ProjectSnapshot;
    score: ProjectScore;
    gap: GapReport;
    standard_name: string;
  }> {
    const snap = await this.snapshot(projectPath);
    const { standard, name: standardName } = await this.resolve(snap);
    const score = await scoreProjectWithEvidence(snap, standard, opts);
    const gap = await analyzeGaps(snap, score, standard);
    return { snapshot: snap, score: gap.score, gap, standard_name: standardName };
  }
}
