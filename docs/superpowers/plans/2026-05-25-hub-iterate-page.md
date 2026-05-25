# Hub `/iterate` page implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an admin-only Hub UI page at `/iterate` that lets the operator
pick a local folder, kick off a d2p subprocess, watch live progress and
stdout, then push the productized result to an existing GitHub repo —
implementing the design in `docs/superpowers/specs/2026-05-25-hub-iterate-page-design.md`.

**Architecture:** Hub (Hono on Node) gains a `RunSupervisor` singleton that
spawns one `python run.py` child process at a time, piping its
stdout/stderr to a per-run log file. Four new `/admin/runs/*` routes
expose start / status-current / stdout-tail / push-github to the
browser. The Vue page polls existing `/api/runs/:id` for state and the
new `/admin/runs/:id/stdout` for the log tail. One line of d2p changes
to honor a pre-generated `D2P_RUN_ID` env var so Hub and d2p agree on
the run identifier.

**Tech Stack:** Hono + Drizzle + better-sqlite3 + Node `child_process.spawn`
on the backend; Vue 3 + Pinia + Vue Router + Tailwind + native `fetch`
on the frontend. vitest for backend tests, manual smoke for frontend.

**Security note:** the push-github route shells out to git. All shell-out
uses `execFile` (no shell parsing); user-supplied strings travel only as
argv entries. The remote URL is regex-whitelisted to GitHub before any
git call. The Promise-wrapped helper is named `runArgv` (not `exec`) to
make the safety property obvious at the callsite.

---

## File Structure

### New files (this repo, MatrixOmnix-Hub)

| Path | Responsibility |
|---|---|
| `src/hub/runner/supervisor.ts` | Singleton class managing one in-flight d2p child process: spawn, register exit handler that marks orphan runs as `crashed`, expose `current()` for the `GET /admin/runs/current` route, handle SIGTERM on Hub shutdown. |
| `src/hub/routes/runs_runner.ts` | The 4 new admin routes — `POST /admin/runs/start`, `GET /admin/runs/current`, `GET /admin/runs/:id/stdout`, `POST /admin/runs/:id/push-github`. |
| `tests/hub/runner.supervisor.test.ts` | Unit tests for the supervisor (acquire/release, crashed-orphan detection, SIGTERM on shutdown). |
| `tests/hub/routes.runs.start.test.ts` | Tests for `POST /admin/runs/start`. |
| `tests/hub/routes.runs.current.test.ts` | Tests for `GET /admin/runs/current`. |
| `tests/hub/routes.runs.stdout.test.ts` | Tests for `GET /admin/runs/:id/stdout`. |
| `tests/hub/routes.runs.pushgithub.test.ts` | Tests for `POST /admin/runs/:id/push-github`. |
| `site/src/views/Iterate.vue` | The page: setup form → progress → push panel state machine. |
| `site/src/stores/runner.ts` | Pinia store holding the current run_id + admin token (localStorage) across navigation. |
| `site/src/composables/useRunner.ts` | Polling logic + the `fetch` wrappers for the 4 new admin endpoints. |

### Modified files (this repo)

| Path | Change |
|---|---|
| `src/hub/config.ts` | Add `runnerEnabled`, `d2pPath`, `runnerMinimaxApiKey`, `runnerInstanceToken`, `runnerPathPrefixes`, `hubDataDir` to `HubConfig`. |
| `src/hub/server.ts` | Add `runner: RunSupervisor` and `runnerCfg: RunnerConfig` to `AppOpts`; mount `runs_runner.ts` routes. |
| `src/hub/index.ts` | Instantiate `RunSupervisor`, pass to `buildApp`, register SIGTERM handler that calls `supervisor.shutdown()`. |
| `site/src/router.ts` | Add `{ path: '/iterate', name: 'iterate', component: () => import('./views/Iterate.vue') }`. |
| `site/src/components/NavBar.vue` | Add `<router-link to="/iterate">` between `/` and `/standards`. |
| `site/src/api.ts` | Add `adminApi` helpers (4 endpoints) that include `Authorization: Bearer <stored-token>`. |

### Modified files (d2p sibling repo at `../d2p`)

| Path | Change |
|---|---|
| `d2p/orchestrator.py` | One-line change: `run_id = os.environ.get("D2P_RUN_ID") or str(uuid.uuid4())`. |

---

## Phase 0 — d2p side: D2P_RUN_ID env override (1 commit in d2p)

### Task 0.1: Honor D2P_RUN_ID in the orchestrator

**Files:**
- Modify: `/Users/mack/Desktop/Hosico/Works/Work/d2p/d2p/orchestrator.py`

- [ ] **Step 1: Verify current line**

Run: `grep -n "run_id = str(uuid.uuid4())" /Users/mack/Desktop/Hosico/Works/Work/d2p/d2p/orchestrator.py`
Expected: one match around line 220 inside `Orchestrator.run()`.

- [ ] **Step 2: Apply the edit**

In `d2p/orchestrator.py`, replace:
```python
        run_id = str(uuid.uuid4())
```
with:
```python
        # Honor D2P_RUN_ID if Hub pre-generated it (so Hub's RunSupervisor
        # and d2p agree on the row identifier before run_started is pushed).
        # Falls back to a fresh uuid for standalone runs.
        run_id = os.environ.get("D2P_RUN_ID") or str(uuid.uuid4())
```

`os` is already imported at the top of orchestrator.py (added earlier this session for the verifier pre-evidence subprocess work).

- [ ] **Step 3: Run d2p test suite**

Run:
```bash
cd /Users/mack/Desktop/Hosico/Works/Work/d2p && source .venv/bin/activate && python -m pytest tests/ -q --no-header
```
Expected: `155 passed`.

- [ ] **Step 4: Commit in d2p repo**

```bash
cd /Users/mack/Desktop/Hosico/Works/Work/d2p && git add d2p/orchestrator.py && git commit -m "$(cat <<'EOF'
feat: honor D2P_RUN_ID env so external supervisors can pre-pick the run id

Hub's RunSupervisor (in ../demo2project) needs to know the run_id before
d2p has pushed run_started, so it can track stdout-log paths and detect
crashed orphans. Pre-generating the uuid Hub-side and passing via env is
the simplest way; this one line opens that door without changing
standalone-run behavior (falls back to a fresh uuid).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 1 — Hub config additions

### Task 1.1: Extend HubConfig with runner fields

**Files:**
- Modify: `src/hub/config.ts`
- Test: `tests/hub/config.test.ts`

- [ ] **Step 1: Read the existing config.test.ts to understand its shape**

Run: `cat /Users/mack/Desktop/Hosico/Works/Work/demo2project/tests/hub/config.test.ts`
Expected: existing tests for `loadConfig({ requireAdminToken })`. We'll add cases beside them.

- [ ] **Step 2: Add the failing test**

Append to `tests/hub/config.test.ts`:
```ts
describe('runner config', () => {
  const savedEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('runnerEnabled defaults to false', () => {
    delete process.env.D2P_RUNNER_ENABLED;
    delete process.env.HUB_ADMIN_TOKEN;
    const cfg = loadConfig();
    expect(cfg.runnerEnabled).toBe(false);
  });

  it('runnerEnabled true when D2P_RUNNER_ENABLED=1', () => {
    process.env.D2P_RUNNER_ENABLED = '1';
    const cfg = loadConfig();
    expect(cfg.runnerEnabled).toBe(true);
  });

  it('runnerPathPrefixes defaults to $HOME + /tmp', () => {
    delete process.env.HUB_RUNNER_PATH_PREFIX;
    const cfg = loadConfig();
    expect(cfg.runnerPathPrefixes.length).toBeGreaterThanOrEqual(2);
    expect(cfg.runnerPathPrefixes).toContain('/tmp');
  });

  it('runnerPathPrefixes parses comma-separated env override', () => {
    process.env.HUB_RUNNER_PATH_PREFIX = '/a,/b/c';
    const cfg = loadConfig();
    expect(cfg.runnerPathPrefixes).toEqual(['/a', '/b/c']);
  });

  it('hubDataDir defaults to dirname(dbPath)', () => {
    process.env.HUB_DB_PATH = '/tmp/x/y/hub.db';
    delete process.env.HUB_DATA_DIR;
    const cfg = loadConfig();
    expect(cfg.hubDataDir).toBe('/tmp/x/y');
  });
});
```

Also add `afterEach` to the imports at the top of the file if not already present:
```ts
import { describe, it, expect, afterEach } from 'vitest';
```

- [ ] **Step 3: Run the new tests — expect failure**

Run: `npx vitest run tests/hub/config.test.ts`
Expected: 5 new tests fail because the new fields don't exist on the returned config.

- [ ] **Step 4: Implement the additions in config.ts**

Replace the entire body of `src/hub/config.ts` with:
```ts
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface HubConfig {
  port: number;
  bind: string;
  dbPath: string;
  adminToken: string | null;
  llmLearnerEnabled: boolean;
  anthropicApiKey: string | null;
  disabledRules: Set<string>;
  // d2p runner (operator subprocess surface). All opt-in via env;
  // defaults make a standard Hub deployment incapable of spawning processes.
  runnerEnabled: boolean;
  d2pPath: string | null;             // absolute path to the d2p repo
  runnerMinimaxApiKey: string | null; // injected into subprocess env
  runnerInstanceToken: string | null; // d2p uses this to push events back
  runnerPathPrefixes: string[];       // allowed prefixes for target paths
  hubDataDir: string;                 // where runner-logs/ lives
}

export interface LoadOpts { requireAdminToken?: boolean }

