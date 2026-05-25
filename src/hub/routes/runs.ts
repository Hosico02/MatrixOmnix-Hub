import { Hono } from 'hono';
import { and, eq, desc, sql } from 'drizzle-orm';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { DbHandle } from '../db/client.js';
import { runs, iterations, verdicts, findings, mentorNotes } from '../db/schema.js';

const NoteBody = z.object({ body_md: z.string().min(1), author: z.enum(['human', 'llm']).default('human') });

export function runsRoute(handle: DbHandle) {
  const r = new Hono();

  r.get('/runs', (c) => {
    const archetype = c.req.query('archetype');
    const state = c.req.query('state');
    const instance = c.req.query('instance');
    const limit = Math.min(Number(c.req.query('limit') ?? 50), 200);

    const conds = [];
    if (archetype) conds.push(eq(runs.detectedArchetype, archetype));
    if (state) conds.push(eq(runs.terminalState, state));
    if (instance) conds.push(eq(runs.instanceId, instance));

    const q = conds.length > 0
      ? handle.db.select().from(runs).where(and(...conds)).orderBy(desc(runs.startedAt)).limit(limit)
      : handle.db.select().from(runs).orderBy(desc(runs.startedAt)).limit(limit);
    const rows = q.all();
    const items = rows.map((r) => ({
      id: r.id,
      instance_id: r.instanceId,
      project_path: r.projectPath,
      detected_archetype: r.detectedArchetype,
      started_at: r.startedAt,
      terminated_at: r.terminatedAt,
      terminal_state: r.terminalState,
      total_cost_usd: r.totalCostUsd,
      total_iterations: r.totalIterations,
    }));
    return c.json({ items });
  });

  r.get('/runs/:id', (c) => {
    const id = c.req.param('id');
    const run = handle.db.select().from(runs).where(eq(runs.id, id)).get();
    if (!run) return c.json({ error: 'not found' }, 404);
    const iters = handle.db.select().from(iterations).where(eq(iterations.runId, id)).all();
    const iterIds = iters.map((i) => i.id);
    const verds = iterIds.length > 0
      ? handle.db.select().from(verdicts)
          .where(sql`${verdicts.iterationId} IN (${sql.join(iterIds.map((id) => sql`${id}`), sql`, `)})`)
          .all()
      : [];
    const verdictIds = verds.map((v) => v.id);
    const finds = verdictIds.length > 0
      ? handle.db.select().from(findings)
          .where(sql`${findings.verdictId} IN (${sql.join(verdictIds.map((id) => sql`${id}`), sql`, `)})`)
          .all()
      : [];
    const notes = handle.db.select().from(mentorNotes).where(eq(mentorNotes.runId, id)).all();
    return c.json({
      run: {
        id: run.id, project_path: run.projectPath,
        detected_archetype: run.detectedArchetype,
        started_at: run.startedAt, terminated_at: run.terminatedAt,
        terminal_state: run.terminalState,
        total_cost_usd: run.totalCostUsd, total_iterations: run.totalIterations,
      },
      iterations: iters.map((i) => ({
        id: i.id, iter_n: i.iterN, started_at: i.startedAt, ended_at: i.endedAt,
        analyzer_summary: i.analyzerSummary, planner_summary: i.plannerSummary,
        executor_summary: i.executorSummary, qa_summary: i.qaSummary,
      })),
      verdicts: verds.map((v) => ({
        id: v.id, iteration_id: v.iterationId, verdict: v.verdict,
        confidence: v.confidence, stability_signal: v.stabilitySignal,
        suggested_next_focus: v.suggestedNextFocus,
        standards_version_id: v.standardsVersionId,
      })),
      findings: finds.map((f) => ({
        id: f.id, verdict_id: f.verdictId, category: f.category,
        severity: f.severity, message: f.message, evidence: f.evidence,
        is_new: f.isNew,
      })),
      notes: notes.map((n) => ({
        id: n.id, author: n.author, body_md: n.bodyMd, created_at: n.createdAt,
      })),
    });
  });

  r.post('/runs/:id/notes', async (c) => {
    const id = c.req.param('id');
    const exists = handle.db.select().from(runs).where(eq(runs.id, id)).get();
    if (!exists) return c.json({ error: 'run not found' }, 404);
    const parsed = NoteBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'bad body' }, 400);
    const noteId = randomUUID();
    handle.db.insert(mentorNotes).values({
      id: noteId, runId: id, author: parsed.data.author, bodyMd: parsed.data.body_md,
    }).run();
    return c.json({ note: { id: noteId, body_md: parsed.data.body_md } });
  });

  return r;
}
