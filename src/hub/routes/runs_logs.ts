import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import type { DbHandle } from '../db/client.js';
import { adminAuth } from '../auth.js';
import { runs } from '../db/schema.js';
import type { RunSupervisor } from '../runner/supervisor.js';

export interface RunsLogsDeps {
  adminToken: string | null;
  dataDir: string;
  // Optional: only used to detect that the request is for a run currently
  // being spawned by Hub itself. When null (no runner configured), all
  // resolution falls through to the DB `stdout_path` and legacy fallback.
  supervisor: RunSupervisor | null;
}

export function runsLogsRoute(handle: DbHandle, deps: RunsLogsDeps) {
  const r = new Hono();
  const gate = adminAuth(deps.adminToken);

  r.get('/admin/runs/:id/stdout', gate, async (c) => {
    const id = c.req.param('id');
    const from = Number(c.req.query('from') ?? '0');
    const cur = deps.supervisor?.current() ?? null;
    const { join: pJoin } = await import('node:path');

    const runsRow = handle.db.select().from(runs).where(eq(runs.id, id)).get();

    const path = cur?.runId === id
      ? cur.stdoutPath
      : (runsRow?.stdoutPath ?? pJoin(deps.dataDir, 'runner-logs', `${id}.log`));

    const { open, stat: fstat } = await import('node:fs/promises');
    let size = 0;
    try {
      size = (await fstat(path)).size;
    } catch {
      return c.json({ error: 'log_not_found' }, 404);
    }

    // runsRow==null (no DB record): isLive falls back to supervisor identity
    // only. If also not the active run, treat as completed (eof=true).
    const isLive = cur?.runId === id
                || (runsRow != null && runsRow.terminatedAt == null);

    if (from >= size) {
      return c.json({ content: '', next_offset: size, eof: !isLive });
    }
    const fd = await open(path, 'r');
    try {
      const chunkSize = Math.min(size - from, 1_000_000);
      const buf = Buffer.alloc(chunkSize);
      await fd.read(buf, 0, chunkSize, from);
      const content = buf.toString('utf-8');
      const eof = (from + chunkSize >= size) && !isLive;
      return c.json({ content, next_offset: from + chunkSize, eof });
    } finally {
      await fd.close();
    }
  });

  return r;
}
