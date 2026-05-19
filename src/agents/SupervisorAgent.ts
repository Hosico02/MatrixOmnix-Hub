import path from 'node:path';
import { promises as fs } from 'node:fs';
import type {
  IterationSummary,
  IterationEvent,
  AgentResult,
  ProjectStandard,
  AgentTask,
  AdvisoryAgentRole,
  AdvisoryReport,
  GapReport,
} from '../core/types.js';
import { AnalyzerAgent } from './AnalyzerAgent.js';
import { PlannerAgent } from './PlannerAgent.js';
import { ExecutorAgent } from './ExecutorAgent.js';
import { VerifierAgent } from './VerifierAgent.js';
import { ReviewerAgent } from './ReviewerAgent.js';
import { MemoryAgent } from './MemoryAgent.js';
import { EventStore } from '../core/eventStore.js';
import { EvidenceGraph } from '../core/evidenceGraph.js';
import { CostTracker } from '../core/costTracker.js';
import { IterationWorkspace } from '../core/iterationWorkspace.js';
import { buildVerificationRepairTask, extractRootCauseHints } from '../core/verificationRepair.js';

function extractRootCauseSignatures(text: string): string[] {
  return extractRootCauseHints(text).map((h) => h.signature);
}
import {
  officialModelCatalogPath,
  refreshOfficialModelCatalog,
  writeOfficialModelCatalog,
  type RefreshOfficialModelCatalogOptions,
} from '../research/OfficialModelCatalog.js';
import { QAAgent } from '../qa/QAAgent.js';
import { QACaseStore } from '../qa/QACaseStore.js';
import { DEFAULT_PROJECT_STANDARD } from '../standards/defaultProjectStandard.js';
import { nowIso, shortId } from '../utils/time.js';
import { listFiles, readTextSafe } from '../utils/fs.js';
import type { AgentProvider } from './providers/AgentProvider.js';
import type { AdvisoryProvider } from './advisory/AdvisoryProvider.js';
import { ModelAdvisoryAgent } from './advisory/ModelAdvisoryAgent.js';
import {
  loadMarketResearchReport,
  runMarketResearch,
  writeMarketResearchReport,
} from '../research/MarketResearchAgent.js';
import { ControlledWebSearchProvider, type SearchProvider } from '../research/SearchProvider.js';
import { defaultMarketResearchQuery, inferMarketResearchDomain } from '../research/domainInference.js';

export interface RetryPolicy {
  /** Max attempts INCLUDING the first try. 1 = no retry. */
  maxAttempts: number;
  /** Statuses that should trigger a retry. */
  retryOnStatuses: ('failed' | 'timeout')[];
}

export interface IterateOptions {
  projectPath: string;
  goal: string;
  provider: AgentProvider;
  standard?: ProjectStandard;
  maxIterations?: number;
  /** Inject the project's canonical verification commands. */
  extraVerificationCommands?: string[];
  systemRoot?: string; // for regression spec path
  /** Per-task retry policy. Default: no retry. */
  retryPolicy?: RetryPolicy;
  /** Parallel tasks per round. Default: 1 (sequential). */
  parallelism?: number;
  /** When true and project_path is a git repo, isolate each iteration on a branch. */
  useWorktree?: boolean;
  /** Controlled opt-in refresh for provider-owned LLM model docs before planning. */
  officialModelCatalog?: Omit<RefreshOfficialModelCatalogOptions, 'projectPath' | 'systemRoot'> & {
    mode?: 'auto' | 'always';
  };
  /** Optional model-backed advisory agents. They can enrich planning but cannot pass readiness gates. */
  advisory?: {
    provider: AdvisoryProvider;
    roles?: AdvisoryAgentRole[];
    allowNetwork?: boolean;
    /** When true, run controlled market research before analysis so gap/advisory share source-backed competitor context. */
    autoResearch?: boolean;
    /** Test/integration seam for controlled search. Defaults to DuckDuckGo HTML provider under NetworkGuard. */
    searchProvider?: SearchProvider;
  };
}

/**
 * SupervisorAgent — orchestrates the closed loop.
 *
 * Loop body (per iteration):
 *   1. Analyzer: snapshot → score → gap
 *   2. QAAgent.preflight against known cases
 *   3. Planner: gap → plan
 *   4. For each task: Executor → Verifier → Reviewer → record events
 *   5. QAAgent.learn from events, update regression spec
 *   6. Re-score, decide whether to continue
 *
 * Stop conditions:
 *   - reached grade "production_ready_baseline"
 *   - maxIterations exhausted
 *   - score did not improve for 2 rounds in a row
 *   - safety / unrecoverable failure encountered
 */
