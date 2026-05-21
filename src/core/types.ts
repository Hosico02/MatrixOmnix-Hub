/**
 * Core types for Demo2Project.
 *
 * Everything is plain TypeScript — no zod, no runtime schema deps — to keep
 * the dependency surface minimal. Validation happens at boundaries via small
 * narrow helpers in src/utils.
 */

export type Severity = 'blocker' | 'high' | 'medium' | 'low' | 'info';
export type TaskStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'skipped';
export type AgentName =
  | 'supervisor'
  | 'analyzer'
  | 'planner'
  | 'executor'
  | 'verifier'
  | 'reviewer'
  | 'advisory'
  | 'memory'
  | 'qa';

// --- Iteration events ----------------------------------------------------

export interface IterationEvent {
  id: string;
  iteration_id: string;
  timestamp: string;
  agent: AgentName;
  event_type:
    | 'task_assigned'
    | 'task_started'
    | 'task_completed'
    | 'task_failed'
    | 'command_run'
    | 'verification_passed'
    | 'verification_failed'
    | 'review_finding'
    | 'qa_case_created'
    | 'qa_case_updated'
    | 'iteration_started'
    | 'iteration_finished'
    | 'note';
  severity: Severity;
  message: string;
  command?: string;
  command_exit_code?: number;
  files_changed?: string[];
  raw_output?: string; // truncated
  metadata?: Record<string, unknown>;
}

// --- Tasks & results -----------------------------------------------------

export interface AgentTask {
  id: string;
  iteration_id: string;
  assigned_to: AgentName;
  title: string;
  description: string;
  acceptance_criteria: string[];
  expected_changed_files: string[];
  verification_commands: string[];
  priority: Severity;
  status: TaskStatus;
}

export interface VerificationResult {
  command: string;
  exit_code: number;
  stdout_summary: string;
  stderr_summary: string;
  passed: boolean;
  duration_ms: number;
  failure_reason?: string;
}

export interface AgentResult {
  task_id: string;
  agent: AgentName;
  status: TaskStatus;
  summary: string;
  changed_files: string[];
  commands_run: string[];
  verification_evidence: VerificationResult[];
  unable_to_verify_reason?: string;
  failures: string[];
  risks: string[];
  next_steps: string[];
}

// --- Project snapshot, score, gaps, plan ---------------------------------

export interface ProjectSnapshot {
  project_path: string;
  detected_language: string;
  detected_frameworks: string[];
  package_manager: 'pnpm' | 'npm' | 'yarn' | 'bun' | 'pip' | 'poetry' | 'unknown';
  test_commands: string[];
  build_commands: string[];
  start_commands: string[];
  important_files: string[];
  missing_files: string[];
  dependency_summary: {
    runtime: number;
    dev: number;
    has_lockfile: boolean;
  };
  timestamp: string;
  /**
   * Populated by AnalyzerAgent (Session 4). Carries the primary archetype
   * detected for this project so downstream consumers — gap analyzer,
   * generalization bench, library-vs-app gates — don't need to re-detect.
   * Optional because callers of `takeSnapshot` directly skip detection.
   */
  detected_archetype?: {
    id: string;
    name: string;
    confidence: number;
    recommended_standard: string;
    risk_profile: 'low' | 'medium' | 'high';
  };
}

export interface ScoreBreakdown {
  structure_score: number;
  test_score: number;
  build_score: number;
  runtime_score: number;
  docs_score: number;
  config_score: number;
  maintainability_score: number;
  safety_score: number;
  agent_process_score: number;
}

export type ProjectGrade =
  | 'raw_demo'
  | 'working_demo'
  | 'structured_prototype'
  | 'project_ready_candidate'
  | 'production_ready_baseline';