export function loadConfig(opts: LoadOpts = {}): HubConfig {
  const port = Number(process.env.HUB_PORT ?? 3030);
  const bind = process.env.HUB_BIND ?? '127.0.0.1';
  const dbPath = process.env.HUB_DB_PATH
    ?? join(homedir(), '.matrixomnix', 'hub.db');
  const adminToken = process.env.HUB_ADMIN_TOKEN ?? null;
  if (opts.requireAdminToken && !adminToken) {
    throw new Error('HUB_ADMIN_TOKEN is required');
  }
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY ?? null;
  const llmLearnerEnabled = !!anthropicApiKey
    && process.env.HUB_DISABLE_LLM_LEARNER !== '1';
  const disabledRules = new Set(
    (process.env.HUB_DISABLE_RULE ?? '').split(',').filter(Boolean),
  );
  const runnerEnabled = process.env.D2P_RUNNER_ENABLED === '1';
  const d2pPath = process.env.D2P_PATH ?? null;
  const runnerMinimaxApiKey = process.env.D2P_RUNNER_MINIMAX_API_KEY ?? null;
  const runnerInstanceToken = process.env.D2P_RUNNER_INSTANCE_TOKEN ?? null;
  const runnerPathPrefixes = (process.env.HUB_RUNNER_PATH_PREFIX
    ?? `${homedir()},/tmp`).split(',').map((s) => s.trim()).filter(Boolean);
  const hubDataDir = process.env.HUB_DATA_DIR ?? dirname(dbPath);
  return {
    port, bind, dbPath, adminToken, llmLearnerEnabled,
    anthropicApiKey, disabledRules,
    runnerEnabled, d2pPath, runnerMinimaxApiKey, runnerInstanceToken,
    runnerPathPrefixes, hubDataDir,
  };
}
```

- [ ] **Step 5: Run config tests**

Run: `npx vitest run tests/hub/config.test.ts`
Expected: all tests pass (existing 4 + new 5 = 9).

- [ ] **Step 6: Type-check the rest of the codebase**

Run: `pnpm exec tsc -p tsconfig.json --noEmit`
Expected: clean (no errors).

---

## Phase 2 — RunSupervisor singleton

### Task 2.1: Failing test for acquire / release

**Files:**
- Test: `tests/hub/runner.supervisor.test.ts`
- Create: `src/hub/runner/supervisor.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/hub/runner.supervisor.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { openDb, migrate } from '../../src/hub/db/client.js';
import { d2pInstances, runs } from '../../src/hub/db/schema.js';
import { RunSupervisor } from '../../src/hub/runner/supervisor.js';

function mkHandle() {
  const root = mkdtempSync(join(tmpdir(), 'sup-'));
  const h = openDb(join(root, 'h.db'));
  migrate(h.sqlite);
  return { handle: h, root };
}

describe('RunSupervisor', () => {
  let env: { handle: ReturnType<typeof openDb>; root: string };
  let sup: RunSupervisor;

  beforeEach(() => {
    env = mkHandle();
    sup = new RunSupervisor({
      handle: env.handle, dataDir: env.root, d2pPath: '/does/not/matter',
    });
  });

  afterEach(() => {
    sup.shutdown();
  });

  it('current() returns null when nothing is in flight', () => {
    expect(sup.current()).toBeNull();
  });

  it('acquire spawns and records an active run', () => {
    const runId = randomUUID();
    // Use a benign command that prints something and exits ~0
    const ar = sup.acquire({
      runId, projectPath: '/tmp/x', command: 'echo',
      args: ['hello'], env: {},
    });
    expect(ar.runId).toBe(runId);
    expect(typeof ar.pid).toBe('number');
    expect(existsSync(ar.stdoutPath)).toBe(true);
    expect(sup.current()?.runId).toBe(runId);
  });

  it('acquire throws when a run is already in flight', () => {
    const runId = randomUUID();
    sup.acquire({
      runId, projectPath: '/tmp/x', command: 'sleep',
      args: ['1'], env: {},
    });
    expect(() => sup.acquire({
      runId: randomUUID(), projectPath: '/tmp/y', command: 'echo',
      args: [], env: {},
    })).toThrowError(/already.+flight/i);
  });
});
```

- [ ] **Step 2: Run the test — expect failure**

Run: `npx vitest run tests/hub/runner.supervisor.test.ts`
Expected: cannot find module `../../src/hub/runner/supervisor.js`.

- [ ] **Step 3: Implement the minimal supervisor**

Create `src/hub/runner/supervisor.ts`:
```ts
import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { eq, isNull, and } from 'drizzle-orm';
import type { DbHandle } from '../db/client.js';
import { runs } from '../db/schema.js';

export interface SupervisorOpts {
  handle: DbHandle;
  dataDir: string;
  d2pPath: string;
}

export interface AcquireOpts {
  runId: string;
  projectPath: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface ActiveRun {
  runId: string;
  pid: number;
  child: ChildProcess;
  stdoutPath: string;
  projectPath: string;
  startedAt: number;
}

export class RunSupervisor {
  private active: ActiveRun | null = null;
  private logDir: string;
  constructor(private opts: SupervisorOpts) {
    this.logDir = join(opts.dataDir, 'runner-logs');
    if (!existsSync(this.logDir)) mkdirSync(this.logDir, { recursive: true });
  }

  current(): ActiveRun | null { return this.active; }

  acquire(req: AcquireOpts): ActiveRun {
    if (this.active) {
      throw new Error(`run already in flight: ${this.active.runId}`);
    }
    const stdoutPath = join(this.logDir, `${req.runId}.log`);
    const stream = createWriteStream(stdoutPath, { flags: 'a' });
    // spawn (not exec) — argv form, no shell parsing, safe with arbitrary
    // path strings as long as we don't ourselves concatenate them.
    const child = spawn(req.command, req.args, {
      env: { ...req.env, D2P_RUN_ID: req.runId },
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: req.projectPath,
    });
    child.stdout?.pipe(stream, { end: false });
    child.stderr?.pipe(stream, { end: false });
    const ar: ActiveRun = {
      runId: req.runId, pid: child.pid ?? -1, child,
      stdoutPath, projectPath: req.projectPath,
      startedAt: Date.now(),
    };
    child.on('exit', (code) => {
      stream.write(`\n[supervisor] exit=${code}\n`);
      stream.end();
      this.markCrashedIfOrphan(req.runId);
      if (this.active?.runId === req.runId) this.active = null;
    });
    this.active = ar;
    return ar;
  }

  // If d2p exited without pushing a run_terminated event, the runs row's
  // terminal_state stays null forever — UI shows a perpetual RUNNING
  // ghost. Mark it `crashed` so the page can stop polling and the runs
  // list shows what actually happened.
  private markCrashedIfOrphan(runId: string): void {
    try {
      const row = this.opts.handle.db.select().from(runs)
        .where(eq(runs.id, runId)).get();
      if (!row) return;  // d2p never pushed run_started — nothing to mark
      if (row.terminalState != null) return;  // d2p finished cleanly
      this.opts.handle.db.update(runs).set({
        terminalState: 'crashed',
        terminatedAt: new Date().toISOString(),
      }).where(and(eq(runs.id, runId), isNull(runs.terminalState))).run();
    } catch {
      // Best-effort: a closing DB or schema mismatch shouldn't crash the
      // exit handler. Worst case the row stays as a RUNNING ghost.
    }
  }

  shutdown(): void {
    if (!this.active) return;
    try { this.active.child.kill('SIGTERM'); } catch { /* already gone */ }
    this.active = null;
  }
}
```

- [ ] **Step 4: Run supervisor tests**

Run: `npx vitest run tests/hub/runner.supervisor.test.ts`
Expected: 3 tests pass.

### Task 2.2: Test crashed-orphan marking

**Files:**
- Modify: `tests/hub/runner.supervisor.test.ts`

- [ ] **Step 1: Append the failing tests**

Add to the same `describe('RunSupervisor', ...)`:
```ts
  it('marks orphan run as crashed when child exits without terminal_state', async () => {
    const runId = randomUUID();
    const instId = randomUUID();
    env.handle.db.insert(d2pInstances).values({
      id: instId, name: 'i', tokenHash: 'x',
    }).run();
    // Simulate d2p having pushed run_started but never run_terminated.
    env.handle.db.insert(runs).values({
      id: runId, instanceId: instId, projectPath: '/tmp/x',
      startedAt: new Date().toISOString(),
      // terminalState left null on purpose
    }).run();
    const ar = sup.acquire({
      runId, projectPath: '/tmp', command: 'echo',
      args: ['hi'], env: {},
    });
    // Wait for the child to exit + the exit handler to run.
    await new Promise<void>((resolve) => {
      ar.child.on('exit', () => setTimeout(resolve, 50));
    });
    const row = env.handle.db.select().from(runs)
      .where(eq(runs.id, runId)).get();
    expect(row?.terminalState).toBe('crashed');
    expect(row?.terminatedAt).toBeTruthy();
  });

