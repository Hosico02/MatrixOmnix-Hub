import { randomUUID } from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import type { DbHandle } from '../db/client.js';
import type { InstanceInfo } from '../auth.js';
import { runs, iterations, verdicts, findings } from '../db/schema.js';

function ensureRun(handle: DbHandle, inst: InstanceInfo, runId: string) {
  const existing = handle.db.select().from(runs).where(eq(runs.id, runId)).get();
  if (existing) return existing;
  handle.db.insert(runs).values({
    id: runId,
    instanceId: inst.id,
    projectPath: '(pending)',
    startedAt: new Date().toISOString(),
    terminalState: 'RUNNING',
  }).run();
  return handle.db.select().from(runs).where(eq(runs.id, runId)).get()!;
}

function ensureIteration(handle: DbHandle, runId: string, iterN: number) {
  const found = handle.db.select().from(iterations)
    .where(and(eq(iterations.runId, runId), eq(iterations.iterN, iterN)))
    .get();
  if (found) return found;
  const id = randomUUID();
  handle.db.insert(iterations).values({
    id, runId, iterN, startedAt: new Date().toISOString(),
  }).run();
  return handle.db.select().from(iterations).where(eq(iterations.id, id)).get()!;
}

export function dispatchIngest(
  handle: DbHandle, inst: InstanceInfo,
  type: string, runId: string, payload: Record<string, any>,
): void {
  switch (type) {
    case 'run_started': {
      ensureRun(handle, inst, runId);
      handle.db.update(runs).set({
        projectPath: payload.project_path ?? '(unknown)',
        detectedArchetype: payload.detected_archetype ?? null,
        startedAt: payload.started_at ?? new Date().toISOString(),
        terminalState: 'RUNNING',
      }).where(eq(runs.id, runId)).run();
      return;
    }
    case 'iteration_complete': {
      ensureRun(handle, inst, runId);
      const it = ensureIteration(handle, runId, payload.iter_n);
      handle.db.update(iterations).set({
        startedAt: payload.started_at ?? it.startedAt,
        endedAt: payload.ended_at ?? new Date().toISOString(),
        analyzerSummary: payload.analyzer_summary ?? null,
        plannerSummary: payload.planner_summary ?? null,
        executorSummary: payload.executor_summary ?? null,
        qaSummary: payload.qa_summary ?? null,
      }).where(eq(iterations.id, it.id)).run();
      return;
    }
    case 'verdict_emitted': {
      ensureRun(handle, inst, runId);
      const it = ensureIteration(handle, runId, payload.iter_n);
      handle.db.insert(verdicts).values({
        id: randomUUID(),
        iterationId: it.id,
        verdict: payload.verdict,
        confidence: payload.confidence ?? null,
        stabilitySignal: payload.stability_signal ?? null,
        suggestedNextFocus: payload.suggested_next_focus ?? null,
        rawResponse: payload.raw_response ?? null,
        standardsVersionId: payload.standards_version_id ?? null,
      }).run();
      return;
    }
    case 'finding_recorded': {
      ensureRun(handle, inst, runId);
      const it = ensureIteration(handle, runId, payload.iter_n);
      const latest = handle.db.select().from(verdicts)
        .where(eq(verdicts.iterationId, it.id)).all();
      let verdictId: string;
      if (latest.length > 0) {
        verdictId = latest[latest.length - 1].id;
      } else {
        verdictId = randomUUID();
        handle.db.insert(verdicts).values({
          id: verdictId, iterationId: it.id, verdict: 'needs_repair',
        }).run();
      }
      handle.db.insert(findings).values({
        id: randomUUID(),
        verdictId,
        category: payload.category,
        severity: payload.severity,
        message: payload.message ?? null,
        evidence: payload.evidence ?? null,
        isNew: payload.is_new ?? true,
      }).run();
      return;
    }
    case 'run_terminated': {
      ensureRun(handle, inst, runId);
      handle.db.update(runs).set({
        terminatedAt: payload.terminated_at ?? new Date().toISOString(),
        terminalState: payload.terminal_state ?? 'CLEAN',
        totalCostUsd: payload.total_cost_usd ?? 0,
        totalIterations: payload.total_iterations ?? 0,
      }).where(eq(runs.id, runId)).run();
      return;
    }
  }
}
