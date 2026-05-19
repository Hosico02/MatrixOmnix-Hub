import type {
  GapReport,
  IterationPlan,
  AgentTask,
  Severity,
  QACase,
  AdvisoryReport,
  AdvisoryTaskProposal,
} from './types.js';
import { shortId } from '../utils/time.js';
import { existsSync } from 'node:fs';
import path from 'node:path';

const DEFAULT_MAX_TASKS_PER_ITERATION = 4;
const EXPANDED_MAX_TASKS_PER_ITERATION = 6;
const MAX_QA_FOCUS_CASES = 3;

export interface PlanIterationOptions {
  qaCases?: QACase[];
}

/**
 * Turn a GapReport into a small, scoped IterationPlan.
 *
 * Important guarantees:
 *  - Every task carries acceptance_criteria.
 *  - Every task carries at least one verification_command (or a placeholder
 *    that the Executor will be required to replace).
 *  - We keep ordinary rounds small, but allow a wider batch when the backlog
 *    is broad and dominated by deterministic productization work.
 */
export function planIteration(
  gapReport: GapReport,
  goal: string,
  iterationId: string = shortId('iter'),
  opts: PlanIterationOptions = {},
): IterationPlan {
  const snapshot = gapReport.project_snapshot;
  const qaFocusCases = selectQaFocusCases(opts.qaCases ?? []);
  const sortedFindings = gapReport.findings
    .slice()
    .filter((finding) => !isRedundantMaturityFinding(finding, gapReport))
    .sort((a, b) => {
      const findingDelta = planFindingRank(a) - planFindingRank(b);
      if (findingDelta !== 0) return findingDelta;
      return sevRank(a.severity) - sevRank(b.severity);
    });
  const tasks: AgentTask[] = [];
  const selectedFindings: typeof sortedFindings = [];
  const selectedAdvisoryTasks: AgentTask[] = [];
  const seenTaskKeys = new Set<string>();
  const maxTasks = maxTasksForGap(gapReport);
  const advisoryTasks = buildAdvisoryTasks(gapReport.advisory_reports ?? [], iterationId, snapshot.project_path, maxTasks);
  const maxFindingTasks = advisoryTasks.length > 0 ? Math.max(1, maxTasks - 1) : maxTasks;

  for (const f of sortedFindings) {
    const task = buildTaskForFinding(
      f,
      iterationId,
      tasks.length,
      snapshot.detected_language,
      snapshot.test_commands,
      snapshot.build_commands,
    );
    const key = taskDedupKey(task);
    if (seenTaskKeys.has(key)) continue;
    seenTaskKeys.add(key);
    tasks.push(task);
    selectedFindings.push(f);
    if (tasks.length >= maxFindingTasks) break;
  }
  for (const advisoryTask of advisoryTasks) {
    const key = taskDedupKey(advisoryTask);
    if (seenTaskKeys.has(key)) continue;
    seenTaskKeys.add(key);
    tasks.push(advisoryTask);
    selectedAdvisoryTasks.push(advisoryTask);
    if (tasks.length >= maxTasks) break;
  }
  applyQaFocus(tasks, qaFocusCases);

  const riskLevel: Severity = gapReport.findings.some((f) => f.severity === 'blocker')
    ? 'blocker'
    : gapReport.findings.some((f) => f.severity === 'high')
      ? 'high'
      : 'medium';

  const expectedDelta = Math.min(
    25,
    selectedFindings.reduce((acc, f) => acc + scoreDeltaForFinding(f.severity), 0),
  );

  return {
    iteration_id: iterationId,
    goal,
    project_path: snapshot.project_path,
    tasks,
    qa_focus_cases: qaFocusCases.map((c) => c.fingerprint),
    risk_level: riskLevel,
    expected_score_delta: expectedDelta,
    stop_conditions: [
      'project_score >= 86 (production_ready_baseline)',
      'no_open_gap_findings',
      'no_progress_for_two_iterations',
      'unrecoverable_blocker_encountered',
      'safety_violation_detected',
      'user_requested_stop',
    ],
    advisory_focus: selectedAdvisoryTasks.map((task) => task.description.match(/Advisory role: ([^\n]+)/)?.[1] ?? task.title),
  };
}

function maxTasksForGap(gapReport: GapReport): number {
  const findings = gapReport.findings.filter((finding) => !isRedundantMaturityFinding(finding, gapReport));
  const severeCount = findings.filter((finding) => finding.severity === 'blocker' || finding.severity === 'high').length;
  const deterministicCount = findings.filter((finding) => isDeterministicProductizationCategory(finding.category)).length;
  const earlyBacklog = findings.length >= 10 && severeCount >= 6 && deterministicCount >= 5;
  const deterministicMiddleOrCloseout = findings.length >= 8 && severeCount >= 3 && deterministicCount >= 8;
  if (earlyBacklog || deterministicMiddleOrCloseout) {
    return EXPANDED_MAX_TASKS_PER_ITERATION;
  }
  return DEFAULT_MAX_TASKS_PER_ITERATION;
}

function isDeterministicProductizationCategory(category: string): boolean {
  return [
    'missing_required_file',
    'no_python_tests',
    'missing_required_command',
    'missing_api_contract_harness',
    'missing_config_contract_harness',
    'missing_python_dependency_constraints',
    'unbounded_python_dependencies',
    'missing_healthcheck',
    'missing_config_guard',
    'missing_api_tests',
    'missing_security_headers',
    'missing_start_input_validation',
    'missing_active_game_limit',
    'missing_industrial_api_tests',
    'missing_regression_tests',
    'missing_user_llm_provider_config',
    'broken_llm_provider_select_options',
    'incomplete_llm_provider_catalog',
    'llm_provider_catalog_missing_official_models',
    'missing_social_deduction_rules_engine',
    'random_social_deduction_tie_breaker',
    'missing_social_deduction_rule_tests',
    'missing_social_deduction_mode_validation',
    'missing_social_deduction_mode_tests',
    'missing_social_deduction_mode_startup_guard',
    'missing_game_design_doc',
    'missing_recommended_file',
    'missing_wsgi_entrypoint',
    'missing_python_production_server',
    'missing_deployment_artifact',
    'flask_docker_uses_dev_server',
    'no_ci',
    'misaligned_ci',
    'ci_ignores_python_constraints',
    'missing_deployment_docs',
    'missing_operational_docs',
    'missing_structured_logging',
    'demo_shell_without_product_core',
  ].includes(category);
}

function buildAdvisoryTasks(reports: AdvisoryReport[], iterationId: string, projectPath: string, maxTasks: number): AgentTask[] {
  const candidates: AgentTask[] = [];
  for (const report of reports) {
    for (const proposal of report.task_proposals) {
      if (!isActionableAdvisoryProposal(proposal)) continue;
      candidates.push({
        id: shortId('task'),
        iteration_id: iterationId,
        assigned_to: 'executor',
        title: proposal.title,
        description: [
          proposal.description,
          '',
          `Advisory role: ${report.role}: ${proposal.title}`,
          `Advisory source (${proposal.confidence} confidence): ${proposal.source_urls.join(', ')}`,
          'Advisory agents can propose this work, but verifier/scorer gates remain authoritative.',
        ].join('\n'),
        acceptance_criteria: proposal.acceptance_criteria,
        expected_changed_files: proposal.expected_changed_files.length > 0
          ? proposal.expected_changed_files
          : ['(advisory proposal did not name expected files)'],
        verification_commands: proposal.verification_commands,
        priority: proposal.priority,
        status: 'pending',
      });
    }
  }
  const seen = new Set<string>();
  const tasks: AgentTask[] = [];
  for (const task of candidates.sort((a, b) => {
    const rankDelta = advisoryTaskRank(a) - advisoryTaskRank(b);
    if (rankDelta !== 0) return rankDelta;
    return sevRank(a.priority) - sevRank(b.priority);
  })) {
    if (isAlreadySatisfiedMarketAdvisoryTask(task, projectPath)) continue;
    const key = taskDedupKey(task);
    if (seen.has(key)) continue;
    seen.add(key);
    tasks.push(task);
    if (tasks.length >= maxTasks) break;
  }
  return tasks;
}

function isAlreadySatisfiedMarketAdvisoryTask(task: AgentTask, projectPath: string): boolean {
  if (!/^close market capability gap:/i.test(task.title)) return false;
  const expectedFiles = task.expected_changed_files
    .filter((file) => file && !file.startsWith('(') && !/[*{}]/.test(file));
  if (expectedFiles.length === 0) return false;
  return expectedFiles.every((file) => existsSync(path.join(projectPath, file)));
}