export class SupervisorAgent {
  private analyzer: AnalyzerAgent;
  private planner = new PlannerAgent();
  private verifier = new VerifierAgent();
  private reviewer: ReviewerAgent;
  private memory = new MemoryAgent();
  private standard?: ProjectStandard;

  constructor(opts: { standard?: ProjectStandard } = {}) {
    this.standard = opts.standard;
    this.analyzer = new AnalyzerAgent(this.standard);
    this.reviewer = new ReviewerAgent(this.standard ?? DEFAULT_PROJECT_STANDARD);
  }

  async iterate(opts: IterateOptions): Promise<IterationSummary[]> {
    const summaries: IterationSummary[] = [];
    const maxIter = opts.maxIterations ?? 1;
    const store = new EventStore(opts.projectPath);
    const caseStore = new QACaseStore(opts.projectPath);
    const qaAgent = new QAAgent(caseStore, this.memory);

    const executor = new ExecutorAgent(opts.provider, this.standard ?? DEFAULT_PROJECT_STANDARD);

    let prevScore = -1;
    let noProgressRounds = 0;
    let officialModelCatalogRefreshAttempted = false;
    let advisoryResearchAttempted = false;

    /**
     * Track repair attempts per failing verification command across iterations.
     * When the same command fails 3+ times in a row with the same root-cause
     * signature, we halt the iterate loop instead of burning more model calls
     * on a problem the agent loop cannot diagnose. The user can then take over.
     */
    const repairAttempts = new Map<string, Array<{ summary: string; changed_files: string[]; signatures: string[] }>>();
    const REPAIR_ABORT_THRESHOLD = 3;
    let repairLoopAborted = false;

    const workspace = opts.useWorktree ? new IterationWorkspace(opts.projectPath) : null;

    for (let i = 0; i < maxIter; i++) {
      const iterationId = shortId('iter');
      const startedAt = nowIso();
      const cost = new CostTracker(iterationId);
      await store.append({
        iteration_id: iterationId,
        agent: 'supervisor',
        event_type: 'iteration_started',
        severity: 'info',
        message: `iteration ${i + 1}/${maxIter} for goal "${opts.goal}"`,
      });

      let workspaceEnabled = false;
      if (workspace) {
        const begin = await workspace.begin(iterationId);
        workspaceEnabled = begin.enabled;
        await store.append({
          iteration_id: iterationId,
          agent: 'supervisor',
          event_type: 'note',
          severity: 'info',
          message: begin.enabled
            ? `workspace branch created: ${begin.manifest?.iter_branch}`
            : `workspace disabled: ${begin.reason ?? 'unknown'}`,
          metadata: { workspace_enabled: begin.enabled, reason: begin.reason },
        });
      }

      if (!officialModelCatalogRefreshAttempted) {
        officialModelCatalogRefreshAttempted = true;
        await this.refreshOfficialModelCatalogIfRequested(opts, iterationId, store);
      }
      if (!advisoryResearchAttempted) {
        advisoryResearchAttempted = true;
        await this.refreshAdvisoryMarketResearchIfRequested(opts, iterationId, store);
      }

      // 1. analyze
      const { snapshot, score: scoreBefore, gap } = await this.analyzer.fullAnalyzeWithEvidence(
        opts.projectPath,
        { runCommands: true, timeoutMs: 60_000 },
      );
      const graph = new EvidenceGraph(iterationId);
      const snapshotEv = graph.addEvidence({
        type: 'note', source_agent: 'analyzer',
        content_summary: `snapshot: lang=${snapshot.detected_language}, pm=${snapshot.package_manager}, files=${snapshot.important_files.length}`,
        confidence: 'high', related_files: snapshot.important_files,
      });
      const scoreEv = graph.addEvidence({
        type: 'score', source_agent: 'analyzer',
        content_summary: `before: total=${scoreBefore.total} grade=${scoreBefore.grade}`,
        confidence: 'high', metadata: { breakdown: scoreBefore.breakdown },
      });
      graph.addClaim({
        claim: `project starts at score=${scoreBefore.total} grade=${scoreBefore.grade}`,
        status: 'verified',
        evidence_ids: [snapshotEv.id, scoreEv.id],
        confidence: 'high',
      });
      for (const f of gap.findings) {
        graph.addEvidence({
          type: 'finding', source_agent: 'analyzer',
          content_summary: `${f.category}/${f.severity}: ${f.message}`,
          confidence: 'high', related_files: f.related_files,
          metadata: { finding_id: f.id },
        });
      }
      for (const audit of gap.agent_misjudgments ?? []) {
        await store.append({
          iteration_id: iterationId,
          agent: 'analyzer',
          event_type: 'note',
          severity: 'medium',
          message: `agent misjudgment detected: suppressed ${audit.finding_category} (${audit.reason})`,
          files_changed: audit.related_files,
          metadata: {
            finding_id: audit.finding_id,
            action: audit.action,
            confidence: audit.confidence,
          },
        });
        graph.addEvidence({
          type: 'note',
          source_agent: 'analyzer',
          content_summary: `misjudgment audit suppressed ${audit.finding_category}: ${audit.reason}`,
          confidence: audit.confidence,
          related_files: audit.related_files,
          metadata: { finding_id: audit.finding_id, action: audit.action },
        });
      }

      const advisoryReports = await this.runAdvisoryIfRequested(opts, iterationId, store, graph, {
        snapshot,
        score: scoreBefore,
        gap,
      });
      if (advisoryReports.length > 0) {
        gap.advisory_reports = advisoryReports;
      }

      // 2. preflight QA cases (consults global+workspace+repo scopes when systemRoot is provided)
      const qaPreflight = await qaAgent.preflight(iterationId, snapshot, store, { systemRoot: opts.systemRoot });

      // 3. plan
      const plan = this.planner.plan(gap, opts.goal, iterationId, {
        qaCases: qaPreflight.cases,
      });

      // 4. execute each task (with optional retry + parallelism)
      const allResults: AgentResult[] = [];
      const reviewerFindings: string[] = [];
      const assignedTasks: AgentTask[] = [];
      const retryPolicy: RetryPolicy = opts.retryPolicy ?? { maxAttempts: 1, retryOnStatuses: ['failed'] };
      const parallelism = Math.max(1, opts.parallelism ?? 1);

      const runOne = async (task: AgentTask): Promise<AgentResult> => {
        assignedTasks.push(task);
        await store.append({
          iteration_id: iterationId,
          agent: 'supervisor',
          event_type: 'task_assigned',
          severity: 'info',
          message: `assigned: ${task.title}`,
          metadata: { task_id: task.id, assigned_to: task.assigned_to },
        });

        let lastVerified: AgentResult | null = null;
        for (let attempt = 1; attempt <= retryPolicy.maxAttempts; attempt++) {
          const execResult = await executor.execute(task, {
            project_path: opts.projectPath,
            iteration_id: iterationId,
            recent_events: await store.readIteration(iterationId),
          });
          const supervisorVerificationCommands = commandsNeedingSupervisorVerification(
            task,
            execResult,
            opts.extraVerificationCommands ?? [],
          );
          lastVerified = await this.verifier.verify(
            opts.projectPath,
            execResult,
            supervisorVerificationCommands,
          );

          const shouldRetry =
            attempt < retryPolicy.maxAttempts &&
            retryPolicy.retryOnStatuses.includes(lastVerified.status as 'failed') &&
            lastVerified.status === 'failed';
          if (!shouldRetry) break;
          await store.append({
            iteration_id: iterationId,
            agent: 'supervisor',
            event_type: 'note',
            severity: 'medium',
            message: `retrying task "${task.title}" (attempt ${attempt + 1}/${retryPolicy.maxAttempts})`,
            metadata: { task_id: task.id, attempt },
          });
        }
        const verified = lastVerified!;

        // Reviewer
        const findings = this.reviewer.review(task, verified);
        for (const f of findings) {
          reviewerFindings.push(`[${f.rule}/${f.severity}] ${f.message}`);
          await store.append({
            iteration_id: iterationId,
            agent: 'reviewer',
            event_type: 'review_finding',
            severity: f.severity,
            message: f.message,
            metadata: { rule: f.rule, task_id: task.id },
          });
        }

        // record final task event
        await store.append({
          iteration_id: iterationId,
          agent: 'executor',
          event_type: verified.status === 'completed' ? 'task_completed' : 'task_failed',
          severity: verified.status === 'completed' ? 'info' : 'high',
          message: verified.summary,
          files_changed: verified.changed_files,
          metadata: { task_id: task.id, commands_run: verified.commands_run },
        });
        for (const ev of verified.verification_evidence) {
          await store.append({
            iteration_id: iterationId,
            agent: 'verifier',
            event_type: ev.passed ? 'verification_passed' : 'verification_failed',
            severity: ev.passed ? 'info' : 'high',
            message: ev.passed ? `passed: ${ev.command}` : `failed: ${ev.command} (${ev.failure_reason ?? 'unknown'})`,
            command: ev.command,
            command_exit_code: ev.exit_code,
            raw_output: `${ev.stdout_summary}\n${ev.stderr_summary}`.slice(0, 4000),
            metadata: { duration_ms: ev.duration_ms },
          });
          cost.addCommand(ev.duration_ms, (ev.stdout_summary.length + ev.stderr_summary.length) / 4);
        }
        return verified;
      };

      // Run in chunks of `parallelism`. If verification fails, repair becomes
      // the next task and ordinary productization work pauses for this round.
      let haltNormalTasks = false;
      for (let i2 = 0; i2 < plan.tasks.length; i2 += parallelism) {
        if (haltNormalTasks) break;
        const slice = plan.tasks.slice(i2, i2 + parallelism);
        const results = await Promise.all(slice.map(runOne));
        for (let idx = 0; idx < results.length; idx++) {
          const r = results[idx]!;
          allResults.push(r);
          const failedTask = slice[idx]!;
          const failedEvidence = r.verification_evidence.find((e) => !e.passed);
          const repairKey = failedEvidence ? failedEvidence.command : null;
          const priorAttempts = repairKey ? repairAttempts.get(repairKey) ?? [] : [];
          const repairTask = buildVerificationRepairTask(failedTask, r, {
            consecutiveFailures: priorAttempts.length + 1,
            priorAttempts: priorAttempts.map((a) => ({ summary: a.summary, changed_files: a.changed_files })),
          });
          if (repairTask) {
            if (repairKey && priorAttempts.length >= REPAIR_ABORT_THRESHOLD - 1) {
              await store.append({
                iteration_id: iterationId,
                agent: 'supervisor',
                event_type: 'note',
                severity: 'high',
                message: `repair loop abort: '${repairKey}' has failed ${priorAttempts.length + 1} times; halting iteration loop for human handoff`,
                metadata: {
                  failed_command: repairKey,
                  prior_attempts: priorAttempts.length,
                  threshold: REPAIR_ABORT_THRESHOLD,
                },
              });
              graph.addEvidence({
                type: 'note',
                source_agent: 'supervisor',
                content_summary: `repair_loop_aborted: '${repairKey}' failed ${priorAttempts.length + 1}x with no progress; prior root-causes: ${priorAttempts.flatMap((a) => a.signatures).slice(0, 4).join('; ') || 'none captured'}`,
                confidence: 'high',
                metadata: { failed_command: repairKey, prior_attempts: priorAttempts.length },
              });
              repairLoopAborted = true;
              haltNormalTasks = true;
              break;
            }
            await store.append({
              iteration_id: iterationId,
              agent: 'supervisor',
              event_type: 'note',
              severity: 'high',
              message: priorAttempts.length > 0
                ? `verification failed (attempt ${priorAttempts.length + 1}/${REPAIR_ABORT_THRESHOLD}); escalating repair task for "${failedTask.title}"`
                : `verification failed; prioritizing repair task for "${failedTask.title}"`,
              metadata: { failed_task_id: failedTask.id, repair_task_id: repairTask.id, consecutive_failures: priorAttempts.length + 1 },
            });
            const repairResult = await runOne(repairTask);
            allResults.push(repairResult);
            if (repairKey) {
              const repairEvidence = repairResult.verification_evidence.find((e) => !e.passed);
              if (repairEvidence) {
                // Repair did not pass — record the attempt for the next iteration.
                const signatures = extractRootCauseSignatures(`${repairEvidence.stdout_summary}\n${repairEvidence.stderr_summary}`);
                const next = [...priorAttempts, {
                  summary: repairResult.summary.slice(0, 240),
                  changed_files: repairResult.changed_files,
                  signatures,
                }];
                repairAttempts.set(repairKey, next);
              } else {
                // Repair succeeded — clear history for this command.
                repairAttempts.delete(repairKey);
              }
            }
            haltNormalTasks = true;
            break;
          }
        }
      }

      // 5. QA learn from this iteration
      const events = await store.readIteration(iterationId);
      this.memory.ingest(events);
      const qaCases = await qaAgent.learnFromEvents(iterationId, events, store);

      // optional: update regression spec at system level
      if (opts.systemRoot) {
        await qaAgent.upsertRegressionSpec(opts.systemRoot);
      }

      // 6. re-score
      const afterAnalysis = await this.analyzer.fullAnalyzeWithEvidence(
        opts.projectPath,
        { runCommands: true, timeoutMs: 60_000 },
      );
      const scoreAfter = afterAnalysis.score;
      const gapAfter = afterAnalysis.gap;
      const fixedDefects = Math.max(0, gap.findings.length - gapAfter.findings.length);

      // 7. build & save summary
      const finishedAt = nowIso();
      const summary: IterationSummary = {
        iteration_id: iterationId,
        user_goal: opts.goal,
        project_path: opts.projectPath,
        project_snapshot: snapshot,
        gap_report: gap,
        iteration_plan: plan,
        assigned_tasks: assignedTasks,
        executor_results: allResults,
        changed_files: dedupe(allResults.flatMap((r) => r.changed_files)),
        verification_results: allResults.flatMap((r) => r.verification_evidence),
        reviewer_findings: reviewerFindings,
        qa_cases_created_or_updated: qaCases.map((c) => c.id),
        project_score_before: scoreBefore,
        project_score_after: scoreAfter,
        next_iteration_recommendations: gapAfter.recommendations,
        started_at: startedAt,
        finished_at: finishedAt,
      };
      await store.saveIterationSummary(summary);
      // record after-score claim into the evidence graph
      const scoreAfterEv = graph.addEvidence({
        type: 'score', source_agent: 'analyzer',
        content_summary: `after: total=${scoreAfter.total} grade=${scoreAfter.grade}`,
        confidence: 'high', metadata: { breakdown: scoreAfter.breakdown },
      });
      graph.addClaim({
        claim: `iteration delta=${scoreAfter.total - scoreBefore.total}`,
        status: scoreAfter.total >= scoreBefore.total ? 'verified' : 'contradicted',
        evidence_ids: [scoreEv.id, scoreAfterEv.id],
        confidence: 'high',
      });
      for (const qaId of qaCases.map((c) => c.fingerprint)) {
        graph.addEvidence({
          type: 'qa_case', source_agent: 'qa',
          content_summary: `qa case: ${qaId}`,
          confidence: 'high',
          metadata: { fingerprint: qaId },
        });
      }
      await graph.persist(opts.projectPath);
      const costRecord = cost.finalize({
        score_delta: scoreAfter.total - scoreBefore.total,
        defects_fixed: fixedDefects,
      });
      await CostTracker.persist(opts.projectPath, costRecord);
      await store.append({
        iteration_id: iterationId,
        agent: 'supervisor',
        event_type: 'iteration_finished',
        severity: 'info',
        message: `score ${scoreBefore.total} → ${scoreAfter.total} (cost ${costRecord.command_count} cmds, ${costRecord.wall_time_ms}ms)`,
      });
      summaries.push(summary);

      // Finalize workspace: success = score did not regress AND no high-sev review findings
      if (workspace && workspaceEnabled) {
        const success =
          scoreAfter.total >= scoreBefore.total &&
          !reviewerFindings.some((f) => /\/high\]|\/blocker\]/.test(f));
        const m = await workspace.finalize({ iterationId, success });
        await store.append({
          iteration_id: iterationId,
          agent: 'supervisor',
          event_type: 'note',
          severity: 'info',
          message: `workspace finalized: outcome=${m?.outcome ?? 'unknown'}`,
          metadata: { outcome: m?.outcome },
        });
      }