export interface ScoreEvidenceEntry {
  dimension: keyof ScoreBreakdown;
  claimed: boolean;
  verified: boolean;
  evidence_command?: string;
  result?: 'passed' | 'failed' | 'unrun';
  confidence: 'high' | 'medium' | 'low';
  notes?: string;
  stdout_summary?: string;
  stderr_summary?: string;
  failure_reason?: string;
}

export interface ScoreGateFailure {
  gate: 'test' | 'build' | 'verification' | 'gap' | 'start' | 'docs' | 'product_maturity';
  cap: number;
  reason: string;
  evidence_command?: string;
  stdout_summary?: string;
  stderr_summary?: string;
  failure_reason?: string;
}

export interface ScoreGateResult {
  status: 'passed' | 'failed';
  cap: number;
  failures: ScoreGateFailure[];
}

export interface ProjectScore {
  total: number; // 0-100
  grade: ProjectGrade;
  breakdown: ScoreBreakdown;
  notes: string[];
  /**
   * Populated when scoring was run with `evidence_weighted=true`. Each entry
   * records whether a dimension's claim was actually verified by running a
   * command. Dimensions without verification get partial-credit only.
   */
  score_evidence?: ScoreEvidenceEntry[];
  score_gate?: ScoreGateResult;
}

export type ProductMaturityLevel =
  | 'demo'
  | 'engineering_baseline'
  | 'domain_product_candidate'
  | 'market_parity_candidate'
  | 'market_ready';

export interface ProductCapabilityAssessment {
  id: string;
  label: string;
  met: boolean;
  evidence: string[];
  required_for_market_parity: boolean;
}

export interface ProductMaturityAssessment {
  domain: string;
  target_market: string;
  score: number;
  level: ProductMaturityLevel;
  summary: string;
  capabilities: ProductCapabilityAssessment[];
  missing_capabilities: string[];
  references: string[];
}

export interface GapFinding {
  id: string;
  category: string;
  severity: Severity;
  message: string;
  why_it_matters: string;
  suggested_fix: string;
  related_files: string[];
}

export type AdvisoryAgentRole =
  | 'market_comparator'
  | 'gap_critic'
  | 'planner_critic'
  | 'reviewer_critic';

export type AdvisoryConfidence = 'high' | 'medium' | 'low';

export interface AdvisoryFinding {
  category: string;
  severity: Severity;
  message: string;
  why_it_matters: string;
  suggested_fix: string;
  related_files: string[];
  confidence: AdvisoryConfidence;
  source_urls: string[];
  evidence: string[];
}

export interface AdvisoryTaskProposal {
  title: string;
  description: string;
  acceptance_criteria: string[];
  expected_changed_files: string[];
  verification_commands: string[];
  priority: Severity;
  confidence: AdvisoryConfidence;
  source_urls: string[];
}

export interface AdvisoryReport {
  schema_version: 1;
  generated_at: string;
  role: AdvisoryAgentRole;
  provider: string;
  model?: string;
  gate_policy: string;
  findings: AdvisoryFinding[];
  task_proposals: AdvisoryTaskProposal[];
  risks: string[];
  raw_summary: string;
}

export interface AgentMisjudgmentAudit {
  finding_id: string;
  finding_category: string;
  action: 'suppress_finding' | 'require_more_evidence';
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  related_files: string[];
}

export interface GapReport {
  project_snapshot: ProjectSnapshot;
  score: ProjectScore;
  findings: GapFinding[];
  blockers: GapFinding[];
  recommendations: string[];
  product_maturity?: ProductMaturityAssessment;
  agent_misjudgments?: AgentMisjudgmentAudit[];
  advisory_reports?: AdvisoryReport[];
}

export interface IterationPlan {
  iteration_id: string;
  goal: string;
  project_path: string;
  tasks: AgentTask[];
  qa_focus_cases?: string[];
  risk_level: Severity;
  expected_score_delta: number;
  stop_conditions: string[];
  advisory_focus?: string[];
}

// --- QA ------------------------------------------------------------------

