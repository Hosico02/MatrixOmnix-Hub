import { Hono } from 'hono';
import { and, eq, desc } from 'drizzle-orm';
import type { DbHandle } from '../db/client.js';
import { runs } from '../db/schema.js';

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

  return r;
}