      // 8. stop conditions
      if (gapAfter.findings.length === 0 && gapAfter.blockers.length === 0) break;
      if (scoreAfter.grade === 'production_ready_baseline' && gapAfter.findings.length === 0 && gapAfter.blockers.length === 0) break;
      if (repairLoopAborted) {
        await store.append({
          iteration_id: iterationId,
          agent: 'supervisor',
          event_type: 'note',
          severity: 'high',
          message: 'iteration loop terminated: repair_loop_aborted — the same verification failure recurred past the convergence threshold; human handoff required',
        });
        break;
      }
      if (prevScore >= 0 && scoreAfter.total <= prevScore && fixedDefects === 0) {
        noProgressRounds++;
        if (noProgressRounds >= 2) break;
      } else {
        noProgressRounds = 0;
      }
      prevScore = scoreAfter.total;
    }
    return summaries;
  }

  private async refreshOfficialModelCatalogIfRequested(
    opts: IterateOptions,
    iterationId: string,
    store: EventStore,
  ): Promise<void> {
    if (!opts.officialModelCatalog?.allowNetwork) return;
    const mode = opts.officialModelCatalog.mode ?? 'auto';
    if (mode !== 'always' && !(await projectHasLlmProviderSurface(opts.projectPath))) {
      await store.append({
        iteration_id: iterationId,
        agent: 'analyzer',
        event_type: 'note',
        severity: 'info',
        message: 'official LLM model catalog refresh skipped: no LLM provider surface detected',
        metadata: { official_model_catalog_refresh: 'skipped_no_llm_surface' },
      });
      return;
    }
    try {
      const catalog = await refreshOfficialModelCatalog({
        ...opts.officialModelCatalog,
        projectPath: opts.projectPath,
        systemRoot: opts.systemRoot ?? opts.projectPath,
      });
      await writeOfficialModelCatalog(opts.projectPath, catalog);
      await store.append({
        iteration_id: iterationId,
        agent: 'analyzer',
        event_type: 'note',
        severity: catalog.warnings.length > 0 ? 'medium' : 'info',
        message: `official LLM model catalog refreshed from provider docs (${catalog.providers.length} providers, ${catalog.warnings.length} warning(s))`,
        files_changed: ['.demo2project/research/llm-model-catalog.json'],
        metadata: {
          artifact: '.demo2project/research/llm-model-catalog.json',
          provider_count: catalog.providers.length,
          refreshed_provider_count: catalog.providers.filter((provider) => provider.source_kind === 'live_official_docs').length,
          warnings: catalog.warnings,
        },
      });
    } catch (err) {
      await store.append({
        iteration_id: iterationId,
        agent: 'analyzer',
        event_type: 'note',
        severity: 'medium',
        message: `official LLM model catalog refresh skipped: ${err instanceof Error ? err.message : String(err)}`,
        metadata: { official_model_catalog_refresh: 'failed' },
      });
    }
  }

  private async refreshAdvisoryMarketResearchIfRequested(
    opts: IterateOptions,
    iterationId: string,
    store: EventStore,
  ): Promise<void> {
    if (!opts.advisory?.autoResearch) return;
    if (!opts.advisory.allowNetwork) {
      await store.append({
        iteration_id: iterationId,
        agent: 'advisory',
        event_type: 'note',
        severity: 'medium',
        message: 'advisory market research skipped: --web network opt-in is required',
        metadata: { advisory_research: 'skipped_no_network' },
      });
      return;
    }
    try {
      const snapshot = await this.analyzer.snapshot(opts.projectPath);
      const inferenceText = await collectDomainInferenceText(opts.projectPath);
      const primaryDomain = inferMarketResearchDomain(snapshot, inferenceText);
      // When the project also has a real web UI surface (SSR or SPA), pull a
      // second-domain research pass for `web_ui_app`. Without this, agent or
      // API-shaped primary domains never surface UI capabilities (accessibility,
      // responsive, onboarding, loading/error states) into advisory context.
      const secondaryDomain = await inferSecondaryDomain(snapshot, opts.projectPath, primaryDomain);
      const provider = opts.advisory.searchProvider ?? new ControlledWebSearchProvider({
        systemRoot: opts.projectPath,
        allowNetwork: true,
      });
      const passes: Array<{ domain: typeof primaryDomain; query: string }> = [
        { domain: primaryDomain, query: defaultMarketResearchQuery(primaryDomain) },
      ];
      if (secondaryDomain && secondaryDomain !== primaryDomain) {
        passes.push({ domain: secondaryDomain, query: defaultMarketResearchQuery(secondaryDomain) });
      }
      let mergedReport: Awaited<ReturnType<typeof runMarketResearch>> | null = null;
      for (const pass of passes) {
        const report = await runMarketResearch({
          projectPath: opts.projectPath,
          domain: pass.domain,
          query: pass.query,
          provider,
          maxResults: 8,
        });
        if (!mergedReport) {
          mergedReport = report;
        } else {
          mergedReport.capabilities = dedupeCapabilities([...mergedReport.capabilities, ...report.capabilities]);
          mergedReport.sources = dedupeSources([...mergedReport.sources, ...report.sources]);
          mergedReport.query = `${mergedReport.query} | ${report.query}`;
          if (report.confidence === 'low' || mergedReport.confidence === 'low') mergedReport.confidence = 'low';
        }
        await store.append({
          iteration_id: iterationId,
          agent: 'advisory',
          event_type: 'note',
          severity: report.confidence === 'low' ? 'medium' : 'info',
          message: `advisory market research refreshed for ${pass.domain}: ${report.sources.length} source(s), ${report.capabilities.length} capability(ies)`,
          metadata: {
            advisory_research: 'refreshed',
            domain: pass.domain,
            query: pass.query,
            provider: provider.name,
            source_count: report.sources.length,
            capability_count: report.capabilities.length,
            confidence: report.confidence,
          },
        });
      }
      if (mergedReport) await writeMarketResearchReport(opts.projectPath, mergedReport);
    } catch (err) {
      await store.append({
        iteration_id: iterationId,
        agent: 'advisory',
        event_type: 'note',
        severity: 'medium',
        message: `advisory market research skipped: ${err instanceof Error ? err.message : String(err)}`,
        metadata: { advisory_research: 'failed_closed' },
      });
    }
  }

  private async runAdvisoryIfRequested(
    opts: IterateOptions,
    iterationId: string,
    store: EventStore,
    graph: EvidenceGraph,
    input: {
      snapshot: Awaited<ReturnType<AnalyzerAgent['snapshot']>>;
      score: Awaited<ReturnType<AnalyzerAgent['score']>>;
      gap: Awaited<ReturnType<AnalyzerAgent['gap']>>;
    },
  ): Promise<AdvisoryReport[]> {
    if (!opts.advisory?.provider) return [];
    if (shouldSkipAdvisoryForMechanicalCloseout(input.gap)) {
      await store.append({
        iteration_id: iterationId,
        agent: 'advisory',
        event_type: 'note',
        severity: 'info',
        message: 'advisory agents skipped: remaining gaps are deterministic deployment/docs closeout work',
        metadata: {
          advisory: 'skipped_mechanical_closeout',
          finding_count: input.gap.findings.length,
        },
      });
      return [];
    }
    const roles = opts.advisory.roles ?? [
      'market_comparator',
      'gap_critic',
      'planner_critic',
      'reviewer_critic',
    ];
    try {
      const marketResearch = await loadMarketResearchReport(opts.projectPath);
      const reports = await new ModelAdvisoryAgent(opts.advisory.provider).runMany(roles, {
        projectPath: opts.projectPath,
        goal: opts.goal,
        snapshot: input.snapshot,
        score: input.score,
        gap: input.gap,
        allowNetwork: opts.advisory.allowNetwork === true,
        marketResearch,
      });
      for (const report of reports) {
        const findingCount = report.findings.length;
        const proposalCount = report.task_proposals.length;
        await store.append({
          iteration_id: iterationId,
          agent: 'advisory',
          event_type: 'note',
          severity: findingCount + proposalCount > 0 ? 'medium' : 'info',
          message: `advisory ${report.role} produced ${findingCount} finding(s), ${proposalCount} task proposal(s)`,
          metadata: {
            role: report.role,
            provider: report.provider,
            model: report.model,
            gate_policy: report.gate_policy,
            risks: report.risks,
          },
        });
        graph.addEvidence({
          type: 'note',
          source_agent: 'advisory',
          content_summary: `${report.role}: ${findingCount} finding(s), ${proposalCount} task proposal(s)`,
          confidence: report.findings.some((finding) => finding.confidence === 'high') ||
            report.task_proposals.some((proposal) => proposal.confidence === 'high')
            ? 'high'
            : 'medium',
          metadata: {
            role: report.role,
            provider: report.provider,
            model: report.model,
            gate_policy: report.gate_policy,
          },
        });
      }
      return reports;
    } catch (err) {
      await store.append({
        iteration_id: iterationId,
        agent: 'advisory',
        event_type: 'note',
        severity: 'medium',
        message: `advisory agents skipped: ${err instanceof Error ? err.message : String(err)}`,
        metadata: { advisory: 'failed_closed' },
      });
      return [];
    }
  }
}