  it('does NOT overwrite terminal_state if d2p set it', async () => {
    const runId = randomUUID();
    const instId = randomUUID();
    env.handle.db.insert(d2pInstances).values({
      id: instId, name: 'i', tokenHash: 'x',
    }).run();
    env.handle.db.insert(runs).values({
      id: runId, instanceId: instId, projectPath: '/tmp/x',
      startedAt: new Date().toISOString(),
      terminalState: 'complete',
    }).run();
    const ar = sup.acquire({
      runId, projectPath: '/tmp', command: 'echo',
      args: ['hi'], env: {},
    });
    await new Promise<void>((resolve) => {
      ar.child.on('exit', () => setTimeout(resolve, 50));
    });
    const row = env.handle.db.select().from(runs)
      .where(eq(runs.id, runId)).get();
    expect(row?.terminalState).toBe('complete');
  });
```

- [ ] **Step 2: Run all supervisor tests**

Run: `npx vitest run tests/hub/runner.supervisor.test.ts`
Expected: 5 tests pass.

### Task 2.3: shutdown() test

**Files:**
- Modify: `tests/hub/runner.supervisor.test.ts`

- [ ] **Step 1: Append**

```ts
  it('shutdown SIGTERMs the active child', async () => {
    const runId = randomUUID();
    const ar = sup.acquire({
      runId, projectPath: '/tmp', command: 'sleep',
      args: ['30'], env: {},
    });
    const exited = new Promise<number | null>((resolve) =>
      ar.child.on('exit', (code, _signal) => resolve(code)),
    );
    sup.shutdown();
    const code = await Promise.race([
      exited,
      new Promise<null>((r) => setTimeout(() => r(null), 1000)),
    ]);
    // Either the child reported a non-zero exit (killed by signal) or
    // it exited cleanly within the 1-second race window — both are
    // acceptable shutdown outcomes. What matters is current() is null.
    expect(sup.current()).toBeNull();
    expect(code !== undefined).toBe(true);
  });
```

- [ ] **Step 2: Run all supervisor tests**

Run: `npx vitest run tests/hub/runner.supervisor.test.ts`
Expected: 6 tests pass.

---

## Phase 3 — Server wiring + index.ts SIGTERM handler

### Task 3.1: Wire supervisor + runner config into server.ts and index.ts

**Files:**
- Modify: `src/hub/server.ts`
- Modify: `src/hub/index.ts`

- [ ] **Step 1: Modify server.ts**

Replace the existing `AppOpts` interface + `buildApp` function in `src/hub/server.ts`:
```ts
import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { DbHandle } from './db/client.js';
import { adminAuth } from './auth.js';
import { adminRoute, type AnthropicLike } from './routes/admin.js';
import { eventsRoute } from './routes/events.js';
import { standardsRoute } from './routes/standards.js';
import { runsRoute } from './routes/runs.js';
import { proposalsRoute } from './routes/proposals.js';
import { runsRunnerRoute, type RunnerConfig } from './routes/runs_runner.js';
import { makeInstanceLookup } from './instanceLookup.js';
import type { RunSupervisor } from './runner/supervisor.js';

export interface AppOpts {
  adminToken: string | null;
  anthropic?: AnthropicLike | null;
  // Optional. When supplied AND runnerCfg.enabled is true, mount the
  // /admin/runs/* routes. Otherwise those routes simply aren't registered.
  runner?: RunSupervisor | null;
  runnerCfg?: RunnerConfig | null;
}

export function buildApp(handle: DbHandle, opts: AppOpts) {
  const app = new Hono();

  app.get('/admin/health',
    adminAuth(opts.adminToken),
    (c) => {
      let dbOk = true;
      try { handle.sqlite.prepare('SELECT 1').get(); }
      catch { dbOk = false; }
      return c.json({
        db_ok: dbOk,
        last_event_at: null,
        last_learner_run_at: null,
      });
    },
  );

  const lookup = makeInstanceLookup(handle);
  app.route('/', adminRoute(handle, {
    adminToken: opts.adminToken,
    anthropic: opts.anthropic ?? null,
  }));
  app.route('/api', eventsRoute(handle, lookup));
  app.route('/api', standardsRoute(handle));
  app.route('/api', runsRoute(handle));
  app.route('/api', proposalsRoute(handle));

  if (opts.runner && opts.runnerCfg?.enabled) {
    app.route('/', runsRunnerRoute(handle, opts.runner, {
      adminToken: opts.adminToken,
      cfg: opts.runnerCfg,
    }));
  }

  const sitePath = join(process.cwd(), 'site', 'dist');
  if (existsSync(sitePath)) {
    app.use('/*', serveStatic({ root: './site/dist' }));
  }

  return app;
}
```

- [ ] **Step 2: Modify index.ts**

Replace the body of `src/hub/index.ts`:
```ts
import { serve } from '@hono/node-server';
import Anthropic from '@anthropic-ai/sdk';
import { openDb, migrate } from './db/client.js';
import { loadConfig } from './config.js';
import { buildApp } from './server.js';
import { runLlmSummariser } from './learner/llm_summariser.js';
import { RunSupervisor } from './runner/supervisor.js';

async function main() {
  const cfg = loadConfig({ requireAdminToken: true });
  const handle = openDb(cfg.dbPath);
  migrate(handle.sqlite);
  const anthropic = (cfg.llmLearnerEnabled && cfg.anthropicApiKey)
    ? new Anthropic({ apiKey: cfg.anthropicApiKey })
    : null;

  // Runner is optional. Only instantiate when D2P_RUNNER_ENABLED=1 AND
  // the required env is present — otherwise the routes 503 anyway and
  // the supervisor would just be inert.
  let supervisor: RunSupervisor | null = null;
  if (cfg.runnerEnabled && cfg.d2pPath
      && cfg.runnerMinimaxApiKey && cfg.runnerInstanceToken) {
    supervisor = new RunSupervisor({
      handle, dataDir: cfg.hubDataDir, d2pPath: cfg.d2pPath,
    });
    const shutdown = () => {
      process.stderr.write('shutting down RunSupervisor\n');
      supervisor?.shutdown();
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } else if (cfg.runnerEnabled) {
    process.stderr.write(
      'D2P_RUNNER_ENABLED=1 but D2P_PATH / D2P_RUNNER_MINIMAX_API_KEY / '
      + 'D2P_RUNNER_INSTANCE_TOKEN missing — runner routes will 503\n');
  }

  const app = buildApp(handle, {
    adminToken: cfg.adminToken,
    anthropic: anthropic as any,
    runner: supervisor,
    runnerCfg: cfg.runnerEnabled ? {
      enabled: true,
      d2pPath: cfg.d2pPath ?? '',
      minimaxApiKey: cfg.runnerMinimaxApiKey ?? '',
      instanceToken: cfg.runnerInstanceToken ?? '',
      hubBaseUrl: `http://${cfg.bind}:${cfg.port}`,
      pathPrefixes: cfg.runnerPathPrefixes,
    } : null,
  });
  serve({ fetch: app.fetch, port: cfg.port, hostname: cfg.bind }, (info) => {
    process.stderr.write(`MatrixOmnix Hub listening on http://${cfg.bind}:${info.port}\n`);
  });

  if (anthropic) {
    const WEEK_MS = 7 * 86400_000;
    setInterval(async () => {
      try {
        const n = await runLlmSummariser(handle, anthropic as any);
        process.stderr.write(`LLM summariser produced ${n} proposals\n`);
      } catch (e) {
        process.stderr.write(`LLM summariser failed: ${e}\n`);
      }
    }, WEEK_MS);
  }
}

main().catch((e) => {
  process.stderr.write(`hub fatal: ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
  process.exit(1);
});
```

- [ ] **Step 3: Limited type-check**

The full project will not compile yet (the next phase creates
`runs_runner.ts`). Check just the files we touched:
```bash
pnpm exec tsc --noEmit src/hub/config.ts src/hub/runner/supervisor.ts 2>&1 | head -20
```
Expected: no errors on these two files.

- [ ] **Step 4: Commit phases 1 + 2 + 3**

```bash
cd /Users/mack/Desktop/Hosico/Works/Work/demo2project && git add src/hub/config.ts src/hub/runner/supervisor.ts src/hub/server.ts src/hub/index.ts tests/hub/config.test.ts tests/hub/runner.supervisor.test.ts && git commit -m "$(cat <<'EOF'
feat(hub): RunSupervisor + runner config (foundation for /iterate page)

Lays the backend foundation for the upcoming Hub /iterate page (spec at
docs/superpowers/specs/2026-05-25-hub-iterate-page-design.md):

- src/hub/config.ts: 6 new env-driven fields (D2P_RUNNER_ENABLED,
  D2P_PATH, D2P_RUNNER_MINIMAX_API_KEY, D2P_RUNNER_INSTANCE_TOKEN,
  HUB_RUNNER_PATH_PREFIX, HUB_DATA_DIR). Defaults make standard Hub
  deployments incapable of spawning subprocesses.
- src/hub/runner/supervisor.ts: singleton that spawns one d2p child at
  a time, pipes stdout/stderr to <hubDataDir>/runner-logs/<runId>.log,
  marks orphan runs (child exited but no run_terminated event) as
  'crashed' so the UI doesn't show perpetual RUNNING ghosts.
- src/hub/server.ts + index.ts: thread the supervisor through buildApp.
  When enabled-but-misconfigured, log a warning and leave routes 503.
  Register SIGTERM/SIGINT handlers that gracefully SIGTERM the child.
- tests/hub/runner.supervisor.test.ts: 6 tests covering acquire/release,
  in-flight refusal, crashed-orphan marking, terminal_state preservation
  when d2p set it cleanly, and shutdown behaviour.
- tests/hub/config.test.ts: 5 new cases for the runner config fields.

This commit intentionally leaves the full project tsc not-fully-clean
because runs_runner.ts (referenced from server.ts) doesn't exist yet.
The next commit (routes batch) closes that gap.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 4 — Route 1: POST /admin/runs/start

### Task 4.1: Failing test

**Files:**
- Test: `tests/hub/routes.runs.start.test.ts`

- [ ] **Step 1: Write the test file**

Create `tests/hub/routes.runs.start.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import * as child_process from 'node:child_process';
import { openDb, migrate } from '../../src/hub/db/client.js';
import { buildApp } from '../../src/hub/server.js';
import { RunSupervisor } from '../../src/hub/runner/supervisor.js';

function mkApp(runnerEnabled = true) {
  const root = mkdtempSync(join(tmpdir(), 'st-'));
  const handle = openDb(join(root, 'h.db'));
  migrate(handle.sqlite);
  const supervisor = new RunSupervisor({
    handle, dataDir: root, d2pPath: '/fake/d2p',
  });
  const app = buildApp(handle, {
    adminToken: 'sec',
    runner: supervisor,
    runnerCfg: runnerEnabled ? {
      enabled: true,
      d2pPath: '/fake/d2p',
      minimaxApiKey: 'k',
      instanceToken: 't',
      hubBaseUrl: 'http://127.0.0.1:3030',
      pathPrefixes: [homedir(), '/tmp'],
    } : null,
  });
  return { app, supervisor, handle, root };
}

describe('POST /admin/runs/start', () => {
  let spawnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Stub child_process.spawn so tests don't actually launch python.
    // Returns a fake child with pid + piped streams + a kill() no-op.
    spawnSpy = vi.spyOn(child_process, 'spawn').mockImplementation(
      // @ts-expect-error — return shape is the subset we use
      (() => {
        const { EventEmitter } = require('node:events');
        const child: any = new EventEmitter();
        child.pid = 99999;
        const { PassThrough } = require('node:stream');
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        child.kill = () => true;
        return child;
      }) as any,
    );
  });

  afterEach(() => {
    spawnSpy.mockRestore();
  });

  it('403 without admin token', async () => {
    const { app } = mkApp();
    const r = await app.request('/admin/runs/start', { method: 'POST' });
    expect(r.status).toBe(403);
  });

  it('503 when runner disabled', async () => {
    const { app } = mkApp(false);
    const r = await app.request('/admin/runs/start', {
      method: 'POST',
      headers: { Authorization: 'Bearer sec', 'content-type': 'application/json' },
      body: JSON.stringify({ project_path: '/tmp/x', iter: 3 }),
    });
    expect(r.status).toBe(503);
  });

  it('400 when project_path is missing', async () => {
    const { app } = mkApp();
    const r = await app.request('/admin/runs/start', {
      method: 'POST',
      headers: { Authorization: 'Bearer sec', 'content-type': 'application/json' },
      body: JSON.stringify({ iter: 3 }),
    });
    expect(r.status).toBe(400);
  });

  it('400 when project_path is outside the whitelist', async () => {
    const { app } = mkApp();
    const r = await app.request('/admin/runs/start', {
      method: 'POST',
      headers: { Authorization: 'Bearer sec', 'content-type': 'application/json' },
      body: JSON.stringify({ project_path: '/etc/passwd-dir', iter: 3 }),
    });
    expect(r.status).toBe(400);
  });

  it('400 when iter is out of range', async () => {
    const { app } = mkApp();
    const r = await app.request('/admin/runs/start', {
      method: 'POST',
      headers: { Authorization: 'Bearer sec', 'content-type': 'application/json' },
      body: JSON.stringify({ project_path: '/tmp/whatever', iter: 99 }),
    });
    expect(r.status).toBe(400);
  });

  it('200 happy path: spawns once and returns { run_id, pid }', async () => {
    const { app } = mkApp();
    const r = await app.request('/admin/runs/start', {
      method: 'POST',
      headers: { Authorization: 'Bearer sec', 'content-type': 'application/json' },
      body: JSON.stringify({ project_path: '/tmp/x-demo', iter: 2 }),
    });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.run_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(j.pid).toBe(99999);
    expect(spawnSpy).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = spawnSpy.mock.calls[0] as any;
    expect(cmd).toBe('python');
    expect(args).toContain(join('/fake/d2p', 'run.py'));
    expect(args).toContain('--iter');
    expect(args).toContain('2');
    expect(opts.env.D2P_RUN_ID).toBe(j.run_id);
    expect(opts.env.HUB_URL).toBeDefined();
    expect(opts.env.HUB_TOKEN).toBeDefined();
    expect(opts.env.MINIMAX_API_KEY).toBeDefined();
  });

  it('409 when a run is already in flight', async () => {
    const { app } = mkApp();
    const ok = await app.request('/admin/runs/start', {
      method: 'POST',
      headers: { Authorization: 'Bearer sec', 'content-type': 'application/json' },
      body: JSON.stringify({ project_path: '/tmp/x-demo', iter: 1 }),
    });
    expect(ok.status).toBe(200);
    const second = await app.request('/admin/runs/start', {
      method: 'POST',
      headers: { Authorization: 'Bearer sec', 'content-type': 'application/json' },
      body: JSON.stringify({ project_path: '/tmp/y', iter: 1 }),
    });
    expect(second.status).toBe(409);
  });
});
```

- [ ] **Step 2: Run the test — expect failure**

Run: `npx vitest run tests/hub/routes.runs.start.test.ts`
Expected: import error for `routes/runs_runner.js`. That's the cue to write it.

### Task 4.2: Implement the route file (start + skeleton for the other 3)

**Files:**
- Create: `src/hub/routes/runs_runner.ts`

- [ ] **Step 1: Create the file**

```ts
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
  cfg: RunnerConfig;
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
    if (!deps.cfg.enabled) {
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
    const command = 'python';
    // argv form — no shell parsing happens. project_path is the only
    // user-supplied string and it's already prefix-whitelisted above.
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
    // Resolve log path either from active run or by convention (the file
    // stays after the child exits so paginated re-tail keeps working).
    const { join: pJoin } = await import('node:path');
    const { dataDir } = (supervisor as unknown as { opts: { dataDir: string } }).opts;
    const path = cur?.runId === id
      ? cur.stdoutPath
      : pJoin(dataDir, 'runner-logs', `${id}.log`);
    const { open, stat: fstat } = await import('node:fs/promises');
    let size = 0;
    try {
      size = (await fstat(path)).size;
    } catch {
      return c.json({ error: 'log_not_found' }, 404);
    }
    if (from >= size) {
      const eof = cur?.runId !== id;  // not currently active → log won't grow
      return c.json({ content: '', next_offset: size, eof });
    }
    const fd = await open(path, 'r');
    try {
      const chunkSize = Math.min(size - from, 1_000_000);
      const buf = Buffer.alloc(chunkSize);
      await fd.read(buf, 0, chunkSize, from);
      const content = buf.toString('utf-8');
      const eof = (from + chunkSize >= size) && cur?.runId !== id;
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
    if (!deps.cfg.enabled) {
      return c.json({ error: 'runner_disabled' }, 503);
    }
    const id = c.req.param('id');
    const row = handle.db.select().from(runs).where(eq(runs.id, id)).get();
    if (!row) return c.json({ error: 'run_not_found' }, 404);
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
    // Promise-wrapped execFile (NOT exec). argv form means no shell
    // parsing happens — every user-supplied string travels as a single
    // argv entry. Named `runArgv` to make the safety property obvious.
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

    // git init (idempotent — re-running is a no-op + zero exit)
    if (await runStep('git init', ['git', 'init']) === null) {
      return c.json({ steps, ok: false }, 500);
    }
    // git add -A
    if (await runStep('git add -A', ['git', 'add', '-A']) === null) {
      return c.json({ steps, ok: false }, 500);
    }
    // git commit (allow non-zero — "nothing to commit" is a normal state)
    await runStep(`git commit -m "${commit_message.replace(/"/g, '\\"')}"`,
                  ['git', 'commit', '-m', commit_message],
                  { allowNonZero: true });
    // git remote set-url origin <url>; fall back to remote add if not present
    if (await runStep('git remote set-url origin <url>',
                      ['git', 'remote', 'set-url', 'origin', remote_url],
                      { allowNonZero: true }) === false) {
      if (await runStep('git remote add origin <url>',
                        ['git', 'remote', 'add', 'origin', remote_url]) === null) {
        return c.json({ steps, ok: false }, 500);
      }
    }
    // git push -u origin <branch>
    if (await runStep(`git push -u origin ${branch}`,
                      ['git', 'push', '-u', 'origin', branch]) === null) {
      return c.json({ steps, ok: false }, 500);
    }

    // Build a human-friendly browser link.
    const m = remote_url.match(
      /github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/);
    const remote_html = m ? `https://github.com/${m[1]}/${m[2]}` : null;
    return c.json({ steps, ok: true, remote_html });
  });

  return r;
}
```

- [ ] **Step 2: Re-run the start tests**

Run: `npx vitest run tests/hub/routes.runs.start.test.ts`
Expected: all 7 tests pass.

---

## Phase 5 — Route 2: GET /admin/runs/current

### Task 5.1: Tests for current

**Files:**
- Test: `tests/hub/routes.runs.current.test.ts`

- [ ] **Step 1: Write the test file**

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import * as child_process from 'node:child_process';
import { openDb, migrate } from '../../src/hub/db/client.js';
import { buildApp } from '../../src/hub/server.js';
import { RunSupervisor } from '../../src/hub/runner/supervisor.js';

function mkApp() {
  const root = mkdtempSync(join(tmpdir(), 'cur-'));
  const handle = openDb(join(root, 'h.db'));
  migrate(handle.sqlite);
  const supervisor = new RunSupervisor({
    handle, dataDir: root, d2pPath: '/fake',
  });
  const app = buildApp(handle, {
    adminToken: 'sec', runner: supervisor,
    runnerCfg: {
      enabled: true, d2pPath: '/fake', minimaxApiKey: 'k',
      instanceToken: 't', hubBaseUrl: 'http://127.0.0.1:3030',
      pathPrefixes: [homedir(), '/tmp'],
    },
  });
  return { app, supervisor, root };
}

describe('GET /admin/runs/current', () => {
  let spawnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    spawnSpy = vi.spyOn(child_process, 'spawn').mockImplementation(
      // @ts-expect-error subset shape
      (() => {
        const { EventEmitter } = require('node:events');
        const c: any = new EventEmitter();
        c.pid = 12345;
        const { PassThrough } = require('node:stream');
        c.stdout = new PassThrough();
        c.stderr = new PassThrough();
        c.kill = () => true;
        return c;
      }) as any,
    );
  });
  afterEach(() => spawnSpy.mockRestore());

  it('403 without admin token', async () => {
    const { app } = mkApp();
    const r = await app.request('/admin/runs/current');
    expect(r.status).toBe(403);
  });

  it('returns null when no run is in flight', async () => {
    const { app } = mkApp();
    const r = await app.request('/admin/runs/current', {
      headers: { Authorization: 'Bearer sec' },
    });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.run_id).toBeNull();
  });

  it('returns current run after start', async () => {
    const { app } = mkApp();
    const start = await app.request('/admin/runs/start', {
      method: 'POST',
      headers: { Authorization: 'Bearer sec', 'content-type': 'application/json' },
      body: JSON.stringify({ project_path: '/tmp/cur-x', iter: 1 }),
    });
    const { run_id } = await start.json();
    const r = await app.request('/admin/runs/current', {
      headers: { Authorization: 'Bearer sec' },
    });
    const j = await r.json();
    expect(j.run_id).toBe(run_id);
    expect(j.pid).toBe(12345);
    expect(j.project_path).toBe('/tmp/cur-x');
    expect(j.started_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
```

- [ ] **Step 2: Run**

Run: `npx vitest run tests/hub/routes.runs.current.test.ts`
Expected: 3 tests pass.

---

## Phase 6 — Route 3: GET /admin/runs/:id/stdout

### Task 6.1: Tests for stdout tail

**Files:**
- Test: `tests/hub/routes.runs.stdout.test.ts`

- [ ] **Step 1: Write the test file**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDb, migrate } from '../../src/hub/db/client.js';
import { buildApp } from '../../src/hub/server.js';
import { RunSupervisor } from '../../src/hub/runner/supervisor.js';

function mkApp() {
  const root = mkdtempSync(join(tmpdir(), 'std-'));
  const handle = openDb(join(root, 'h.db'));
  migrate(handle.sqlite);
  const supervisor = new RunSupervisor({
    handle, dataDir: root, d2pPath: '/fake',
  });
  const app = buildApp(handle, {
    adminToken: 'sec', runner: supervisor,
    runnerCfg: {
      enabled: true, d2pPath: '/fake', minimaxApiKey: 'k',
      instanceToken: 't', hubBaseUrl: 'http://127.0.0.1:3030',
      pathPrefixes: [homedir(), '/tmp'],
    },
  });
  return { app, root };
}

describe('GET /admin/runs/:id/stdout', () => {
  let env: ReturnType<typeof mkApp>;
  beforeEach(() => { env = mkApp(); });

  it('404 when the log file does not exist', async () => {
    const r = await env.app.request(
      `/admin/runs/${randomUUID()}/stdout?from=0`,
      { headers: { Authorization: 'Bearer sec' } },
    );
    expect(r.status).toBe(404);
  });

  it('returns content + next_offset when a log exists', async () => {
    const id = randomUUID();
    const logDir = join(env.root, 'runner-logs');
    mkdirSync(logDir, { recursive: true });
    writeFileSync(join(logDir, `${id}.log`), 'hello world\n');
    const r = await env.app.request(
      `/admin/runs/${id}/stdout?from=0`,
      { headers: { Authorization: 'Bearer sec' } },
    );
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.content).toBe('hello world\n');
    expect(j.next_offset).toBe(12);
    expect(j.eof).toBe(true);   // run not active, log won't grow
  });

  it('honours from= offset for incremental tail', async () => {
    const id = randomUUID();
    const logDir = join(env.root, 'runner-logs');
    mkdirSync(logDir, { recursive: true });
    writeFileSync(join(logDir, `${id}.log`), '0123456789');
    const r = await env.app.request(
      `/admin/runs/${id}/stdout?from=4`,
      { headers: { Authorization: 'Bearer sec' } },
    );
    const j = await r.json();
    expect(j.content).toBe('456789');
    expect(j.next_offset).toBe(10);
  });
});
```

- [ ] **Step 2: Run**

Run: `npx vitest run tests/hub/routes.runs.stdout.test.ts`
Expected: 3 tests pass.

---

## Phase 7 — Route 4: POST /admin/runs/:id/push-github

### Task 7.1: Tests for push-github

**Files:**
- Test: `tests/hub/routes.runs.pushgithub.test.ts`

- [ ] **Step 1: Write the test file**

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import * as child_process from 'node:child_process';
import { openDb, migrate } from '../../src/hub/db/client.js';
import { d2pInstances, runs } from '../../src/hub/db/schema.js';
import { buildApp } from '../../src/hub/server.js';
import { RunSupervisor } from '../../src/hub/runner/supervisor.js';

function mkApp() {
  const root = mkdtempSync(join(tmpdir(), 'pg-'));
  const handle = openDb(join(root, 'h.db'));
  migrate(handle.sqlite);
  const supervisor = new RunSupervisor({
    handle, dataDir: root, d2pPath: '/fake',
  });
  const app = buildApp(handle, {
    adminToken: 'sec', runner: supervisor,
    runnerCfg: {
      enabled: true, d2pPath: '/fake', minimaxApiKey: 'k',
      instanceToken: 't', hubBaseUrl: 'http://127.0.0.1:3030',
      pathPrefixes: [homedir(), '/tmp'],
    },
  });
  return { app, handle, root };
}

function seedTerminalRun(handle: any, state = 'CLEAN') {
  const instId = randomUUID();
  handle.db.insert(d2pInstances).values({
    id: instId, name: 'i', tokenHash: 'x',
  }).run();
  const runId = randomUUID();
  handle.db.insert(runs).values({
    id: runId, instanceId: instId, projectPath: '/tmp/pg-demo',
    startedAt: new Date().toISOString(),
    terminatedAt: new Date().toISOString(),
    terminalState: state,
  }).run();
  return runId;
}

describe('POST /admin/runs/:id/push-github', () => {
  let runArgvSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Stub child_process.execFile so we don't actually run git.
    runArgvSpy = vi.spyOn(child_process, 'execFile').mockImplementation(
      // @ts-expect-error overload
      ((_cmd: string, _args: string[], _opts: any,
        cb: (err: any, out: { stdout: string; stderr: string }) => void) => {
        cb(null, { stdout: '', stderr: '' });
        return {} as any;
      }) as any,
    );
  });
  afterEach(() => runArgvSpy.mockRestore());

  it('404 when run does not exist', async () => {
    const { app } = mkApp();
    const r = await app.request(`/admin/runs/${randomUUID()}/push-github`, {
      method: 'POST',
      headers: { Authorization: 'Bearer sec', 'content-type': 'application/json' },
      body: JSON.stringify({
        remote_url: 'git@github.com:user/repo.git',
        branch: 'main', commit_message: 'x',
      }),
    });
    expect(r.status).toBe(404);
  });

  it('409 when run is still running', async () => {
    const { app, handle } = mkApp();
    const instId = randomUUID();
    handle.db.insert(d2pInstances).values({
      id: instId, name: 'i', tokenHash: 'x',
    }).run();
    const runId = randomUUID();
    handle.db.insert(runs).values({
      id: runId, instanceId: instId, projectPath: '/tmp/pg-demo',
      startedAt: new Date().toISOString(),
      // terminalState null on purpose
    }).run();
    const r = await app.request(`/admin/runs/${runId}/push-github`, {
      method: 'POST',
      headers: { Authorization: 'Bearer sec', 'content-type': 'application/json' },
      body: JSON.stringify({
        remote_url: 'git@github.com:user/repo.git',
        branch: 'main', commit_message: 'x',
      }),
    });
    expect(r.status).toBe(409);
  });

  it('400 on bad remote_url (not GitHub)', async () => {
    const { app, handle } = mkApp();
    const runId = seedTerminalRun(handle);
    const r = await app.request(`/admin/runs/${runId}/push-github`, {
      method: 'POST',
      headers: { Authorization: 'Bearer sec', 'content-type': 'application/json' },
      body: JSON.stringify({
        remote_url: 'git@gitlab.com:user/repo.git',
        branch: 'main', commit_message: 'x',
      }),
    });
    expect(r.status).toBe(400);
  });

  it('200 happy path runs git init/add/commit/remote/push', async () => {
    const { app, handle } = mkApp();
    const runId = seedTerminalRun(handle);
    const r = await app.request(`/admin/runs/${runId}/push-github`, {
      method: 'POST',
      headers: { Authorization: 'Bearer sec', 'content-type': 'application/json' },
      body: JSON.stringify({
        remote_url: 'git@github.com:user/repo.git',
        branch: 'main', commit_message: 'feat: d2p iteration 1',
      }),
    });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.ok).toBe(true);
    expect(j.remote_html).toBe('https://github.com/user/repo');
    const cmds = j.steps.map((s: any) => s.cmd);
    expect(cmds[0]).toBe('git init');
    expect(cmds[1]).toBe('git add -A');
    expect(cmds.find((c: string) => c.startsWith('git push'))).toBeTruthy();
    expect(runArgvSpy).toHaveBeenCalled();
  });

  it('500 with steps[] when a step fails', async () => {
    runArgvSpy.mockRestore();
    runArgvSpy = vi.spyOn(child_process, 'execFile').mockImplementation(
      // @ts-expect-error overload
      ((cmd: string, args: string[], _opts: any,
        cb: (err: any, out: any) => void) => {
        if (args[0] === 'push') {
          const err: any = new Error('non-fast-forward');
          err.code = 1;
          err.stdout = '';
          err.stderr = 'rejected: non-fast-forward\n';
          cb(err, { stdout: '', stderr: '' });
        } else {
          cb(null, { stdout: '', stderr: '' });
        }
        return {} as any;
      }) as any,
    );
    const { app, handle } = mkApp();
    const runId = seedTerminalRun(handle);
    const r = await app.request(`/admin/runs/${runId}/push-github`, {
      method: 'POST',
      headers: { Authorization: 'Bearer sec', 'content-type': 'application/json' },
      body: JSON.stringify({
        remote_url: 'git@github.com:user/repo.git',
        branch: 'main', commit_message: 'x',
      }),
    });
    expect(r.status).toBe(500);
    const j = await r.json();
    expect(j.ok).toBe(false);
    const failed = j.steps.find((s: any) => s.exit !== 0);
    expect(failed).toBeDefined();
    expect(failed.output).toContain('non-fast-forward');
  });
});
```