function isActionableAdvisoryProposal(proposal: AdvisoryTaskProposal): boolean {
  return (proposal.confidence === 'high' || proposal.confidence === 'medium') &&
    proposal.source_urls.some((url) => /^https?:\/\//i.test(url)) &&
    proposal.verification_commands.length > 0 &&
    proposal.acceptance_criteria.length > 0;
}

function selectQaFocusCases(cases: QACase[]): QACase[] {
  return cases
    .filter((c) => c.status === 'active' && c.lifecycle !== 'retired')
    .sort((a, b) => {
      const severityDelta = sevRank(a.severity) - sevRank(b.severity);
      if (severityDelta !== 0) return severityDelta;
      const usefulnessDelta = (b.usefulness_score ?? 0) - (a.usefulness_score ?? 0);
      if (usefulnessDelta !== 0) return usefulnessDelta;
      return (b.frequency ?? 0) - (a.frequency ?? 0);
    })
    .slice(0, MAX_QA_FOCUS_CASES);
}

function applyQaFocus(tasks: AgentTask[], cases: QACase[]): void {
  if (cases.length === 0) return;
  const guardrailText = cases
    .map((c) => `[${c.severity}] ${c.fingerprint}: ${c.expected_behavior || c.title}`)
    .join('\n');

  for (const task of tasks) {
    task.description = `${task.description}\n\nKnown QA guardrails:\n${guardrailText}`;
    for (const c of cases) {
      const assertion = c.regression_assertions[0] ?? c.expected_behavior ?? c.title;
      task.acceptance_criteria.push(`QA guard ${c.fingerprint}: ${assertion}`);
    }
    if (cases.some((c) => c.severity === 'blocker')) {
      task.priority = maxSeverity(task.priority, 'blocker');
    } else if (cases.some((c) => c.severity === 'high')) {
      task.priority = maxSeverity(task.priority, 'high');
    }
  }
}

function isRedundantMaturityFinding(finding: GapReport['findings'][number], gapReport: GapReport): boolean {
  if (finding.category !== 'below_agent_social_deduction_theater_maturity') return false;
  const missing = gapReport.product_maturity?.missing_capabilities ?? [];
  const onlyDeploymentMissing = missing.length > 0 && missing.every((capability) => /deployable runtime|ci hooks/i.test(capability));
  if (onlyDeploymentMissing && gapReport.findings.some((f) =>
    [
      'flask_docker_uses_dev_server',
      'missing_wsgi_entrypoint',
      'missing_python_production_server',
      'missing_deployment_artifact',
      'missing_deployment_docs',
      'missing_operational_docs',
    ].includes(f.category),
  )) return true;

  return missing.length > 0 && missing.every((capability) => maturityCapabilityCoveredBySpecificFinding(capability, gapReport));
}

function maturityCapabilityCoveredBySpecificFinding(capability: string, gapReport: GapReport): boolean {
  if (/deterministic rules|rules engine|guardrails/i.test(capability)) {
    return gapReport.findings.some((f) =>
      [
        'missing_social_deduction_rules_engine',
        'random_social_deduction_tie_breaker',
        'missing_social_deduction_rule_tests',
        'missing_social_deduction_mode_validation',
        'missing_social_deduction_mode_tests',
        'missing_social_deduction_mode_startup_guard',
        'missing_game_design_doc',
      ].includes(f.category),
    );
  }
  if (/deployable runtime|ci hooks|deployment|docker|wsgi|gunicorn/i.test(capability)) {
    return gapReport.findings.some((f) =>
      [
        'flask_docker_uses_dev_server',
        'missing_wsgi_entrypoint',
        'missing_python_production_server',
        'missing_deployment_artifact',
        'missing_deployment_docs',
        'missing_operational_docs',
        'missing_recommended_file',
        'no_ci',
        'misaligned_ci',
        'ci_ignores_python_constraints',
      ].includes(f.category),
    );
  }
  return false;
}

function maxSeverity(a: Severity, b: Severity): Severity {
  return sevRank(a) <= sevRank(b) ? a : b;
}

function taskDedupKey(task: AgentTask): string {
  const family = taskFamily(task.title);
  if (family) return family;
  return [
    task.title,
    task.expected_changed_files.join('|'),
    task.verification_commands.join('|'),
  ].join('\0');
}

function taskFamily(title: string): string | null {
  const normalized = title.trim().toLowerCase();
  if (
    /^(add player-supplied llm provider configuration|repair llm provider select option labels|expand player-selectable llm provider catalog)$/.test(normalized) ||
    /^close market capability gap:\s*agent model and provider configuration$/.test(normalized)
  ) {
    return 'capability:agent_model_configuration';
  }
  if (
    /^close market capability gap:\s*(simulation replay and observability|agent evaluation harness)$/.test(normalized) ||
    /^harden agent-facing werewolf product loop$/.test(normalized)
  ) {
    return 'capability:agent_evaluation_harness';
  }
  if (
    /^close market capability gap:\s*deterministic rules and agent guardrails$/.test(normalized) ||
    /^add social deduction rules engine$/.test(normalized)
  ) {
    return 'capability:deterministic_rules_and_guardrails';
  }
  if (
    /^add flask deployment scaffold$/.test(normalized) ||
    /^address gap: missing_recommended_file \((dockerfile|wsgi\.py)\)$/.test(normalized) ||
    /^address gap: (missing_wsgi_entrypoint|missing_python_production_server|missing_deployment_artifact|flask_docker_uses_dev_server)\b/.test(normalized) ||
    (/dockerfile|wsgi|gunicorn/.test(normalized) && /deployment scaffold|production server|public demo deployment/.test(normalized))
  ) {
    return 'deploy:python_wsgi_scaffold';
  }
  if (
    /^document public demo deployment$/.test(normalized) ||
    /^add deployment section to readme\.md$/.test(normalized) ||
    (/deployment/.test(normalized) && /readme/.test(normalized))
  ) {
    return 'docs:deployment';
  }
  if (
    /^add operational documentation$/.test(normalized) ||
    /^create docs\/architecture\.md$/.test(normalized) ||
    /^create docs\/operations\.md$/.test(normalized) ||
    (/docs\/(architecture|operations)\.md/.test(normalized)) ||
    (/operational|operations|architecture/.test(normalized) && /docs?/.test(normalized))
  ) {
    return 'docs:operations';
  }
  return null;
}

function advisoryTaskRank(task: AgentTask): number {
  const family = taskFamily(task.title);
  if (family === 'capability:agent_evaluation_harness') return 0;
  if (family === 'capability:deterministic_rules_and_guardrails') return 1;
  if (family === 'capability:agent_model_configuration') return 2;
  return 10;
}

function scoreDeltaForFinding(sev: Severity): number {
  switch (sev) {
    case 'blocker': return 10;
    case 'high': return 6;
    case 'medium': return 3;
    case 'low': return 1;
    default: return 0;
  }
}

function sevRank(s: Severity): number {
  switch (s) {
    case 'blocker': return 0;
    case 'high': return 1;
    case 'medium': return 2;
    case 'low': return 3;
    default: return 4;
  }
}

function planFindingRank(f: GapReport['findings'][number]): number {
  if (/^failed_.*verification$|^repair_failed_verification$/.test(f.category)) return 0;
  if (f.category === 'no_python_tests') return 1;
  if (f.category === 'missing_required_command' && /\bpytest\b/.test(f.message)) return 1;
  if (isProductContractOrSurfaceCategory(f.category)) return 2;
  return 3;
}

function isProductContractOrSurfaceCategory(category: string): boolean {
  return [
    'single_file_demo_without_intake_harness',
    'missing_cli_contract_harness',
    'missing_api_contract_harness',
    'missing_api_runtime_behaviour_test',
    'missing_config_contract_harness',
    'missing_config_runtime_load_test',
    'missing_data_migration_harness',
    'missing_db_crud_runtime_tests',
    'missing_multi_service_integration_check',
    'missing_worker_contract_harness',
    'missing_worker_runtime_enqueue_test',
    'missing_notebook_runtime_execution_test',
    'missing_media_pipeline_runtime_test',
    'missing_ml_model_runtime_inference_test',
    'missing_game_runtime_loop_test',
    'missing_3d_scene_runtime_render_test',
    'missing_browser_extension_runtime_manifest_test',
    'missing_mobile_runtime_bundle_test',
    'missing_desktop_runtime_boot_test',
    'missing_llm_prompt_eval_harness',
    'missing_llm_provider_failure_fallback',
    'missing_llm_token_budget_enforcement',
    'missing_llm_prompt_template_registry',
    'missing_llm_streaming_response',
    'missing_demo_surface_contract_matrix',
    'missing_browser_extension_contract_harness',
    'missing_notebook_contract_harness',
    'missing_mobile_contract_harness',
    'missing_desktop_contract_harness',
    'missing_game_contract_harness',
    'missing_3d_scene_contract_harness',
    'missing_ml_model_contract_harness',
    'missing_media_pipeline_contract_harness',
    'demo_shell_without_product_core',
    'missing_product_runtime_entry',
    'missing_ui_product_verification',
    'below_web_ui_product_maturity',
    'missing_ui_runtime_render_smoke',
    'ui_unimplemented_hosted_service_claim',
    'missing_user_llm_provider_config',
    'broken_llm_provider_select_options',
    'incomplete_llm_provider_catalog',
    'llm_provider_catalog_missing_official_models',
    'llm_provider_catalog_outdated_against_official_refresh',
  ].includes(category);
}

function buildTaskForFinding(
  f: GapReport['findings'][number],
  iterationId: string,
  idx: number,
  detectedLanguage: string,
  testCommands: string[],
  buildCommands: string[],
): AgentTask {
  const baseAccept = ['change applied without regressions', 'verification command exits 0'];
  const verifyForTest = testCommands.length > 0 ? testCommands : ['echo "no test command configured"'];
  const verifyForBuild = buildCommands.length > 0 ? buildCommands : ['echo "no build command configured"'];

  switch (f.category) {
    case 'missing_readme':
    case 'thin_readme':
      return {
        id: shortId('task'),
        iteration_id: iterationId,
        assigned_to: 'executor',
        title: 'Author or extend README.md',
        description: f.message,
        acceptance_criteria: [
          'README.md exists',
          'README contains Install + Usage sections',
          'README length >= 400 chars',
        ],
        expected_changed_files: ['README.md'],
        verification_commands: ['test -s README.md'],
        priority: f.severity,
        status: 'pending',
      };
    case 'no_tests':
      return {
        id: shortId('task'),
        iteration_id: iterationId,
        assigned_to: 'executor',
        title: 'Bootstrap a minimal test suite',
        description: f.message,
        acceptance_criteria: [
          'a test file exists under tests/ or alongside src/',
          'test runner command exits 0',
          'at least 1 assertion executes',
        ],
        expected_changed_files: ['tests/*'],
        verification_commands: verifyForTest,
        priority: f.severity,
        status: 'pending',
      };
    case 'missing_required_command': {
      if (/pytest/.test(f.message)) {
        return {
          id: shortId('task'),
          iteration_id: iterationId,
          assigned_to: 'executor',
          title: 'Add pytest-compatible verification',
          description: f.message,
          acceptance_criteria: ['pytest-compatible tests exist', 'test command exits 0'],
          expected_changed_files: ['tests/test_smoke.py', 'requirements.txt', 'package.json'],
          verification_commands: ['python3 -m pytest -q'],
          priority: f.severity,
          status: 'pending',
        };
      }
      const isTest = /test/.test(f.message);
      return {
        id: shortId('task'),
        iteration_id: iterationId,
        assigned_to: 'executor',
        title: isTest ? 'Add a test script' : 'Add a build script',
        description: f.message,
        acceptance_criteria: [
          'package.json (or equivalent) exposes the required script',
          'the script runs to completion',
        ],
        expected_changed_files: ['package.json'],
        verification_commands: isTest ? verifyForTest : verifyForBuild,
        priority: f.severity,
        status: 'pending',
      };
    }
    case 'missing_env_example':
      return {
        id: shortId('task'),
        iteration_id: iterationId,
        assigned_to: 'executor',
        title: 'Add .env.example',
        description: f.message,
        acceptance_criteria: ['.env.example exists', 'lists each env var used in the codebase'],
        expected_changed_files: ['.env.example'],
        verification_commands: ['test -f .env.example'],
        priority: f.severity,
        status: 'pending',
      };
    case 'single_file_demo_without_intake_harness':
      return {
        id: shortId('task'),
        iteration_id: iterationId,
        assigned_to: 'executor',
        title: 'Add single-file demo intake harness',
        description: f.message,
        acceptance_criteria: [
          'docs/demo-intake.md records the source demo entry and inferred runtime',
          'scripts/demo-runtime-check.mjs performs deterministic entry checks without network access',
          'package.json exposes demo:intake-check for repeatable validation',
          'runtime contract is safe for Python, JavaScript/TypeScript and static HTML single-file demos',
        ],
        expected_changed_files: ['docs/demo-intake.md', 'scripts/demo-runtime-check.mjs', 'package.json'],
        verification_commands: ['node scripts/demo-runtime-check.mjs'],
        priority: f.severity,
        status: 'pending',
      };
    case 'missing_cli_contract_harness':
      return {
        id: shortId('task'),
        iteration_id: iterationId,
        assigned_to: 'executor',
        title: 'Add CLI executable contract harness',
        description: f.message,
        acceptance_criteria: [
          'scripts/cli-contract-check.mjs invokes the detected CLI entry with --help',
          'contract check fails when the entrypoint is missing, exits nonzero or produces empty help output',
          'docs/cli-contract.md documents the executable entry and verification command',
          'package scripts expose cli:contract-check without replacing test/build validation',
        ],
        expected_changed_files: ['scripts/cli-contract-check.mjs', 'docs/cli-contract.md', 'package.json'],
        verification_commands: ['node scripts/cli-contract-check.mjs'],
        priority: f.severity,
        status: 'pending',
      };
    case 'missing_api_contract_harness':
      return {
        id: shortId('task'),
        iteration_id: iterationId,
        assigned_to: 'executor',
        title: 'Add API contract harness',
        description: f.message,
        acceptance_criteria: [
          'docs/api-contract.md documents the detected API surface and contract boundary',
          'docs/api-contract.md and scripts/api-contract-check.mjs are created together in the same task',
          'scripts/api-contract-check.mjs fails when no API surface evidence exists',
          'scripts/api-contract-check.mjs uses syntax-tolerant route/API evidence checks rather than brittle source string formatting assumptions',
          'package scripts expose api:contract-check without replacing test/build validation',
        ],
        expected_changed_files: ['docs/api-contract.md', 'scripts/api-contract-check.mjs', 'package.json'],
        verification_commands: ['node scripts/api-contract-check.mjs'],
        priority: f.severity,
        status: 'pending',
      };
    case 'missing_config_contract_harness':
      return {
        id: shortId('task'),
        iteration_id: iterationId,
        assigned_to: 'executor',
        title: 'Add config contract harness',
        description: f.message,
        acceptance_criteria: [
          'scripts/config-contract-check.mjs extracts env var usage from source files',
          '.env.example documents every detected env var',
          'docs/config-contract.md records the runtime configuration boundary',
          'package scripts expose config:contract-check',
        ],
        expected_changed_files: ['docs/config-contract.md', 'scripts/config-contract-check.mjs', '.env.example', 'package.json'],
        verification_commands: ['node scripts/config-contract-check.mjs'],
        priority: f.severity,
        status: 'pending',
      };
    case 'missing_data_migration_harness':
      return {
        id: shortId('task'),
        iteration_id: iterationId,
        assigned_to: 'executor',
        title: 'Add data migration contract harness',
        description: f.message,
        acceptance_criteria: [
          'docs/data-contract.md records schema/migration expectations',
          'scripts/data-contract-check.mjs verifies migration, schema or model evidence exists',
          'package scripts expose data:contract-check',
        ],
        expected_changed_files: ['docs/data-contract.md', 'scripts/data-contract-check.mjs', 'package.json'],
        verification_commands: ['node scripts/data-contract-check.mjs'],
        priority: f.severity,
        status: 'pending',
      };
    case 'missing_ml_model_runtime_inference_test':
      return {
        id: shortId('task'),
        iteration_id: iterationId,
        assigned_to: 'executor',
        title: 'Add ML model runtime inference test',
        description: f.message,
        acceptance_criteria: [
          'tests/ml-runtime.test.mjs is created with a test that attempts to load the model artifact and run inference',
          'the test uses dynamic import for onnxruntime-node / joblib / torch and gracefully skips when the library cannot be loaded',
          'when the library loads, the test runs inference with synthetic input and asserts the output is non-empty',
          'the test never depends on real training data or network downloads',
        ],
        expected_changed_files: ['tests/ml-runtime.test.mjs'],
        verification_commands: ['node --test tests/ml-runtime.test.mjs'],
        priority: f.severity,
        status: 'pending',
      };
    case 'missing_game_runtime_loop_test':
      return {
        id: shortId('task'),
        iteration_id: iterationId,
        assigned_to: 'executor',
        title: 'Add game runtime loop test',
        description: f.message,
        acceptance_criteria: [
          'tests/game-runtime.test.mjs is created',
          'the test attempts to instantiate the game engine in headless mode (Phaser headless renderer, pygame.init(), canvas + raf shim)',
          'the test runs one update tick and asserts no exception is raised',
          'the test gracefully skips when the engine cannot run in this environment',
        ],
        expected_changed_files: ['tests/game-runtime.test.mjs'],
        verification_commands: ['node --test tests/game-runtime.test.mjs'],
        priority: f.severity,
        status: 'pending',
      };
    case 'missing_3d_scene_runtime_render_test':
      return {
        id: shortId('task'),
        iteration_id: iterationId,
        assigned_to: 'executor',
        title: 'Add 3D scene runtime render test',
        description: f.message,
        acceptance_criteria: [
          'tests/scene-runtime.test.mjs is created',
          'the test constructs a minimal THREE.Scene + Camera + Mesh',
          'the test attempts to create a WebGLRenderer / headless-gl context and run one render call',
          'the test gracefully skips when WebGL cannot be created in this environment',
        ],
        expected_changed_files: ['tests/scene-runtime.test.mjs'],
        verification_commands: ['node --test tests/scene-runtime.test.mjs'],
        priority: f.severity,
        status: 'pending',
      };
    case 'missing_browser_extension_runtime_manifest_test':
      return {
        id: shortId('task'),
        iteration_id: iterationId,
        assigned_to: 'executor',
        title: 'Add browser extension runtime manifest test',
        description: f.message,
        acceptance_criteria: [
          'tests/extension-runtime.test.mjs is created',
          'the test reads manifest.json and validates required fields (manifest_version, name, version)',
          'the test cross-checks that any referenced background.service_worker, content_scripts[].js, action.default_popup, options_ui.page actually exist on disk',
          'optionally, the test launches Playwright chromium with --load-extension and skips gracefully when Playwright is unavailable',
        ],
        expected_changed_files: ['tests/extension-runtime.test.mjs'],
        verification_commands: ['node --test tests/extension-runtime.test.mjs'],
        priority: f.severity,
        status: 'pending',
      };
    case 'missing_mobile_runtime_bundle_test':
      return {
        id: shortId('task'),
        iteration_id: iterationId,
        assigned_to: 'executor',
        title: 'Add mobile runtime bundle test',
        description: f.message,
        acceptance_criteria: [
          'tests/mobile-runtime.test.mjs is created',
          'the test reads app.json and asserts it is a well-formed Expo manifest with expo.name and expo.slug',
          'the test asserts a root component file (App.js / App.tsx / index.js) exists at the project root',
          'optionally, the test spawns `npx expo export --dump-sourcemap` and asserts the bundle is produced; skips gracefully when Expo CLI is unavailable',
        ],
        expected_changed_files: ['tests/mobile-runtime.test.mjs'],
        verification_commands: ['node --test tests/mobile-runtime.test.mjs'],
        priority: f.severity,
        status: 'pending',
      };
    case 'missing_desktop_runtime_boot_test':
      return {
        id: shortId('task'),
        iteration_id: iterationId,
        assigned_to: 'executor',
        title: 'Add desktop runtime boot test',
        description: f.message,
        acceptance_criteria: [
          'tests/desktop-runtime.test.mjs is created',
          'the test attempts to import electron and spawn `electron --version` (or `cargo --version` for Tauri)',
          'the test asserts a non-empty version string is returned',
          'the test gracefully skips when the framework binary is not installed in this environment',
        ],
        expected_changed_files: ['tests/desktop-runtime.test.mjs'],
        verification_commands: ['node --test tests/desktop-runtime.test.mjs'],
        priority: f.severity,
        status: 'pending',
      };
    case 'missing_media_pipeline_runtime_test':
      return {
        id: shortId('task'),
        iteration_id: iterationId,
        assigned_to: 'executor',
        title: 'Add media pipeline runtime test',
        description: f.message,
        acceptance_criteria: [
          'tests/media-runtime.test.mjs (Node) or tests/test_media_runtime.py (Python) is created',
          'the test constructs a synthetic in-memory media input (sharp.create, raw RGB buffer, generated wav, etc.)',
          'the test runs at least one transform from the project\'s media library (resize, encode, decode, filter)',
          'the test asserts the output buffer or file is non-empty and has the expected media metadata (dimensions, format)',
          'the test does not depend on real media assets shipped in the repo',
        ],
        expected_changed_files: ['tests/media-runtime.test.mjs', 'tests/test_media_runtime.py'],
        verification_commands: ['node --test tests/media-runtime.test.mjs'],
        priority: f.severity,
        status: 'pending',
      };
    case 'missing_llm_prompt_eval_harness':
      return {
        id: shortId('task'),
        iteration_id: iterationId,
        assigned_to: 'executor',
        title: 'Add LLM prompt evaluation harness',
        description: f.message,
        acceptance_criteria: [
          'tests/prompts/ directory ships at least 2 golden cases as .json files (each with input message + expected reply shape)',
          'tests/test_prompt_eval.py iterates every golden case under tests/prompts/',
          'the harness monkeypatches the LLM client class so the test does not call the real provider',
          'the harness asserts the response has the expected JSON shape and required keys (no network access required to pass)',
        ],
        expected_changed_files: ['tests/test_prompt_eval.py', 'tests/prompts/intro.json', 'tests/prompts/followup.json'],
        verification_commands: ['python3 -m pytest tests/test_prompt_eval.py -q'],
        priority: f.severity,
        status: 'pending',
      };
    case 'missing_llm_provider_failure_fallback':
      return {
        id: shortId('task'),
        iteration_id: iterationId,
        assigned_to: 'executor',
        title: 'Add LLM provider failure fallback test',
        description: f.message,
        acceptance_criteria: [
          'tests/test_provider_fallback.py is created',
          'the test monkeypatches the LLM client (app.OpenAI / app.Anthropic) so its create() raises an APIError / TimeoutError / generic Exception',
          'the test drives the chat endpoint with a valid request',
          'the test asserts the response status is in {502, 503, 429, 504} — not 500 and not 200 — with a structured error body',
          'the test does not call the real provider',
        ],
        expected_changed_files: ['tests/test_provider_fallback.py', 'app.py'],
        verification_commands: ['python3 -m pytest tests/test_provider_fallback.py -q'],
        priority: f.severity,
        status: 'pending',
      };
    case 'missing_llm_token_budget_enforcement':
      return {
        id: shortId('task'),
        iteration_id: iterationId,
        assigned_to: 'executor',
        title: 'Add LLM token / input-size budget enforcement',
        description: f.message,
        acceptance_criteria: [
          'either app.py declares a MAX_MESSAGE_LENGTH constant + a guard that returns 400/413 when input exceeds it, OR the chat handler is wrapped in a tiktoken-based token-counting check',
          'tests/test_token_budget.py POSTs a message > 50 000 characters and asserts a 400/413/422 response',
          'the same test confirms a normal-sized message still succeeds',
          'no real provider call happens during the oversized-input test (the guard must fire before the provider is reached)',
        ],
        expected_changed_files: ['tests/test_token_budget.py', 'app.py'],
        verification_commands: ['python3 -m pytest tests/test_token_budget.py -q'],
        priority: f.severity,
        status: 'pending',
      };
    case 'missing_api_error_envelope':
      return {
        id: shortId('task'),
        iteration_id: iterationId,
        assigned_to: 'executor',
        title: 'Add structured API error envelope',
        description: f.message,
        acceptance_criteria: [
          'app.py registers an @app.errorhandler(Exception) (or framework-equivalent) that returns a JSON envelope with at minimum {error, message, status}',
          'a 404 handler is registered that returns the same JSON envelope shape — not the framework default HTML page',
          'tests/test_error_envelope.py drives a 404 path and a server-error path and asserts the JSON shape on both',
          'no existing handler behaviour is changed: only error/404/exception paths are normalized',
        ],
        expected_changed_files: ['app.py', 'tests/test_error_envelope.py'],
        verification_commands: ['python3 -m pytest tests/test_error_envelope.py -q'],
        priority: f.severity,
        status: 'pending',
      };
    case 'missing_llm_streaming_response':
      return {
        id: shortId('task'),
        iteration_id: iterationId,
        assigned_to: 'executor',
        title: 'Add LLM streaming response surface',
        description: f.message,
        acceptance_criteria: [
          'a streaming endpoint exists (e.g. POST /chat/stream) that returns text/event-stream',
          'the streaming handler invokes the LLM client with stream=True and yields each delta as an SSE data: frame',
          'tests/test_streaming.py drives the streaming endpoint with a mocked streaming client and asserts the text/event-stream content type plus the data: framing',
          'a terminating sentinel (e.g. data: [DONE]) is emitted before the response generator finishes',
        ],
        expected_changed_files: ['streaming.py', 'tests/test_streaming.py', 'app.py'],
        verification_commands: ['python3 -m pytest tests/test_streaming.py -q'],
        priority: f.severity,
        status: 'pending',
      };
    case 'missing_llm_prompt_template_registry':
      return {
        id: shortId('task'),
        iteration_id: iterationId,
        assigned_to: 'executor',
        title: 'Add LLM prompt template registry',
        description: f.message,
        acceptance_criteria: [
          'prompts/ directory ships at least one *.txt or *.j2 template (e.g. prompts/chat_system.txt)',
          'prompts.py (or src/prompts.py) module exposes a load_prompt(name) / render_prompt(name, **vars) registry that reads from prompts/',
          'app.py imports prompts and references at least one template by name (no inline 50+-char system/user prompt strings)',
          'tests/test_prompt_registry.py asserts load_prompt("chat_system") returns a non-empty string',
        ],
        expected_changed_files: ['prompts/chat_system.txt', 'prompts.py', 'tests/test_prompt_registry.py', 'app.py'],
        verification_commands: ['python3 -m pytest tests/test_prompt_registry.py -q'],
        priority: f.severity,
        status: 'pending',
      };
    case 'missing_notebook_runtime_execution_test':
      return {
        id: shortId('task'),
        iteration_id: iterationId,
        assigned_to: 'executor',
        title: 'Add notebook runtime execution test',
        description: f.message,
        acceptance_criteria: [
          'tests/test_notebook_runtime.py is created',
          'the test discovers every .ipynb under the project',
          'the test executes each notebook via nbclient.NotebookClient / papermill / jupyter nbconvert --execute',
          'the test asserts no cell raised an exception during execution',
          'requirements include nbclient and nbformat (or papermill)',
        ],
        expected_changed_files: ['tests/test_notebook_runtime.py', 'requirements.txt'],
        verification_commands: ['python3 -m pytest tests/test_notebook_runtime.py -q'],
        priority: f.severity,
        status: 'pending',
      };
    case 'missing_worker_runtime_enqueue_test':
      return {
        id: shortId('task'),
        iteration_id: iterationId,
        assigned_to: 'executor',
        title: 'Add worker runtime enqueue test',
        description: f.message,
        acceptance_criteria: [
          'tests/test_worker_runtime.py is created',
          'the test enqueues a synthetic job (file-based queue, in-memory list, or Celery .apply())',
          'the test calls the worker entry function (drain_once, process_job, run_worker, …)',
          'the test asserts the expected side effect: queue drained, result file populated, return value reflects work done',
          'the test does not depend on a real broker, network or production data',
        ],
        expected_changed_files: ['tests/test_worker_runtime.py'],
        verification_commands: ['python3 -m pytest tests/test_worker_runtime.py -q'],
        priority: f.severity,
        status: 'pending',
      };
    case 'missing_config_runtime_load_test':
      return {
        id: shortId('task'),
        iteration_id: iterationId,
        assigned_to: 'executor',
        title: 'Add config runtime load test',
        description: f.message,
        acceptance_criteria: [
          'tests/test_config_runtime.py (Python) or tests/config-runtime.test.mjs (Node) is created',
          'the test sets every detected env var to a synthetic value via monkeypatch.setenv (Python) or process.env (Node)',
          'the test imports the main config/app module under those synthetic values and asserts no exception is raised',
          'the test asserts at least one parsed config value reflects the synthetic env value (round-trip)',
          'the test does not depend on real secrets, external services or production env files',
        ],
        expected_changed_files: ['tests/test_config_runtime.py', 'tests/config-runtime.test.mjs'],
        verification_commands: ['python3 -m pytest tests/test_config_runtime.py -q'],
        priority: f.severity,
        status: 'pending',
      };
    case 'missing_api_runtime_behaviour_test':
      return {
        id: shortId('task'),
        iteration_id: iterationId,
        assigned_to: 'executor',
        title: 'Add API runtime behaviour test',
        description: f.message,
        acceptance_criteria: [
          'tests/test_api_runtime.py (Python) or tests/api-runtime.test.mjs (Node) is created',
          'the test loads the real application module with isolated config (no real API keys, no production database)',
          'the test calls at least one detected route through an in-process test client (Flask test_client, FastAPI TestClient, supertest, Hono fetch, Fastify inject)',
          'the test asserts the handler ran — status code is not 404, response body or shape matches the route contract',
          'the test does not depend on network reachability or external services',
        ],
        expected_changed_files: ['tests/test_api_runtime.py', 'tests/api-runtime.test.mjs'],
        verification_commands: ['python3 -m pytest tests/test_api_runtime.py -q'],
        priority: f.severity,
        status: 'pending',
      };
    case 'missing_db_crud_runtime_tests':
      return {
        id: shortId('task'),
        iteration_id: iterationId,
        assigned_to: 'executor',
        title: 'Add database CRUD round-trip tests',
        description: f.message,
        acceptance_criteria: [
          'tests/test_db_crud_roundtrip.py runs INSERT, SELECT and DELETE against an isolated database',
          'test inserts a row, fetches it back and asserts the content matches',
          'test deletes the row and asserts a subsequent fetch no longer returns it',
          'the test does not depend on global state outside the application API',
        ],
        expected_changed_files: ['tests/test_db_crud_roundtrip.py', 'app.py'],
        verification_commands: ['python3 -m pytest tests/test_db_crud_roundtrip.py -q'],
        priority: f.severity,
        status: 'pending',
      };
    case 'missing_multi_service_integration_check':
      return {
        id: shortId('task'),
        iteration_id: iterationId,
        assigned_to: 'executor',
        title: 'Add multi-service integration test',
        description: f.message,
        acceptance_criteria: [
          'tests/test_multi_service_integration.py boots the producer service and drives the consumer service',
          'the test asserts state propagates from one service to the other (queue, db, or shared store)',
          'the test points services at isolated paths and does not leak global state',
          'docs/multi-service-contract.md records the service boundaries and the shared transport',
        ],
        expected_changed_files: ['tests/test_multi_service_integration.py', 'docs/multi-service-contract.md'],
        verification_commands: ['python3 -m pytest tests/test_multi_service_integration.py -q'],
        priority: f.severity,
        status: 'pending',
      };
    case 'missing_worker_contract_harness':
      return {
        id: shortId('task'),
        iteration_id: iterationId,
        assigned_to: 'executor',
        title: 'Add worker contract harness',
        description: f.message,
        acceptance_criteria: [
          'docs/worker-contract.md records worker/queue entry expectations',
          'scripts/worker-contract-check.mjs verifies worker, job or scheduler evidence exists',
          'package scripts expose worker:contract-check',
        ],
        expected_changed_files: ['docs/worker-contract.md', 'scripts/worker-contract-check.mjs', 'package.json'],
        verification_commands: ['node scripts/worker-contract-check.mjs'],
        priority: f.severity,
        status: 'pending',
      };
    case 'missing_demo_surface_contract_matrix':
      return {
        id: shortId('task'),
        iteration_id: iterationId,
        assigned_to: 'executor',
        title: 'Add demo surface contract matrix',
        description: f.message,
        acceptance_criteria: [
          'docs/productization-surface-map.md records detected delivery surfaces and evidence',
          'scripts/surface-contract-check.mjs verifies specialized surface evidence without network access',
          'package scripts expose surface:contract-check',
          'surface map explains why agents must not apply unrelated UI/API/CLI assumptions',
        ],
        expected_changed_files: ['docs/productization-surface-map.md', 'scripts/surface-contract-check.mjs', 'package.json'],
        verification_commands: ['node scripts/surface-contract-check.mjs'],
        priority: f.severity,
        status: 'pending',
      };
    case 'missing_browser_extension_contract_harness':
      return specializedSurfaceTask(
        iterationId,
        f,
        'Add browser extension contract harness',
        [
          'docs/browser-extension-contract.md documents manifest, popup/background/content and permission boundaries',
          'scripts/browser-extension-contract-check.mjs validates manifest.json and referenced popup files',
          'package scripts expose extension:contract-check',
        ],
        ['docs/browser-extension-contract.md', 'scripts/browser-extension-contract-check.mjs', 'package.json'],
        'node scripts/browser-extension-contract-check.mjs',
      );
    case 'missing_notebook_contract_harness':
      return specializedSurfaceTask(
        iterationId,
        f,
        'Add notebook reproducibility contract harness',
        [
          'docs/notebook-contract.md documents the notebook-to-repeatable-script boundary',
          'scripts/notebook-contract-check.mjs validates notebooks are parseable and have cell arrays',
          'package scripts expose notebook:contract-check',
        ],
        ['docs/notebook-contract.md', 'scripts/notebook-contract-check.mjs', 'package.json'],
        'node scripts/notebook-contract-check.mjs',
      );
    case 'missing_mobile_contract_harness':
      return specializedSurfaceTask(
        iterationId,
        f,
        'Add mobile app contract harness',
        [
          'docs/mobile-contract.md documents Expo/React Native/Capacitor platform evidence',
          'scripts/mobile-contract-check.mjs validates mobile config or platform directories',
          'package scripts expose mobile:contract-check',
        ],
        ['docs/mobile-contract.md', 'scripts/mobile-contract-check.mjs', 'package.json'],
        'node scripts/mobile-contract-check.mjs',
      );
    case 'missing_desktop_contract_harness':
      return specializedSurfaceTask(
        iterationId,
        f,
        'Add desktop app contract harness',
        [
          'docs/desktop-contract.md documents Electron/Tauri shell entry and security boundary',
          'scripts/desktop-contract-check.mjs validates desktop shell evidence',
          'package scripts expose desktop:contract-check',
        ],
        ['docs/desktop-contract.md', 'scripts/desktop-contract-check.mjs', 'package.json'],
        'node scripts/desktop-contract-check.mjs',
      );
    case 'missing_game_contract_harness':
      return specializedSurfaceTask(
        iterationId,
        f,
        'Add game runtime contract harness',
        [
          'docs/game-contract.md documents game loop, input and asset boundaries',
          'scripts/game-contract-check.mjs validates game runtime evidence',
          'package scripts expose game:contract-check',
        ],
        ['docs/game-contract.md', 'scripts/game-contract-check.mjs', 'package.json'],
        'node scripts/game-contract-check.mjs',
      );
    case 'missing_3d_scene_contract_harness':
      return specializedSurfaceTask(
        iterationId,
        f,
        'Add 3D scene contract harness',
        [
          'docs/3d-scene-contract.md documents renderer, canvas and asset boundaries',
          'scripts/3d-scene-contract-check.mjs validates WebGL/3D scene evidence',
          'package scripts expose 3d:contract-check',
        ],
        ['docs/3d-scene-contract.md', 'scripts/3d-scene-contract-check.mjs', 'package.json'],
        'node scripts/3d-scene-contract-check.mjs',
      );
    case 'missing_ml_model_contract_harness':
      return specializedSurfaceTask(
        iterationId,
        f,
        'Add ML model contract harness',
        [
          'docs/ml-model-contract.md documents model artifacts, sample inputs and output schemas',
          'scripts/ml-model-contract-check.mjs validates model/framework evidence',
          'package scripts expose ml:contract-check',
        ],
        ['docs/ml-model-contract.md', 'scripts/ml-model-contract-check.mjs', 'package.json'],
        'node scripts/ml-model-contract-check.mjs',
      );
    case 'missing_media_pipeline_contract_harness':
      return specializedSurfaceTask(
        iterationId,
        f,
        'Add media pipeline contract harness',
        [
          'docs/media-pipeline-contract.md documents media input/output and fixture processing boundaries',
          'scripts/media-pipeline-contract-check.mjs validates media pipeline evidence',
          'package scripts expose media:contract-check',
        ],
        ['docs/media-pipeline-contract.md', 'scripts/media-pipeline-contract-check.mjs', 'package.json'],
        'node scripts/media-pipeline-contract-check.mjs',
      );
    case 'demo_shell_without_product_core':
      if (detectedLanguage === 'python') {
        return {
          id: shortId('task'),
          iteration_id: iterationId,
          assigned_to: 'executor',
          title: 'Implement product core spine',
          description: f.message,
          acceptance_criteria: [
            'source-level product core exists outside docs/scripts/test-only harnesses',
            'product core exposes capabilities and executable workflows',
            'tests exercise product core behavior directly',
            'at least one runtime entry or command is wired to the product core when applicable',
          ],
          expected_changed_files: ['src/product_core.py', 'tests/test_product_core.py', 'docs/product-core.md', 'package.json'],
          verification_commands: ['python3 -m pytest tests/test_product_core.py -q'],
          priority: 'high',
          status: 'pending',
        };
      }
      return {
        id: shortId('task'),
        iteration_id: iterationId,
        assigned_to: 'executor',
        title: 'Implement product core spine',
        description: f.message,
        acceptance_criteria: [
          'source-level product core exists outside docs/scripts/test-only harnesses',
          'product core exposes capabilities and executable workflows',
          'tests exercise product core behavior directly',
          'at least one runtime entry or command is wired to the product core when applicable',
        ],
        expected_changed_files: ['src/product-core.mjs', 'tests/product-core.test.mjs', 'docs/product-core.md', 'package.json'],
        verification_commands: ['node --test tests/product-core.test.mjs'],
        priority: f.severity,
        status: 'pending',
      };
    case 'missing_product_runtime_entry':
      return {
        id: shortId('task'),
        iteration_id: iterationId,
        assigned_to: 'executor',
        title: 'Add product runtime entry',
        description: f.message,
        acceptance_criteria: [
          'detected product surface has a user-runnable start command',
          'runtime entry loads the existing demo surface instead of only adding docs or tests',
          'scripts/product-runtime-check.mjs validates the runtime entry without launching a browser or device',
        ],
        expected_changed_files: ['package.json', 'scripts/product-runtime-check.mjs', 'index.html', 'App.js'],
        verification_commands: ['node scripts/product-runtime-check.mjs'],
        priority: f.severity,
        status: 'pending',
      };
    case 'specialized_surface_shallow_product':
      return {
        id: shortId('task'),
        iteration_id: iterationId,
        assigned_to: 'executor',
        title: 'Add specialized surface product workflow',
        description: f.message,
        acceptance_criteria: [
          'detected specialized surface has source-level behavior beyond docs and contract checks',
          'workflow includes domain fixtures, states or runtime interactions specific to the surface',
          'tests exercise the specialized workflow without relying on placeholder status checks',
        ],
        expected_changed_files: ['src', 'tests/specialized-surface-depth.test.mjs', 'package.json'],
        verification_commands: ['node --test tests/specialized-surface-depth.test.mjs'],
        priority: f.severity,
        status: 'pending',
      };
    case 'no_ci':
    case 'misaligned_ci':
    case 'ci_ignores_python_constraints':
      return {
        id: shortId('task'),
        iteration_id: iterationId,
        assigned_to: 'executor',
        title: f.category === 'no_ci' ? 'Add minimal CI workflow' : 'Update CI workflow for project stack',
        description: f.message,
        acceptance_criteria: [
          'CI config exists',
          'workflow runs install + test on push/PR for the detected stack',
          'Python dependency installs use constraints.txt when a constraint policy exists',
        ],
        expected_changed_files: f.related_files.length > 0 ? f.related_files : ['.github/workflows/ci.yml'],
        verification_commands: ['test -f .github/workflows/ci.yml'],
        priority: f.severity,
        status: 'pending',
      };
    case 'no_python_tests':
      return {
        id: shortId('task'),
        iteration_id: iterationId,
        assigned_to: 'executor',
        title: 'Add Python smoke tests',
        description: f.message,
        acceptance_criteria: [
          'tests/test_smoke.py exists',
          'pytest-compatible test command exits 0',
          'Python source files compile',
        ],
        expected_changed_files: ['tests/test_smoke.py', 'requirements.txt', 'package.json'],
        verification_commands: ['python3 -m pytest -q'],
        priority: f.severity,
        status: 'pending',
      };
    case 'fake_build_command':
      return {
        id: shortId('task'),
        iteration_id: iterationId,
        assigned_to: 'executor',
        title: 'Replace echo-only build script',
        description: f.message,
        acceptance_criteria: ['build script validates source files'],
        expected_changed_files: ['package.json'],
        verification_commands: ['npm run build'],
        priority: f.severity,
        status: 'pending',
      };
    case 'misaligned_node_scaffold':
      return {
        id: shortId('task'),
        iteration_id: iterationId,
        assigned_to: 'executor',
        title: 'Align package scripts with Python project',
        description: f.message,
        acceptance_criteria: ['npm test delegates to Python tests', 'npm build validates Python sources'],
        expected_changed_files: ['package.json'],
        verification_commands: ['npm run test', 'npm run build'],
        priority: f.severity,
        status: 'pending',
      };
    case 'missing_healthcheck':
    case 'missing_config_guard':
      return {
        id: shortId('task'),
        iteration_id: iterationId,
        assigned_to: 'executor',
        title: 'Add Flask health and config guard',
        description: f.message,
        acceptance_criteria: ['/healthz returns status', '/start rejects missing API key clearly'],
        expected_changed_files: ['app.py', 'config.py', 'tests/test_app.py'],
        verification_commands: ['python3 -m pytest tests/test_app.py -q'],
        priority: f.severity,
        status: 'pending',
      };
    case 'missing_api_tests':
      return {
        id: shortId('task'),
        iteration_id: iterationId,
        assigned_to: 'executor',
        title: 'Add Flask API tests',
        description: f.message,
        acceptance_criteria: ['Flask public routes are covered by pytest'],
        expected_changed_files: ['tests/test_app.py'],
        verification_commands: ['python3 -m pytest tests/test_app.py -q'],
        priority: f.severity,
        status: 'pending',
      };
    case 'missing_wsgi_entrypoint':
    case 'missing_python_production_server':
    case 'missing_deployment_artifact':
    case 'flask_docker_uses_dev_server':
      return flaskDeploymentScaffoldTask(iterationId, f);
    case 'missing_deployment_docs':
      return {
        id: shortId('task'),
        iteration_id: iterationId,
        assigned_to: 'executor',
        title: 'Document public demo deployment',
        description: f.message,
        acceptance_criteria: ['README documents Docker/gunicorn startup and health check'],
        expected_changed_files: ['README.md'],
        verification_commands: ['python3 -c "from pathlib import Path; t=Path(\'README.md\').read_text(); assert \'Docker\' in t and \'gunicorn\' in t and \'healthz\' in t"'],
        priority: f.severity,
        status: 'pending',
      };
    case 'missing_security_headers':
    case 'missing_start_input_validation':
    case 'missing_active_game_limit':
    case 'missing_structured_logging':
    case 'missing_industrial_api_tests':
      return {
        id: shortId('task'),
        iteration_id: iterationId,
        assigned_to: 'executor',
        title: 'Harden Flask public runtime controls',
        description: f.message,
        acceptance_criteria: [
          'every response includes defensive security headers',
          '/start rejects invalid mode values with HTTP 400',
          '/start clamps or rejects unsafe speed values',
          '/start rejects new games when the active game limit is reached',
          'runtime events and background errors are logged through a module logger',
          'Flask API tests cover these runtime controls',
        ],
        expected_changed_files: ['app.py', 'config.py', 'tests/test_app.py'],
        verification_commands: ['python3 -m pytest tests/test_app.py -q'],
        priority: f.severity,
        status: 'pending',
      };
    case 'failed_test_verification':
    case 'failed_build_verification': {
      const isTestFailure = f.category === 'failed_test_verification';
      return {
        id: shortId('task'),
        iteration_id: iterationId,
        assigned_to: 'executor',
        title: 'Repair failing project verification',
        description: [f.message, f.suggested_fix].filter(Boolean).join('\n\n'),
        acceptance_criteria: [
          'the failing verification command is reproduced',
          'the root cause is fixed in source or tests',
          'the failing verification command exits 0',
        ],
        expected_changed_files: f.related_files.length > 0
          ? f.related_files
          : (isTestFailure ? ['tests'] : ['(see failing build output)']),
        verification_commands: isTestFailure ? verifyForTest : verifyForBuild,
        priority: f.severity,
        status: 'pending',
      };
    }
    case 'missing_python_dependency_constraints':
    case 'unbounded_python_dependencies':
      return {
        id: shortId('task'),
        iteration_id: iterationId,
        assigned_to: 'executor',
        title: 'Add Python dependency constraints',
        description: f.message,
        acceptance_criteria: [
          'constraints.txt exists and bounds direct Python dependencies',
          'README install instructions use pip -c constraints.txt',
          'test command exits 0 after dependency policy changes',
        ],
        expected_changed_files: ['requirements.txt', 'constraints.txt', 'README.md'],
        verification_commands: [
          'python3 -c "from pathlib import Path; t=Path(\'constraints.txt\').read_text(); assert \'<\' in t or \'==\' in t"',
          ...verifyForTest,
        ],
        priority: f.severity,
        status: 'pending',
      };
    case 'missing_regression_tests':
      return {
        id: shortId('task'),
        iteration_id: iterationId,
        assigned_to: 'executor',
        title: 'Add Flask regression tests',
        description: f.message,
        acceptance_criteria: [
          'tests/test_regression.py exists',
          'regression tests cover health headers and invalid start input',
          'pytest regression command exits 0',
        ],
        expected_changed_files: ['tests/test_regression.py'],
        verification_commands: ['python3 -m pytest tests/test_regression.py -q'],
        priority: f.severity,
        status: 'pending',
      };
    case 'missing_operational_docs':
      return {
        id: shortId('task'),
        iteration_id: iterationId,
        assigned_to: 'executor',
        title: 'Add operational documentation',
        description: f.message,
        acceptance_criteria: [
          'docs/architecture.md explains runtime components and request flow',
          'docs/operations.md documents config, verification, deployment and rollback basics',
        ],
        expected_changed_files: ['docs/architecture.md', 'docs/operations.md'],
        verification_commands: ['test -s docs/architecture.md', 'test -s docs/operations.md'],
        priority: f.severity,
        status: 'pending',
      };
    case 'missing_user_llm_provider_config':
      return {
        id: shortId('task'),
        iteration_id: iterationId,
        assigned_to: 'executor',
        title: 'Add player-supplied LLM provider configuration',
        description: f.message,
        acceptance_criteria: [
          'UI lets each player choose DeepSeek, MiniMax, Qwen, OpenAI-compatible or custom provider settings',
          '/start accepts api_key, provider, model and base_url per game without persisting or logging the key',
          'server exposes public provider presets with no secrets',
          'player/game code uses the per-session LLM config instead of one server-wide key',
          'tests cover provider resolution, redaction and missing-key validation',
        ],
        expected_changed_files: ['app.py', 'player.py', 'game.py', 'templates/index.html', 'llm_config.py', 'tests/test_llm_config.py'],
        verification_commands: ['python3 -m pytest tests/test_llm_config.py -q'],
        priority: f.severity,
        status: 'pending',
      };
    case 'broken_llm_provider_select_options':
      return {
        id: shortId('task'),
        iteration_id: iterationId,
        assigned_to: 'executor',
        title: 'Repair LLM provider select option labels',
        description: f.message,
        acceptance_criteria: [
          'public provider presets expose non-empty UI labels and default models',
          'template option rendering falls back from label to name/id instead of producing blank options',
          'tests prove every provider preset has a non-empty select label',
        ],
        expected_changed_files: ['llm_config.py', 'templates/index.html', 'tests/test_llm_config.py'],
        verification_commands: ['python3 -m pytest tests/test_llm_config.py -q'],
        priority: f.severity,
        status: 'pending',
      };
    case 'incomplete_llm_provider_catalog':
    case 'llm_provider_catalog_missing_official_models':
    case 'llm_provider_catalog_outdated_against_official_refresh':
      return {
        id: shortId('task'),
        iteration_id: iterationId,
        assigned_to: 'executor',
        title: 'Expand player-selectable LLM provider catalog',
        description: f.message,
        acceptance_criteria: [
          'public provider presets include DeepSeek, MiniMax, Qwen, OpenAI-compatible and custom endpoints',
          'provider presets include non-empty labels, default models and model option lists where applicable',
          'provider model options cite official model documentation sources',
          'tests prove supported provider coverage and no API keys are exposed',
        ],
        expected_changed_files: ['llm_config.py', 'templates/index.html', 'tests/test_llm_config.py'],
        verification_commands: ['python3 -m pytest tests/test_llm_config.py -q'],
        priority: f.severity,
        status: 'pending',
      };
    case 'missing_ui_product_verification':
    case 'below_web_ui_product_maturity':
      return {
        id: shortId('task'),
        iteration_id: iterationId,
        assigned_to: 'executor',
        title: 'Add UI product verification harness',
        description: f.message,
        acceptance_criteria: [
          'browser-level UI smoke test scaffold exists',
          'responsive desktop and mobile viewport checks are documented in the harness',
          'deterministic UI product check script runs in CI without external services',
          'package scripts expose ui:check and optional ui:e2e commands',
        ],
        expected_changed_files: ['scripts/ui-product-check.mjs', 'playwright.config.ts', 'tests/ui/smoke.spec.ts', 'package.json'],
        verification_commands: ['node scripts/ui-product-check.mjs'],
        priority: f.severity,
        status: 'pending',
      };
    case 'missing_ui_runtime_render_smoke':
      return {
        id: shortId('task'),
        iteration_id: iterationId,
        assigned_to: 'executor',
        title: 'Add UI runtime render smoke verification',
        description: f.message,
        acceptance_criteria: [
          'render smoke script exists and documents how to run against a local dev/preview server',
          'browser smoke spec rejects blank pages and horizontal overflow',
          'desktop and mobile screenshots are captured by the runtime smoke path',
          'package scripts expose ui:render-check without replacing build/test validation',
        ],
        expected_changed_files: ['scripts/ui-render-smoke.mjs', 'tests/ui/smoke.spec.ts', 'playwright.config.ts', 'package.json'],
        verification_commands: ['node scripts/ui-product-check.mjs'],
        priority: f.severity,
        status: 'pending',
      };
    case 'ui_pointer_only_interaction':
    case 'ui_hidden_system_cursor':
    case 'ui_reactive_mousemove_cursor':
    case 'ui_fixed_title_scale':
    case 'ui_sticky_anchor_overlap':
    case 'ui_placeholder_copy':
    case 'ui_navigation_semantics':
    case 'ui_css_cleanup_needed':
    case 'ui_variant_style_drift':
      return {
        id: shortId('task'),
        iteration_id: iterationId,
        assigned_to: 'executor',
        title: 'Harden UI interaction, accessibility and polish',
        description: f.message,
        acceptance_criteria: [
          'mouse-hover-only UI has keyboard and touch access paths',
          'navigation landmarks and focusable custom controls expose accessible semantics',
          'decorative cursor and pointer effects do not hide the system cursor globally',
          'display typography and sticky anchors remain usable across narrow and zoomed viewports',
          'placeholder copy and stale CSS residue are removed where safely detectable',
        ],
        expected_changed_files: ['src', 'app', 'pages', 'components', 'styles', 'templates', 'static', 'example'],
        verification_commands: buildCommands.length > 0 ? [buildCommands[0]!] : verifyForTest,
        priority: f.severity,
        status: 'pending',
      };
    case 'ui_unimplemented_hosted_service_claim':
      return {
        id: shortId('task'),
        iteration_id: iterationId,
        assigned_to: 'executor',
        title: 'Align UI service claims with implemented backend',
        description: f.message,
        acceptance_criteria: [
          'public UI no longer promises hosted upload, processing or artifact-return flows without backend evidence',
          'file-upload controls are removed or clearly replaced by beta/local CLI usage guidance',
          'service copy names the current supported workflow and does not imply a live hosted processor',
          'build verification still passes after the copy and markup change',
        ],
        expected_changed_files: ['src', 'app', 'pages', 'components', 'templates', 'static', 'example', 'README.md'],
        verification_commands: buildCommands.length > 0 ? [buildCommands[0]!] : verifyForTest,
        priority: f.severity,
        status: 'pending',
      };
    case 'missing_social_deduction_rules_engine':
    case 'random_social_deduction_tie_breaker':
    case 'missing_social_deduction_rule_tests':
    case 'missing_social_deduction_mode_validation':
    case 'missing_social_deduction_mode_tests':
    case 'missing_social_deduction_mode_startup_guard':
    case 'missing_game_design_doc':
      return {
        id: shortId('task'),
        iteration_id: iterationId,
        assigned_to: 'executor',
        title: 'Add social deduction rules engine',
        description: f.message,
        acceptance_criteria: [
          'rules.py exposes deterministic vote and win-condition helpers',
          'rules.py exposes mode validation for wolf ratio and role-count sanity',
          'game.py calls the rules helpers instead of random tie execution',
          'tests/test_rules.py covers ties, clear vote execution, win conditions, role distribution and mode validation',
          'docs/game-design.md documents gameplay policy',
        ],
        expected_changed_files: ['game.py', 'rules.py', 'tests/test_rules.py', 'docs/game-design.md'],
        verification_commands: ['python3 -m pytest tests/test_rules.py -q'],
        priority: f.severity,
        status: 'pending',
      };
    case 'disconnected_social_product_backbone':
      return {
        id: shortId('task'),
        iteration_id: iterationId,
        assigned_to: 'executor',
        title: 'Integrate social product backbone into app workflows',
        description: f.message,
        acceptance_criteria: [
          'Flask runtime imports and invokes product backbone systems',
          'browser-visible routes or controls expose account, lobby, moderation, ranking, history and host workflows',
          'endpoint tests exercise product workflows through the running app surface',
        ],
        expected_changed_files: ['app.py', 'templates/index.html', 'tests/test_product_integration.py', 'docs/market-parity.md'],
        verification_commands: ['python3 -m pytest tests/test_product_integration.py -q'],
        priority: f.severity,
        status: 'pending',
      };
    case 'below_social_deduction_market_parity':
      return {
        id: shortId('task'),
        iteration_id: iterationId,
        assigned_to: 'executor',
        title: 'Implement social deduction product backbone',
        description: f.message,
        acceptance_criteria: [
          'market parity backbone modules exist for account/profile, lobby/matchmaking, moderation, ranking, history, liveops, admin and host controls',
          'tests/test_product_backbone.py exercises the product backbone as executable behavior',
          'docs/market-parity.md separates implemented backbone from capabilities that still need production infrastructure',
        ],
        expected_changed_files: [
          'accounts.py',
          'lobby.py',
          'communication.py',
          'moderation.py',
          'ranking.py',
          'history.py',
          'roles_catalog.py',
          'liveops.py',
          'admin.py',
          'host_controls.py',
          'tests/test_product_backbone.py',
          'docs/market-parity.md',
          'package.json',
        ],
        verification_commands: ['python3 -m pytest tests/test_product_backbone.py -q'],
        priority: f.severity,
        status: 'pending',
      };
    case 'below_agent_social_deduction_theater_maturity':
      return {
        id: shortId('task'),
        iteration_id: iterationId,
        assigned_to: 'executor',
        title: 'Harden agent-facing werewolf product loop',
        description: f.message,
        acceptance_criteria: [
          'per-session model provider, model, endpoint and API key settings are exposed without requiring a server-wide shared key',
          'agent rules, role secrecy and invalid-action guardrails are covered by tests',
          'matches produce durable replay or transcript artifacts for observer review',
          'a repeatable simulation/evaluation harness can run seeded agent games and report regressions',
          'docs/agent-product.md explains the agent-facing product boundary and how it differs from human multiplayer werewolf',
        ],
        expected_changed_files: [
          'llm_config.py',
          'app.py',
          'game.py',
          'player.py',
          'prompts.py',
          'replay.py',
          'evaluation.py',
          'templates/index.html',
          'tests/test_llm_config.py',
          'tests/test_rules.py',
          'tests/test_replay.py',
          'tests/test_eval_harness.py',
          'docs/agent-product.md',
        ],
        verification_commands: ['python3 -m pytest -q'],
        priority: f.severity,
        status: 'pending',
      };
    case 'below_market_research_parity':
      return {
        id: shortId('task'),
        iteration_id: iterationId,
        assigned_to: 'executor',
        title: 'Define source-cited market research roadmap',
        description: f.message,
        acceptance_criteria: [
          'docs/market-research-roadmap.md summarizes source-cited market capabilities',
          'roadmap separates required, recommended and out-of-scope capabilities',
          'each proposed capability keeps competitor source URLs as evidence',
          'roadmap states that source research must not copy competitor text, code, UI or brand assets',
        ],
        expected_changed_files: ['docs/market-research-roadmap.md'],
        verification_commands: ['test -s docs/market-research-roadmap.md'],
        priority: f.severity,
        status: 'pending',
      };
    default:
      if (f.category === 'missing_required_file' && f.related_files.includes('pyproject.toml')) {
        return {
          id: shortId('task'),
          iteration_id: iterationId,
          assigned_to: 'executor',
          title: 'Add minimal pyproject.toml',
          description: f.message,
          acceptance_criteria: ['pyproject.toml exists', 'project metadata is declared'],
          expected_changed_files: ['pyproject.toml'],
          verification_commands: ['test -f pyproject.toml'],
          priority: f.severity,
          status: 'pending',
        };
      }
      if (f.category === 'missing_recommended_file' && f.related_files.includes('CHANGELOG.md')) {
        return {
          id: shortId('task'),
          iteration_id: iterationId,
          assigned_to: 'executor',
          title: 'Add CHANGELOG.md',
          description: f.message,
          acceptance_criteria: ['CHANGELOG.md exists', 'contains an Unreleased section'],
          expected_changed_files: ['CHANGELOG.md'],
          verification_commands: ['test -s CHANGELOG.md'],
          priority: f.severity,
          status: 'pending',
        };
      }
      if (f.category === 'missing_recommended_file' && f.related_files.some((file) => file === 'Dockerfile' || file === 'wsgi.py')) {
        return flaskDeploymentScaffoldTask(iterationId, f);
      }
      if (f.category === 'missing_recommended_file' && f.related_files.includes('Makefile')) {
        return {
          id: shortId('task'),
          iteration_id: iterationId,
          assigned_to: 'executor',
          title: 'Add Makefile with project commands',
          description: f.message,
          acceptance_criteria: ['Makefile exists', 'exposes test/build/install targets'],
          expected_changed_files: ['Makefile'],
          verification_commands: ['test -s Makefile'],
          priority: f.severity,
          status: 'pending',
        };
      }
      return {
        id: shortId('task'),
        iteration_id: iterationId,
        assigned_to: 'executor',
        title: `Address gap: ${f.category}${fileSuffix(f.related_files)}`,
        description: f.message,
        acceptance_criteria: baseAccept,
        expected_changed_files: f.related_files.length > 0 ? f.related_files : ['(see suggested_fix)'],
        verification_commands: verifyForTest,
        priority: f.severity,
        status: 'pending',
      };
  }
}

function flaskDeploymentScaffoldTask(iterationId: string, f: GapReport['findings'][number]): AgentTask {
  return {
    id: shortId('task'),
    iteration_id: iterationId,
    assigned_to: 'executor',
    title: 'Add Flask deployment scaffold',
    description: f.message,
    acceptance_criteria: ['Dockerfile exists', 'wsgi.py exposes app', 'gunicorn dependency exists', 'Dockerfile starts gunicorn instead of app.py'],
    expected_changed_files: ['Dockerfile', '.dockerignore', 'wsgi.py', 'requirements.txt'],
    verification_commands: [
      'test -f Dockerfile',
      'test -f wsgi.py',
      'python3 -c "from pathlib import Path; assert \'gunicorn\' in Path(\'requirements.txt\').read_text().lower()"',
      'python3 -c "from pathlib import Path; t=Path(\'Dockerfile\').read_text().lower(); assert \'gunicorn\' in t and \'wsgi:app\' in t"',
    ],
    priority: f.severity,
    status: 'pending',
  };
}

function specializedSurfaceTask(
  iterationId: string,
  f: GapReport['findings'][number],
  title: string,
  acceptanceCriteria: string[],
  expectedChangedFiles: string[],
  verificationCommand: string,
): AgentTask {
  return {
    id: shortId('task'),
    iteration_id: iterationId,
    assigned_to: 'executor',
    title,
    description: f.message,
    acceptance_criteria: acceptanceCriteria,
    expected_changed_files: expectedChangedFiles,
    verification_commands: [verificationCommand],
    priority: f.severity,
    status: 'pending',
  };
}

function fileSuffix(files: string[]): string {
  return files.length > 0 ? ` (${files.join(', ')})` : '';
}