export function shouldSkipAdvisoryForMechanicalCloseout(gap: Pick<GapReport, 'findings' | 'product_maturity'>): boolean {
  if (gap.findings.length === 0) return false;
  if (!gap.findings.every((finding) => MECHANICAL_CLOSEOUT_CATEGORIES.has(finding.category))) return false;
  const missingCapabilities = gap.product_maturity?.missing_capabilities ?? [];
  return missingCapabilities.every((capability) =>
    /\b(deploy|deployment|docker|wsgi|gunicorn|ci|workflow|docs?|documentation|operations?|architecture|runbook|health check)\b/i.test(capability),
  );
}

const MECHANICAL_CLOSEOUT_CATEGORIES = new Set([
  'missing_recommended_file',
  'missing_wsgi_entrypoint',
  'missing_python_production_server',
  'missing_deployment_artifact',
  'flask_docker_uses_dev_server',
  'missing_deployment_docs',
  'missing_operational_docs',
  'missing_game_design_doc',
  'no_ci',
  'misaligned_ci',
  'ci_ignores_python_constraints',
]);

async function projectHasLlmProviderSurface(projectPath: string): Promise<boolean> {
  if (await exists(officialModelCatalogPath(projectPath))) return true;
  const candidates = [
    'llm_config.py',
    'app.py',
    'player.py',
    'game.py',
    'config.py',
    'requirements.txt',
    'pyproject.toml',
    'package.json',
    'templates/index.html',
    'src/App.vue',
    'src/App.tsx',
    'src/App.jsx',
    'src/main.ts',
    'src/main.tsx',
    'index.html',
  ];
  const text = (await Promise.all(candidates.map((rel) => readTextIfExists(path.join(projectPath, rel))))).join('\n');
  return /\b(public_provider_config|PROVIDER_PRESETS|llmProvider|llmModel|LLM|openai|deepseek|minimax|qwen|dashscope|model\s*[:=]|api_key)\b/i.test(text);
}

