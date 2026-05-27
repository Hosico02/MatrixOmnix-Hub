import { Hono } from 'hono';
import { z } from 'zod';
import { resolve, sep } from 'node:path';
import { stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { DbHandle } from '../db/client.js';
import { adminAuth } from '../auth.js';
import { runs } from '../db/schema.js';
import type { RunSupervisor } from '../runner/supervisor.js';

export interface RunnerConfig {
  enabled: boolean;
  d2pPath: string;
  minimaxApiKey: string;
  instanceToken: string;
  hubBaseUrl: string;
  pathPrefixes: string[];
}

export interface RunnerDeps {
  adminToken: string | null;
  cfg: RunnerConfig | null;
}

const StartBody = z.object({
  project_path: z.string().min(1),
  iter: z.number().int().min(1).max(10).default(3),
});

function pathAllowed(p: string, prefixes: string[]): boolean {
  const r = resolve(p);
  if (r.includes('..')) return false;
  return prefixes.some((pre) => {
    const rp = resolve(pre);
    return r === rp || r.startsWith(rp + sep);
  });
}

export function runsRunnerRoute(
  handle: DbHandle, supervisor: RunSupervisor, deps: RunnerDeps,
) {
  const r = new Hono();
  const gate = adminAuth(deps.adminToken);

  // ---- POST /admin/runs/start --------------------------------------------
  r.post('/admin/runs/start', gate, async (c) => {
    if (!deps.cfg || !deps.cfg.enabled) {
      return c.json({ error: 'runner_disabled' }, 503);
    }
    if (!deps.cfg.d2pPath || !deps.cfg.minimaxApiKey
        || !deps.cfg.instanceToken) {
      return c.json({ error: 'runner_not_configured',
                      detail: 'D2P_PATH, D2P_RUNNER_MINIMAX_API_KEY, '
                              + 'D2P_RUNNER_INSTANCE_TOKEN must all be set.' },
                    503);
    }
    const parsed = StartBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: 'bad_body',
                      issues: parsed.error.issues.map((i) => i.message) }, 400);
    }
    const { project_path, iter } = parsed.data;
    if (!pathAllowed(project_path, deps.cfg.pathPrefixes)) {
      return c.json({ error: 'path_not_allowed',
                      detail: `must start with one of: ${deps.cfg.pathPrefixes.join(', ')}` },
                    400);
    }
    // Best-effort existence probe so callers see a clear ENOENT-style
    // error rather than a generic spawn failure later.
    try {
      const s = await stat(project_path);
      if (!s.isDirectory()) {
        return c.json({ error: 'not_a_directory' }, 400);
      }
    } catch {
      // For test envs where /tmp/x-demo etc may not exist on disk, fall
      // through so the spawn (or its stub) surfaces.
    }
    const runId = randomUUID();
    // Prefer the d2p venv's python3 (has the d2p deps installed). Falls
    // back to system python3 — macOS doesn't ship a `python` symlink, so
    // hardcoding `python` breaks the spawn with ENOENT.
    const { existsSync: _exists } = await import('node:fs');
    const venvPython = `${deps.cfg.d2pPath}/.venv/bin/python3`;
    const command = _exists(venvPython) ? venvPython : 'python3';
    // argv form — no shell parsing. project_path is the only user-supplied
    // string and it's already prefix-whitelisted above.
    const args = [
      `${deps.cfg.d2pPath}/run.py`, project_path,
      '--iter', String(iter), '--no-cache-analysis',
    ];
    const env = {
      ...process.env as Record<string, string>,
      HUB_URL: deps.cfg.hubBaseUrl,
      HUB_TOKEN: deps.cfg.instanceToken,
      MINIMAX_API_KEY: deps.cfg.minimaxApiKey,
      D2P_RUN_ID: runId,
    };
    try {
      const ar = supervisor.acquire({
        runId, projectPath: project_path, command, args, env,
      });
      return c.json({ run_id: ar.runId, pid: ar.pid,
                       stdout_log: `${ar.runId}.log` });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/already.+flight/i.test(msg)) {
        const cur = supervisor.current();
        return c.json({ error: 'run_already_in_flight',
                        current_run_id: cur?.runId ?? null }, 409);
      }
      return c.json({ error: 'spawn_failed', detail: msg }, 500);
    }
  });

  // ---- GET /admin/runs/current ------------------------------------------
  r.get('/admin/runs/current', gate, (c) => {
    const ar = supervisor.current();
    if (!ar) return c.json({ run_id: null });
    return c.json({
      run_id: ar.runId, pid: ar.pid, project_path: ar.projectPath,
      started_at: new Date(ar.startedAt).toISOString(),
    });
  });

  // ---- GET /admin/runs/:id/stdout?from=N --------------------------------
  r.get('/admin/runs/:id/stdout', gate, async (c) => {
    const id = c.req.param('id');
    const from = Number(c.req.query('from') ?? '0');
    const cur = supervisor.current();
    const { join: pJoin } = await import('node:path');
    const { dataDir } = (supervisor as unknown as { opts: { dataDir: string } }).opts;

    // Single SELECT — used for both path resolution and EOF gate.
    const runsRow = handle.db.select().from(runs).where(eq(runs.id, id)).get();

    const path = cur?.runId === id
      ? cur.stdoutPath
      : (runsRow?.stdoutPath ?? pJoin(dataDir, 'runner-logs', `${id}.log`));

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

  // ---- POST /admin/runs/:id/push-github ---------------------------------
  const PushBody = z.object({
    remote_url: z.string().regex(
      /^(git@github\.com:[^/]+\/[^/]+\.git|https:\/\/github\.com\/[^/]+\/[^/]+(\.git)?)$/,
      'remote_url must be a GitHub git@ or https URL'),
    branch: z.string().regex(/^[A-Za-z0-9._/-]+$/).min(1).max(100),
    commit_message: z.string().min(1).max(4000),
  });

  r.post('/admin/runs/:id/push-github', gate, async (c) => {
    if (!deps.cfg || !deps.cfg.enabled) {
      return c.json({ error: 'runner_disabled' }, 503);
    }
    const id = c.req.param('id');
    const rowOrNull = handle.db.select().from(runs).where(eq(runs.id, id)).get();
    if (!rowOrNull) return c.json({ error: 'run_not_found' }, 404);
    const row = rowOrNull;
    if (row.terminalState == null) {
      return c.json({ error: 'run_still_running',
                       detail: 'wait for d2p to finish before pushing' }, 409);
    }
    const parsed = PushBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: 'bad_body',
                      issues: parsed.error.issues.map((i) => i.message) }, 400);
    }
    const { remote_url, branch, commit_message } = parsed.data;

    const steps: Array<{ cmd: string; exit: number; output: string }> = [];
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    // Promise-wrapped execFile (NOT exec). argv form — every user-supplied
    // string travels as a single argv entry. Named runArgv to make the
    // safety property obvious at the callsite.
    const runArgv = promisify(execFile);

    async function runStep(label: string, argv: string[],
                            options: { allowNonZero?: boolean } = {}) {
      try {
        const out = await runArgv(argv[0], argv.slice(1), {
          cwd: row.projectPath, env: process.env, maxBuffer: 10_000_000,
        });
        steps.push({ cmd: label, exit: 0, output: out.stdout + out.stderr });
        return true;
      } catch (e: any) {
        const exitCode = typeof e.code === 'number' ? e.code : 1;
        const combined = (e.stdout ?? '') + (e.stderr ?? '');
        steps.push({ cmd: label, exit: exitCode, output: combined });
        if (options.allowNonZero) return false;
        return null;
      }
    }

    if (await runStep('git init', ['git', 'init']) === null) {
      return c.json({ steps, ok: false }, 500);
    }
    if (await runStep('git add -A', ['git', 'add', '-A']) === null) {
      return c.json({ steps, ok: false }, 500);
    }
    // "nothing to commit" is a normal state on re-push of unchanged tree
    await runStep(`git commit -m "${commit_message.replace(/"/g, '\\"')}"`,
                  ['git', 'commit', '-m', commit_message],
                  { allowNonZero: true });
    if (await runStep('git remote set-url origin <url>',
                      ['git', 'remote', 'set-url', 'origin', remote_url],
                      { allowNonZero: true }) === false) {
      if (await runStep('git remote add origin <url>',
                        ['git', 'remote', 'add', 'origin', remote_url]) === null) {
        return c.json({ steps, ok: false }, 500);
      }
    }
    if (await runStep(`git push -u origin ${branch}`,
                      ['git', 'push', '-u', 'origin', branch]) === null) {
      return c.json({ steps, ok: false }, 500);
    }

    const m = remote_url.match(
      /github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/);
    const remote_html = m ? `https://github.com/${m[1]}/${m[2]}` : null;
    return c.json({ steps, ok: true, remote_html });
  });

  return r;
}