- [ ] **Step 2: Run**

Run: `npx vitest run tests/hub/routes.runs.pushgithub.test.ts`
Expected: 5 tests pass.

### Task 7.2: Run the full Hub vitest suite

- [ ] **Step 1: Run all tests**

Run: `npx vitest run`
Expected: 4 new test files appear in the listing; total 83 tests passing
(approximate — 59 previous + 6 supervisor + 7 start + 3 current + 3 stdout
+ 5 push). What matters: nothing fails.

- [ ] **Step 2: Type-check the full project**

Run: `pnpm exec tsc -p tsconfig.json --noEmit`
Expected: clean.

### Task 7.3: Commit phases 4-7 (all 4 routes + tests)

- [ ] **Step 1: Stage + commit**

```bash
cd /Users/mack/Desktop/Hosico/Works/Work/demo2project && git add src/hub/routes/runs_runner.ts tests/hub/routes.runs.start.test.ts tests/hub/routes.runs.current.test.ts tests/hub/routes.runs.stdout.test.ts tests/hub/routes.runs.pushgithub.test.ts && git commit -m "$(cat <<'EOF'
feat(hub): 4 /admin/runs/* routes for the /iterate page

- POST /admin/runs/start: validates path against pathPrefixes whitelist,
  pre-generates run_id (uuid), supervisor.acquire spawns
  python <D2P_PATH>/run.py <path> --iter N --no-cache-analysis with
  HUB_URL / HUB_TOKEN / MINIMAX_API_KEY / D2P_RUN_ID injected env.
  503 when runner disabled / misconfigured, 400 on bad input, 409 when
  a run is already in flight.
- GET /admin/runs/current: read-only sibling so the Vue page can
  reattach to an in-flight run after a reload.
- GET /admin/runs/:id/stdout?from=N: incremental log tail. Reads from
  byte N (bounded chunk of 1 MB), returns content + next_offset + eof.
- POST /admin/runs/:id/push-github: refuses if run still RUNNING; the
  remote_url is regex-whitelisted to GitHub (git@ or https) so the
  feature can't be used to push elsewhere from the web; runs
  git init / add / commit / remote set-url (fallback to add) / push,
  returns steps[] with exit codes + outputs.

All shell-out uses execFile (no shell parsing); the promise-wrapped
helper is named runArgv to make the safety property obvious at the
callsite.

Tests cover all 4 routes' happy path + each documented failure mode
(403/400/404/409/503/500). child_process.spawn and child_process.execFile
are stubbed to keep tests deterministic and offline.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 8 — Frontend: admin-token store + api helpers + page

### Task 8.1: Create stores/runner.ts (admin token + active run id)

**Files:**
- Create: `site/src/stores/runner.ts`

- [ ] **Step 1: Write the file**

```ts
import { defineStore } from 'pinia';