async function readTextIfExists(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function collectDomainInferenceText(projectPath: string): Promise<string> {
  const files = await listFiles(projectPath, 300);
  const candidates = files
    .filter((file) => /\.(md|py|js|ts|tsx|jsx|vue|html|txt|toml|json)$/i.test(file))
    .filter((file) => !/(^|\/)(package-lock|pnpm-lock|yarn\.lock|uv\.lock)\b/.test(file))
    .sort((a, b) => domainSignalRank(a) - domainSignalRank(b))
    .slice(0, 40);
  const chunks: string[] = [];
  for (const file of candidates) {
    const text = await readTextSafe(path.join(projectPath, file));
    if (!text) continue;
    chunks.push(`--- ${file} ---\n${text.slice(0, 6000)}`);
  }
  return chunks.join('\n');
}

function domainSignalRank(file: string): number {
  if (/README|game|rules|prompts|player|main|app/i.test(file)) return 0;
  if (/src|templates|docs/i.test(file)) return 1;
  return 2;
}

/**
 * Pick a secondary research domain when the project has a real UI surface
 * underneath a non-UI primary domain (agent_social_deduction_theater,
 * api_service, cli_tool, ...). Without this pass, advisory critics never see
 * UI-product capabilities like accessibility, responsive layout or
 * loading/error states even when the project ships a content-rich web UI.
 *
 * The secondary research is added on top of the primary; capabilities are
 * deduped into one merged report so advisory roles get a single union view.
 */
async function inferSecondaryDomain(
  snapshot: Awaited<ReturnType<AnalyzerAgent['snapshot']>>,
  projectPath: string,
  primaryDomain: ReturnType<typeof inferMarketResearchDomain>,
): Promise<ReturnType<typeof inferMarketResearchDomain> | null> {
  if (primaryDomain === 'web_ui_app' || primaryDomain === 'saas_app') return null;
  const files = await listFiles(projectPath, 400);
  const hasServerFramework = snapshot.detected_frameworks.some((f) =>
    ['flask', 'django', 'fastapi', 'express', 'fastify', 'rails', 'sinatra', 'nestjs', 'hono'].includes(f.toLowerCase()),
  );
  const hasFrontendFramework = snapshot.detected_frameworks.some((f) =>
    ['react', 'next', 'vue', 'svelte'].includes(f.toLowerCase()),
  );
  const templates = files.filter((f) => /^(templates|views|app\/templates)\/.*\.(html|jinja2?|j2|erb|hbs)$/i.test(f));
  const spaEntrypoints = files.filter((f) =>
    /^(src\/)?App\.(tsx|jsx|ts|js|vue|svelte)$/.test(f) || f === 'index.html',
  );
  if (hasFrontendFramework && spaEntrypoints.length > 0) return 'web_ui_app';
  if (hasServerFramework && templates.length > 0) {
    let total = 0;
    for (const file of templates.slice(0, 8)) {
      const text = await readTextSafe(path.join(projectPath, file));
      if (text) total += text.length;
      if (total >= 4000) return 'web_ui_app';
    }
  }
  return null;
}

function dedupeCapabilities<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

function dedupeSources<T extends { url: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    out.push(item);
  }
  return out;
}

function dedupe<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function commandsNeedingSupervisorVerification(
  task: AgentTask,
  result: AgentResult,
  extraCommands: string[],
): string[] {
  const observed = new Set(result.verification_evidence.map((e) => e.command));
  const reported = new Set(result.commands_run);
  const taskCommands =
    result.verification_evidence.length === 0
      ? task.verification_commands.filter((cmd) => reported.has(cmd))
      : [];
  return dedupe([...taskCommands, ...extraCommands].filter((cmd) => !observed.has(cmd)));
}