export interface QAHumanFlowStep {
  step: number;
  actor: string;
  action: string;
}

export type QAScope = 'repo' | 'workspace' | 'global';
export type QAPortability = 'low' | 'medium' | 'high';
/**
 * Phase-3 lifecycle:
 *   new       — generated, not yet observed in preflight
 *   active    — referenced in preflight at least once
 *   confirmed — true_positive_count >= 2 (prevented real failures)
 *   noisy     — false_positive_count > true_positive_count and ≥ 3 sightings
 *   retired   — manually retired OR auto-retired after staleness threshold
 */
export type QACaseLifecycle = 'new' | 'active' | 'confirmed' | 'noisy' | 'retired';

export interface QACase {
  id: string;
  title: string;
  category: string;
  severity: Severity;
  frequency: number;
  /** Legacy status field. New code should also set `lifecycle`. */
  status: 'active' | 'resolved' | 'archived';
  /** Phase-3 lifecycle. Falls back to `status` if absent. */
  lifecycle?: QACaseLifecycle;
  scope?: QAScope;
  portability?: QAPortability;
  /** Computed quality signal: TP - FP, clamped. Higher is more useful. */
  usefulness_score?: number;
  true_positive_count?: number;
  false_positive_count?: number;
  last_triggered_at?: string;
  last_prevented_failure_at?: string;
  manual_review_required?: boolean;
  retired_at?: string;
  retirement_reason?: string;
  /** Phase-5 transferability metadata. */
  transferability?: {
    scope: QAScope;
    portability_score: number; // 0..1
    applicable_archetypes: string[];
    excluded_archetypes: string[];
    required_project_signals: string[];
    excluded_project_signals: string[];
    minimum_confidence: 'low' | 'medium' | 'high';
    examples_where_triggered: string[];
    examples_where_prevented_failure: string[];
    false_positive_contexts: string[];
  };
  project_type: string[];
  bug_source: {
    iteration_id: string;
    agent: AgentName | 'unknown';
    source: string;
    related_files: string[];
  };
  trigger_condition: string;
  human_flow: QAHumanFlowStep[];
  expected_behavior: string;
  actual_failure: string;
  regression_assertions: string[];
  reproduction_steps: string[];
  suggested_test_type: string;
  fingerprint: string;
  created_at: string;
  updated_at: string;
  last_seen_at: string;
  related_files: string[];
}

export interface QARegressionSpec {
  version: string;
  updated_at: string;
  assertions: string[];
  cases: QACase[];
}

export interface QAAssertionResult {
  assertion: string;
  passed: boolean;
  message: string;
  related_events: string[];
}

// --- Project standard ----------------------------------------------------

export interface QualityGate {
  name: string;
  command?: string;
  required: boolean;
  description: string;
}

export interface ScoringRule {
  dimension: keyof ScoreBreakdown;
  weight: number;
}

export interface ProjectStandard {
  required_files: string[];
  recommended_files: string[];
  required_commands: string[]; // e.g. "test", "build"
  quality_gates: QualityGate[];
  scoring_rules: ScoringRule[];
  forbidden_patterns: string[]; // regex strings
  verification_policy: {
    require_evidence_when_files_changed: boolean;
    max_command_timeout_ms: number;
    forbid_unverified_completion: boolean;
  };
}

// --- Iteration summary ---------------------------------------------------

export interface IterationSummary {
  iteration_id: string;
  user_goal: string;
  project_path: string;
  project_snapshot: ProjectSnapshot;
  gap_report: GapReport;
  iteration_plan: IterationPlan;
  assigned_tasks: AgentTask[];
  executor_results: AgentResult[];
  changed_files: string[];
  verification_results: VerificationResult[];
  reviewer_findings: string[];
  qa_cases_created_or_updated: string[];
  project_score_before: ProjectScore;
  project_score_after: ProjectScore;
  next_iteration_recommendations: string[];
  started_at: string;
  finished_at: string;
}