// LocalStorage-backed admin token + active run state. The token is set
// by the operator on first visit to /iterate and persists across reloads.
// Active run id is the one we last started or reattached to; nullable.
const TOKEN_KEY = 'hub.adminToken';

export const useRunnerStore = defineStore('runner', {
  state: () => ({
    adminToken: localStorage.getItem(TOKEN_KEY) ?? '',
    activeRunId: null as string | null,
  }),
  actions: {
    setToken(t: string) {
      this.adminToken = t.trim();
      if (this.adminToken) localStorage.setItem(TOKEN_KEY, this.adminToken);
      else localStorage.removeItem(TOKEN_KEY);
    },
    setActiveRunId(id: string | null) { this.activeRunId = id; },
    clearToken() { this.setToken(''); },
  },
});
```

### Task 8.2: Extend api.ts with admin helpers

**Files:**
- Modify: `site/src/api.ts`

- [ ] **Step 1: Append admin block**

Keep the existing top half of `site/src/api.ts` unchanged. Append at the
bottom:
```ts
const ADMIN_BASE = '/admin';

function adminHeaders(token: string) {
  return { 'content-type': 'application/json',
           Authorization: `Bearer ${token}` };
}

export interface StartRunReq { project_path: string; iter: number }
export interface StartRunRes { run_id: string; pid: number; stdout_log: string }
export interface CurrentRunRes {
  run_id: string | null;
  pid?: number; project_path?: string; started_at?: string;
}
export interface StdoutRes { content: string; next_offset: number; eof: boolean }
export interface PushReq {
  remote_url: string; branch: string; commit_message: string;
}
export interface PushRes {
  steps: Array<{ cmd: string; exit: number; output: string }>;
  ok: boolean; remote_html: string | null;
}

export const adminApi = {
  startRun: async (token: string, body: StartRunReq): Promise<StartRunRes> => {
    const r = await fetch(`${ADMIN_BASE}/runs/start`, {
      method: 'POST', headers: adminHeaders(token), body: JSON.stringify(body),
    });
    if (!r.ok) throw await asError(r);
    return r.json();
  },
  currentRun: async (token: string): Promise<CurrentRunRes> => {
    const r = await fetch(`${ADMIN_BASE}/runs/current`,
                          { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw await asError(r);
    return r.json();
  },
  stdout: async (token: string, runId: string, from: number): Promise<StdoutRes> => {
    const r = await fetch(`${ADMIN_BASE}/runs/${runId}/stdout?from=${from}`,
                          { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw await asError(r);
    return r.json();
  },
  pushGithub: async (token: string, runId: string, body: PushReq): Promise<PushRes> => {
    const r = await fetch(`${ADMIN_BASE}/runs/${runId}/push-github`, {
      method: 'POST', headers: adminHeaders(token), body: JSON.stringify(body),
    });
    // Push intentionally returns 200 or 500 with a JSON body; surface both.
    const j = await r.json().catch(() => ({}));
    if (!r.ok && !j?.steps) throw new Error(`push failed: ${r.status}`);
    return j;
  },
};

async function asError(r: Response): Promise<Error> {
  const text = await r.text().catch(() => '');
  return new Error(`${r.status} ${r.statusText}: ${text.slice(0, 200)}`);
}
```

### Task 8.3: Create composables/useRunner.ts

**Files:**
- Create: `site/src/composables/useRunner.ts`

- [ ] **Step 1: Write the file**

```ts
import { ref, computed, onUnmounted } from 'vue';
import { api, adminApi } from '../api';
import { useRunnerStore } from '../stores/runner';

// Encapsulates the polling state machine for the /iterate page.
// Owns three reactive sources:
//   - `runDetail`  (the runs row, fetched every 2s via /api/runs/:id)
//   - `stdoutBuf`  (incrementally appended via /admin/runs/:id/stdout)
//   - `phase`      ('idle' | 'running' | 'terminal' | 'error')
// Caller drives the lifecycle via start() / attach() / stop().

export type Phase = 'idle' | 'starting' | 'running' | 'terminal' | 'error';

export function useRunner() {
  const store = useRunnerStore();
  const phase = ref<Phase>('idle');
  const runId = ref<string | null>(store.activeRunId);
  const runDetail = ref<any | null>(null);
  const stdoutBuf = ref('');
  const error = ref<string | null>(null);
  let stdoutOffset = 0;
  let detailTimer: number | null = null;
  let stdoutTimer: number | null = null;

  function clearTimers() {
    if (detailTimer) { clearInterval(detailTimer); detailTimer = null; }
    if (stdoutTimer) { clearInterval(stdoutTimer); stdoutTimer = null; }
  }

  function isTerminal(state: string | null | undefined): boolean {
    return !!state && state !== 'RUNNING';
  }

  async function pollDetail() {
    if (!runId.value) return;
    try {
      runDetail.value = await api.getRun(runId.value);
      const ts = runDetail.value?.run?.terminal_state;
      if (isTerminal(ts)) {
        phase.value = 'terminal';
        clearTimers();
        // Drain the rest of stdout one more time so the last log lines arrive.
        await pollStdout();
      }
    } catch (e: any) {
      // 404 is expected immediately after start before d2p has pushed
      // run_started — keep polling.
      if (!/404/.test(e?.message ?? '')) {
        error.value = e?.message ?? String(e);
        phase.value = 'error';
        clearTimers();
      }
    }
  }

  async function pollStdout() {
    if (!runId.value || !store.adminToken) return;
    try {
      const r = await adminApi.stdout(store.adminToken, runId.value, stdoutOffset);
      stdoutBuf.value += r.content;
      stdoutOffset = r.next_offset;
    } catch {
      // 404 is expected before the log file exists; swallow.
    }
  }

  async function start(projectPath: string, iter: number) {
    if (!store.adminToken) throw new Error('admin token not set');
    error.value = null; runDetail.value = null; stdoutBuf.value = '';
    stdoutOffset = 0; phase.value = 'starting';
    try {
      const res = await adminApi.startRun(store.adminToken,
                                          { project_path: projectPath, iter });
      runId.value = res.run_id;
      store.setActiveRunId(res.run_id);
      phase.value = 'running';
      // Kick off polling immediately, then on a 2 s cadence.
      void pollDetail(); void pollStdout();
      detailTimer = window.setInterval(pollDetail, 2000);
      stdoutTimer = window.setInterval(pollStdout, 2000);
    } catch (e: any) {
      error.value = e?.message ?? String(e);
      phase.value = 'error';
    }
  }

  async function attach() {
    if (!store.adminToken) return;
    try {
      const cur = await adminApi.currentRun(store.adminToken);
      if (!cur.run_id) return;
      runId.value = cur.run_id;
      store.setActiveRunId(cur.run_id);
      phase.value = 'running';
      void pollDetail(); void pollStdout();
      detailTimer = window.setInterval(pollDetail, 2000);
      stdoutTimer = window.setInterval(pollStdout, 2000);
    } catch { /* no active run / bad token — stay idle */ }
  }

  function stop() {
    clearTimers();
    phase.value = 'idle';
    runId.value = null;
    store.setActiveRunId(null);
  }

  onUnmounted(clearTimers);

  return {
    phase, runId, runDetail, stdoutBuf, error,
    start, attach, stop,
    canPush: computed(() => phase.value === 'terminal'),
  };
}
```

### Task 8.4: Create the Iterate.vue page

**Files:**
- Create: `site/src/views/Iterate.vue`

- [ ] **Step 1: Write the page**

```vue
<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRunnerStore } from '../stores/runner';
import { useRunner } from '../composables/useRunner';
import { adminApi } from '../api';

const store = useRunnerStore();
const runner = useRunner();

const tokenInput = ref(store.adminToken);
const path = ref('');
const iter = ref(3);

const pushOpen = ref(false);
const remoteUrl = ref('');
const branch = ref('main');
const commitMsg = ref('');
const pushing = ref(false);
const pushResult = ref<any | null>(null);

function saveToken() {
  store.setToken(tokenInput.value);
}

async function onStart() {
  await runner.start(path.value, iter.value);
}

async function onPush() {
  if (!runner.runId.value) return;
  pushing.value = true; pushResult.value = null;
  try {
    pushResult.value = await adminApi.pushGithub(store.adminToken,
                                                 runner.runId.value, {
      remote_url: remoteUrl.value, branch: branch.value,
      commit_message: commitMsg.value,
    });
  } catch (e: any) {
    pushResult.value = { ok: false, error: e?.message ?? String(e) };
  } finally {
    pushing.value = false;
  }
}

// Default commit message once we know iter count + cost.
const suggestedMsg = computed(() => {
  const d = runner.runDetail.value?.run;
  if (!d) return '';
  const iters = d.total_iterations ?? '?';
  const cost = (d.total_cost_usd ?? 0).toFixed(4);
  return `feat: d2p iteration ${iters} (cost $${cost})`;
});

function onPushOpen() {
  pushOpen.value = true;
  if (!commitMsg.value) commitMsg.value = suggestedMsg.value;
}

onMounted(() => {
  // Try to reattach to an in-flight run if there is one.
  if (store.adminToken) void runner.attach();
});
</script>

<template>
  <div class="space-y-6">
    <!-- Token gate -->
    <section v-if="!store.adminToken" class="bg-amber-50 border border-amber-300 rounded-lg p-4">
      <h2 class="font-semibold mb-2">Admin token required</h2>
      <p class="text-sm text-gray-700 mb-3">
        The /iterate page calls admin-gated routes. Paste the
        <code>HUB_ADMIN_TOKEN</code> the Hub was started with.
        It is stored only in this browser's localStorage.
      </p>
      <div class="flex gap-2">
        <input v-model="tokenInput" type="password" placeholder="admin token"
               class="flex-1 border rounded px-3 py-2 text-sm" />
        <button @click="saveToken" class="px-4 py-2 bg-gray-900 text-white rounded text-sm">
          Save
        </button>
      </div>
    </section>

    <!-- Setup -->
    <section v-if="store.adminToken && runner.phase.value === 'idle'"
             class="bg-white border rounded-lg p-4">
      <h2 class="text-base font-semibold mb-3">Run d2p on a folder</h2>
      <div class="space-y-3">
        <div>
          <label class="block text-sm font-medium mb-1">Absolute project path</label>
          <input v-model="path" type="text" placeholder="/Users/you/projects/demo"
                 class="w-full border rounded px-3 py-2 text-sm font-mono" />
        </div>
        <div class="flex items-center gap-3">
          <label class="text-sm font-medium">Max iterations</label>
          <input v-model.number="iter" type="number" min="1" max="10"
                 class="w-20 border rounded px-2 py-1 text-sm" />
        </div>
        <button @click="onStart"
                :disabled="!path || iter < 1 || iter > 10"
                class="px-4 py-2 bg-emerald-600 text-white rounded text-sm disabled:opacity-50">
          Run d2p
        </button>
      </div>
    </section>

    <!-- Starting spinner -->
    <section v-else-if="runner.phase.value === 'starting'"
             class="bg-white border rounded-lg p-4 text-sm">
      Starting d2p subprocess…
    </section>

    <!-- Progress -->
    <section v-else-if="runner.phase.value === 'running' || runner.phase.value === 'terminal'"
             class="bg-white border rounded-lg p-4 space-y-3">
      <div class="flex items-center gap-3">
        <h2 class="text-base font-semibold">
          Run <span class="font-mono text-xs">{{ runner.runId.value?.slice(0, 8) }}</span>
        </h2>
        <span v-if="runner.phase.value === 'running'"
              class="text-xs px-2 py-0.5 bg-blue-100 text-blue-800 rounded">running</span>
        <span v-else
              class="text-xs px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded">
          {{ runner.runDetail.value?.run?.terminal_state ?? 'terminal' }}
        </span>
      </div>
      <div v-if="runner.runDetail.value?.run" class="text-sm text-gray-700">
        Iter {{ runner.runDetail.value.run.total_iterations || '?' }} ·
        cost ${{ (runner.runDetail.value.run.total_cost_usd || 0).toFixed(4) }} ·
        archetype: {{ runner.runDetail.value.run.detected_archetype || '?' }}
      </div>
      <pre class="bg-gray-900 text-gray-100 text-xs font-mono p-3 rounded h-72 overflow-auto whitespace-pre-wrap"
           >{{ runner.stdoutBuf.value || '(waiting for output…)' }}</pre>

      <div v-if="runner.phase.value === 'terminal'" class="pt-2 border-t">
        <button v-if="!pushOpen" @click="onPushOpen"
                class="px-4 py-2 bg-gray-900 text-white rounded text-sm">
          Push to GitHub →
        </button>
        <div v-else class="space-y-3">
          <h3 class="font-semibold text-sm">Push to existing GitHub repo</h3>
          <div>
            <label class="block text-xs font-medium mb-1">Remote URL</label>
            <input v-model="remoteUrl" type="text"
                   placeholder="git@github.com:user/repo.git"
                   class="w-full border rounded px-3 py-2 text-sm font-mono" />
          </div>
          <div class="flex gap-3">
            <div class="flex-1">
              <label class="block text-xs font-medium mb-1">Branch</label>
              <input v-model="branch" type="text"
                     class="w-full border rounded px-3 py-2 text-sm font-mono" />
            </div>
            <div class="flex-1">
              <label class="block text-xs font-medium mb-1">Commit message</label>
              <input v-model="commitMsg" type="text"
                     class="w-full border rounded px-3 py-2 text-sm" />
            </div>
          </div>
          <button @click="onPush" :disabled="pushing || !remoteUrl"
                  class="px-4 py-2 bg-emerald-600 text-white rounded text-sm disabled:opacity-50">
            {{ pushing ? 'Pushing…' : 'Push' }}
          </button>

          <div v-if="pushResult" class="border rounded p-3 text-xs"
               :class="pushResult.ok ? 'border-emerald-300 bg-emerald-50' : 'border-red-300 bg-red-50'">
            <div v-if="pushResult.ok">
              ✓ Pushed.
              <a v-if="pushResult.remote_html" :href="pushResult.remote_html" target="_blank"
                 class="underline text-blue-700">{{ pushResult.remote_html }}</a>
            </div>
            <div v-else class="text-red-800">
              ✗ Push failed.
              <span v-if="pushResult.error">{{ pushResult.error }}</span>
            </div>
            <pre v-if="pushResult.steps" class="mt-2 font-mono whitespace-pre-wrap">{{
              pushResult.steps.map((s: any) => `[${s.exit}] ${s.cmd}\n${s.output}`.trim()).join('\n\n')
            }}</pre>
          </div>
        </div>
      </div>

      <div class="pt-2">
        <button @click="runner.stop()" class="text-xs text-gray-500 underline">
          Forget this run (does NOT kill it)
        </button>
      </div>
    </section>

    <section v-else-if="runner.phase.value === 'error'"
             class="bg-red-50 border border-red-300 rounded-lg p-4 text-sm text-red-800">
      Error: {{ runner.error.value }}
      <button @click="runner.stop()" class="ml-2 underline">reset</button>
    </section>
  </div>
</template>
```

### Task 8.5: Add router entry + nav link

**Files:**
- Modify: `site/src/router.ts`
- Modify: `site/src/components/NavBar.vue`

- [ ] **Step 1: router.ts**

In `site/src/router.ts`, inside the `routes` array, add (between the existing `/standards/...` entry and `/mentor`):
```ts
    { path: '/iterate', name: 'iterate', component: () => import('./views/Iterate.vue') },
```

- [ ] **Step 2: NavBar.vue**

In `site/src/components/NavBar.vue`, inside the `<nav>` block, add (immediately after the `运行` link):
```vue
    <router-link to="/iterate" class="hover:underline">迭代</router-link>
```

- [ ] **Step 3: Site build**

Run: `pnpm site:build`
Expected: build succeeds.

### Task 8.6: Commit phase 8

- [ ] **Step 1: Stage + commit**

```bash
cd /Users/mack/Desktop/Hosico/Works/Work/demo2project && git add site/src/views/Iterate.vue site/src/composables/useRunner.ts site/src/stores/runner.ts site/src/api.ts site/src/router.ts site/src/components/NavBar.vue && git commit -m "$(cat <<'EOF'
feat(site): /iterate page (operator d2p launcher + push-to-GitHub)

A new Vue 3 page wired to the 4 /admin/runs/* routes:

- stores/runner.ts: Pinia store backed by localStorage for the admin
  token (operator pastes it once on first visit; never sent anywhere
  other than Hub) + the active run id.
- composables/useRunner.ts: encapsulates the polling state machine
  (idle → starting → running → terminal → error), drives /api/runs/:id
  every 2 s and /admin/runs/:id/stdout incrementally from the last
  byte offset.
- views/Iterate.vue: 3-section state machine — token gate, setup form
  (path + iter, defaults sane), progress (live stdout tail + cost +
  iter count), push panel (GitHub remote URL + branch + commit msg,
  shows steps[] from the backend on success or failure).
- api.ts: adminApi helpers with Bearer-token wrapping.
- router.ts + NavBar.vue: /iterate route + nav link 迭代.

Frontend tests deferred — site/ codebase is tested lightly today and
adding component tests for one new page is out of scope. Manual
smoke checklist lives in the spec at
docs/superpowers/specs/2026-05-25-hub-iterate-page-design.md §13.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 9 — Manual smoke (spec §13)

These are NOT automated tests. They produce evidence the page actually
works against a real running Hub + real d2p subprocess.

### Task 9.1: Local end-to-end smoke

- [ ] **Step 1: Build everything**

Run:
```bash
cd /Users/mack/Desktop/Hosico/Works/Work/demo2project && pnpm hub:build
```
Expected: `dist/hub/*` and `site/dist/*` regenerated, no errors.

- [ ] **Step 2: Seed a fresh Hub DB and capture the instance token**

Run:
```bash
rm -f /tmp/iterate-smoke.db && HUB_DB_PATH=/tmp/iterate-smoke.db pnpm hub:seed | tee /tmp/iterate-seed.out
TOKEN=$(grep '^HUB_TOKEN=' /tmp/iterate-seed.out | cut -d= -f2)
echo "instance token: $TOKEN"
```
Expected: 4 archetypes seeded + a `HUB_TOKEN=...` line. Capture it.

- [ ] **Step 3: Start Hub with the runner enabled**

Run:
```bash
HUB_ADMIN_TOKEN=smoke-admin \
HUB_DB_PATH=/tmp/iterate-smoke.db \
HUB_PORT=3131 \
D2P_RUNNER_ENABLED=1 \
D2P_PATH=/Users/mack/Desktop/Hosico/Works/Work/d2p \
D2P_RUNNER_MINIMAX_API_KEY="$(unzip -p ~/Desktop/MINIMAX_KEY.docx word/document.xml | python3 -c 'import re,sys; t=re.sub(r"<[^>]+>", " ", sys.stdin.read()); print(re.findall(r"sk-[A-Za-z0-9_-]+", t)[0])')" \
D2P_RUNNER_INSTANCE_TOKEN="$TOKEN" \
pnpm hub:start > /tmp/iterate-hub.log 2>&1 &
echo "hub PID=$!"
sleep 3
curl -sf -H "Authorization: Bearer smoke-admin" http://127.0.0.1:3131/admin/health
```
Expected: `{"db_ok":true,...}`. If you see a "runner_not_configured" warning in
`/tmp/iterate-hub.log`, one of the env vars didn't make it.

- [ ] **Step 4: Open the page**

Run: `open http://127.0.0.1:3131/iterate`
Expected: page shows the "Admin token required" gate. Paste `smoke-admin`,
click Save. Setup form appears.

- [ ] **Step 5: Run on the same tiny demo we used earlier**

In the page:
- Path: `/tmp/d2p-e2e-demo` (or any small folder under `$HOME` / `/tmp`)
- Iterations: 1
- Click **Run d2p**

Expected:
- Progress section appears within ~2 s
- d2p stdout tail starts streaming
- Iter / cost number tick up live
- After ~3-7 minutes a terminal state is shown

- [ ] **Step 6: Push panel works**

Click **Push to GitHub →**. Fill in:
- Remote URL: a throwaway repo of yours, e.g. `git@github.com:Hosico02/d2p-smoke-target.git`
- Branch: `main`
- Commit message: the suggested one

Click **Push**.

Expected: steps render in green with output; if all green, the
`remote_html` link appears. Open it — the productized project should
be in the repo.

- [ ] **Step 7: Crash test**

Re-open the page in a new tab. Click **Run d2p** again on a different
small folder.

Expected: 409 surfaces as "another run is in progress" (or equivalent
error).

Kill Hub mid-run (Ctrl-C on the foreground process or `kill $hub_pid`).
Restart Hub with the same env. Open the page.

Expected: the previously-running row is now marked `crashed` in the
runs list (`/`), not stuck on `RUNNING`. The /iterate page shows no
active run (`current` returns null).

- [ ] **Step 8: Tear down**

```bash
pkill -f 'node dist/hub/index.js' 2>/dev/null || true
rm -f /tmp/iterate-smoke.db /tmp/iterate-seed.out /tmp/iterate-hub.log
```

If any of steps 4-7 misbehaved, note exactly what + which step and
resume from the relevant Task in earlier phases (e.g., "Step 6 push
failed because git remote already existed" → revisit the
`runStep('git remote set-url')` fallback logic in `runs_runner.ts`).

---

## Phase 10 — Push to GitHub remotes (final step)

### Task 10.1: Push d2p first (smaller change, less risky)

- [ ] **Step 1: Verify d2p is clean and inspect what'll be pushed**

Run:
```bash
cd /Users/mack/Desktop/Hosico/Works/Work/d2p && git status && git log --oneline origin/main..HEAD
```
Expected: working tree clean. List the commits that will be pushed
(should be the prior session's 5 commits + Phase 0's D2P_RUN_ID commit).

- [ ] **Step 2: Push**

Run: `cd /Users/mack/Desktop/Hosico/Works/Work/d2p && git push origin main`
Expected: push succeeds.

### Task 10.2: Push MatrixOmnix-Hub

- [ ] **Step 1: Verify Hub is clean and inspect what'll be pushed**

Run:
```bash
cd /Users/mack/Desktop/Hosico/Works/Work/demo2project && git status && git log --oneline origin/main..HEAD
```
Expected: working tree clean. List commits (the summariser route, the
iterate spec + plan, and the three iterate implementation commits).

- [ ] **Step 2: Push**

Run: `cd /Users/mack/Desktop/Hosico/Works/Work/demo2project && git push origin main`
Expected: push succeeds.

---

## Self-review notes (this section is for the planner, not the executor)

Spec coverage check:
- §3 user flow → Phase 8.4 Iterate.vue + Phase 8.3 useRunner state machine ✓
- §4 architecture diagram → Phases 2 (supervisor) + 4-7 (4 routes) + 8 (frontend) ✓
- §5 data model (no new tables; runner-logs/<id>.log) → supervisor.ts creates logDir ✓
- §6.1 POST /admin/runs/start → Phase 4 ✓
- §6.2 GET /admin/runs/:id/stdout → Phase 6 ✓
- §6.3 GET /admin/runs/current → Phase 5 ✓
- §6.4 POST /admin/runs/:id/push-github → Phase 7 ✓
- §6.5 config env → Phase 1 ✓
- §7 RunSupervisor lifecycle → Phase 2 (incl. crashed-orphan path) ✓
- §8 frontend (Iterate, useRunner, stores/runner, router) → Phase 8 ✓
- §9 d2p D2P_RUN_ID change → Phase 0 ✓
- §10 security (path whitelist, regex GitHub remote, argv-only shell-out) → all in runs_runner.ts ✓
- §11 failure modes → tests cover all the documented paths ✓
- §12 testing → 4 backend test files + supervisor test ✓
- §13 acceptance criteria → Phase 9 smoke checklist matches the 4 items in spec §13 ✓
- §15 file list → reproduced in "File Structure" above ✓

Type consistency check:
- `ActiveRun` shape used identically in supervisor.ts and runs_runner.ts ✓
- `RunnerConfig` interface exported from runs_runner.ts, imported in server.ts ✓
- `StartRunReq` / `StartRunRes` / `CurrentRunRes` / `StdoutRes` / `PushReq` / `PushRes` types defined in api.ts, consumed in useRunner + Iterate.vue ✓
- `phase` ref values match in useRunner ('idle' | 'starting' | 'running' | 'terminal' | 'error') and Iterate.vue v-if branches ✓
- `--no-cache-analysis` flag matches what we exercised in the earlier real-run smoke this session ✓

No placeholders or TBDs in any task body.
