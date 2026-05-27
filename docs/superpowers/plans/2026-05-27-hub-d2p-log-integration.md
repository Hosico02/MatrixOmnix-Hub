# Hub ↔ d2p log integration · implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make externally-started d2p runs visible in Hub's `/runs/:id` logs tab (both milestones panel and stdout viewer) without any frontend changes.

**Architecture:** d2p pushes existing `/events` with a new optional `stdout_path` field on `run_started`. Hub persists it on `runs`, and `/admin/runs/:id/stdout` reads from that path with a `terminatedAt`-aware EOF flag. Three commits, all on a new branch `hub-d2p-log-integration` cut from `main`.

**Tech Stack:** TypeScript, Hono, drizzle-orm, better-sqlite3, vitest.

**Spec:** `docs/superpowers/specs/2026-05-27-hub-d2p-log-integration-design.md`

---

## Pre-flight

### Task 0: Branch off main

**Files:** none (branch state only)

- [ ] **Step 1: Confirm clean tree on main**

Run: `git status && git branch --show-current`
Expected: `nothing to commit, working tree clean` and `main`

- [ ] **Step 2: Cut feature branch**

Run: `git checkout -b hub-d2p-log-integration`
Expected: `Switched to a new branch 'hub-d2p-log-integration'`

- [ ] **Step 3: Confirm baseline tests pass**

Run: `pnpm test -- --reporter=dot 2>&1 | tail -5`
Expected: a single line like `Tests  N passed (N)`. Record N — this is the baseline test count for later assertions. (At time of writing, Hub backend tests on main are independent of the `logs-tab` branch's 104 frontend tests.)

---

## Commit 1 — Schema migration for `stdout_path`

### Task 1: Add `stdoutPath` column to `runs` schema

**Files:**
- Modify: `src/hub/db/schema.ts:13-26` (the `runs` table definition)
- Create: `src/hub/db/migrations/0001_add_runs_stdout_path.sql` (new migration)

- [ ] **Step 1: Add column to drizzle schema**

In `src/hub/db/schema.ts`, in the `runs` table definition, add `stdoutPath: text('stdout_path'),` after `terminalState`. Final result:

```ts
export const runs = sqliteTable('runs', {
  id: text('id').primaryKey(),
  instanceId: text('instance_id').notNull().references(() => d2pInstances.id),
  projectPath: text('project_path').notNull(),
  detectedArchetype: text('detected_archetype'),
  startedAt: text('started_at').notNull(),
  terminatedAt: text('terminated_at'),
  terminalState: text('terminal_state'),
  stdoutPath: text('stdout_path'),
  totalCostUsd: real('total_cost_usd').default(0),
  totalIterations: integer('total_iterations').default(0),
}, (t) => ({
  byInstanceTime: index('runs_instance_time').on(t.instanceId, t.startedAt),
  byArchetypeState: index('runs_archetype_state').on(t.detectedArchetype, t.terminalState),
}));
```

The column is nullable (no `.notNull()`), which is the correct semantics: "no advertised stdout path; use runner-logs fallback."

- [ ] **Step 2: Write the migration SQL file by hand**

Skip `drizzle-kit generate` — the project's existing migrations are committed by hand. Create `src/hub/db/migrations/0001_add_runs_stdout_path.sql` with exactly:

```sql
ALTER TABLE `runs` ADD `stdout_path` text;
```

Note: SQLite's `ALTER TABLE ... ADD COLUMN` does not need `IF NOT EXISTS`; the migrate() helper in `client.ts` doesn't have a regex for `ALTER TABLE` to make it idempotent, but that's fine — each migration is run once per fresh DB (in tests via `mkdtempSync`, in prod the existing DB has already been migrated to 0000 and 0001 will run cleanly the first time on subsequent boots).

- [ ] **Step 3: Verify migration file syntactic validity by booting an in-memory db**

Run:
```bash
node -e "
const Database = require('better-sqlite3');
const { readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');
const db = new Database(':memory:');
const dir = 'src/hub/db/migrations';
for (const f of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
  const sql = readFileSync(join(dir, f), 'utf-8');
  db.exec(sql.replace(/CREATE TABLE \`/g, 'CREATE TABLE IF NOT EXISTS \`').replace(/CREATE UNIQUE INDEX \`/g, 'CREATE UNIQUE INDEX IF NOT EXISTS \`').replace(/CREATE INDEX \`/g, 'CREATE INDEX IF NOT EXISTS \`'));
}
console.log(db.prepare('PRAGMA table_info(runs)').all().map(c => c.name).join(','));
"
```

Expected: a single line printing column names including `stdout_path`.

- [ ] **Step 4: Run existing tests; confirm none regress**

Run: `pnpm test -- --reporter=dot 2>&1 | tail -5`
Expected: same passing count as baseline. The new column is unused so far; nothing should change.

- [ ] **Step 5: Commit**

```bash
git add src/hub/db/schema.ts src/hub/db/migrations/0001_add_runs_stdout_path.sql
git commit -m "$(cat <<'EOF'
feat(hub): runs.stdout_path column for external d2p run logs

Nullable column lets d2p advertise its log file path on run_started.
Stdout endpoint will read from this in a follow-up commit; for now
the column is dormant.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Commit 2 — Ingest writes `stdoutPath`, endpoint reads it + fixes EOF

### Task 2: Wire `stdoutPath` through `dispatchIngest`

**Files:**
- Modify: `src/hub/ingest/eventHandlers.ts:37-46` (the `run_started` case)
- Modify: `tests/hub/eventHandlers.test.ts` (add 2 new tests)

- [ ] **Step 1: Write the failing tests first**

Add to `tests/hub/eventHandlers.test.ts`, inside the `describe('event handlers', ...)` block:

```ts
  it('run_started persists stdout_path when provided', () => {
    dispatchIngest(handle, inst, 'run_started', 'run-sp1', {
      project_path: '/p',
      stdout_path: '/p/.d2p/run-sp1/d2p.log',
      started_at: 't0',
    });
    const r = handle.db.select().from(runs).all();
    expect(r).toHaveLength(1);
    expect(r[0].stdoutPath).toBe('/p/.d2p/run-sp1/d2p.log');
  });

  it('run_started leaves stdout_path NULL when omitted', () => {
    dispatchIngest(handle, inst, 'run_started', 'run-sp2', {
      project_path: '/p',
      started_at: 't0',
    });
    const r = handle.db.select().from(runs).all();
    expect(r[0].stdoutPath).toBeNull();
  });
```

- [ ] **Step 2: Run them; verify they fail**

Run: `pnpm test tests/hub/eventHandlers.test.ts 2>&1 | tail -20`
Expected: two new test names listed with FAIL. The first will fail because nothing writes the column; the second will fail because `r[0].stdoutPath` is `undefined` on a row that doesn't have that property — actually it should already be `null` from the schema once Task 1 added the column. Both must show as not yet passing (or the first test must show null instead of the path).

- [ ] **Step 3: Update the `run_started` case to write the column**

In `src/hub/ingest/eventHandlers.ts`, in the `run_started` case (around line 37-46), add `stdoutPath: payload.stdout_path ?? null,` to the `.set({...})` object:

```ts
    case 'run_started': {
      ensureRun(handle, inst, runId);
      handle.db.update(runs).set({
        projectPath: payload.project_path ?? '(unknown)',
        detectedArchetype: payload.detected_archetype ?? null,
        startedAt: payload.started_at ?? new Date().toISOString(),
        terminalState: 'RUNNING',
        stdoutPath: payload.stdout_path ?? null,
      }).where(eq(runs.id, runId)).run();
      return;
    }
```

- [ ] **Step 4: Run the new tests; verify they pass**

Run: `pnpm test tests/hub/eventHandlers.test.ts 2>&1 | tail -15`
Expected: all tests in this file pass; the two new ones included.

### Task 3: Update stdout endpoint — path resolution + EOF logic

**Files:**
- Modify: `src/hub/routes/runs_runner.ts:127-159` (the `/admin/runs/:id/stdout` handler)
- Modify: `tests/hub/routes.runs.stdout.test.ts` (add 4 new tests)

- [ ] **Step 1: Write the failing tests first**

Add to `tests/hub/routes.runs.stdout.test.ts`, inside the same `describe('GET /admin/runs/:id/stdout', ...)` block. These tests insert directly into the DB to simulate external runs (no supervisor involvement):

```ts
  it('uses runs.stdout_path for external runs (no supervisor entry)', async () => {
    // Set up an external run: DB row with stdout_path pointing at a temp file
    const { runs, d2pInstances } = await import('../../src/hub/db/schema.js');
    const inst = { id: randomUUID(), name: 'ext', tokenHash: 'x' };
    env.app; // ensure app built
    // We need access to the db handle that mkApp uses. Refactor mkApp to expose it.
    // (See Step 2 below — mkApp now returns handle too.)
    const handle = env.handle;
    handle.db.insert(d2pInstances).values(inst).run();
    const extDir = join(env.root, 'ext');
    mkdirSync(extDir, { recursive: true });
    const extPath = join(extDir, 'd2p.log');
    writeFileSync(extPath, 'external content\n');
    handle.db.insert(runs).values({
      id: 'run-ext-1',
      instanceId: inst.id,
      projectPath: '/p',
      startedAt: 't0',
      stdoutPath: extPath,
    }).run();
    const r = await env.app.request(
      `/admin/runs/run-ext-1/stdout?from=0`,
      { headers: { Authorization: 'Bearer sec' } },
    );
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.content).toBe('external content\n');
  });

  it('external run with terminatedAt=null reports eof:false at end of file', async () => {
    const { runs, d2pInstances } = await import('../../src/hub/db/schema.js');
    const inst = { id: randomUUID(), name: 'ext', tokenHash: 'x' };
    const handle = env.handle;
    handle.db.insert(d2pInstances).values(inst).run();
    const extPath = join(env.root, 'live.log');
    writeFileSync(extPath, 'partial\n');
    handle.db.insert(runs).values({
      id: 'run-live', instanceId: inst.id, projectPath: '/p',
      startedAt: 't0', stdoutPath: extPath, terminatedAt: null,
    }).run();
    const r = await env.app.request(
      `/admin/runs/run-live/stdout?from=0`,
      { headers: { Authorization: 'Bearer sec' } },
    );
    const j = await r.json();
    expect(j.content).toBe('partial\n');
    expect(j.eof).toBe(false); // still live
  });

  it('external run with terminatedAt set reports eof:true at end of file', async () => {
    const { runs, d2pInstances } = await import('../../src/hub/db/schema.js');
    const inst = { id: randomUUID(), name: 'ext', tokenHash: 'x' };
    const handle = env.handle;
    handle.db.insert(d2pInstances).values(inst).run();
    const extPath = join(env.root, 'done.log');
    writeFileSync(extPath, 'finished\n');
    handle.db.insert(runs).values({
      id: 'run-done', instanceId: inst.id, projectPath: '/p',
      startedAt: 't0', stdoutPath: extPath, terminatedAt: 't9',
      terminalState: 'CLEAN',
    }).run();
    const r = await env.app.request(
      `/admin/runs/run-done/stdout?from=0`,
      { headers: { Authorization: 'Bearer sec' } },
    );
    const j = await r.json();
    expect(j.content).toBe('finished\n');
    expect(j.eof).toBe(true);
  });

  it('external run with NULL stdout_path falls back to runner-logs (404 if absent)', async () => {
    const { runs, d2pInstances } = await import('../../src/hub/db/schema.js');
    const inst = { id: randomUUID(), name: 'ext', tokenHash: 'x' };
    const handle = env.handle;
    handle.db.insert(d2pInstances).values(inst).run();
    handle.db.insert(runs).values({
      id: 'run-nopath', instanceId: inst.id, projectPath: '/p',
      startedAt: 't0', stdoutPath: null,
    }).run();
    const r = await env.app.request(
      `/admin/runs/run-nopath/stdout?from=0`,
      { headers: { Authorization: 'Bearer sec' } },
    );
    expect(r.status).toBe(404);
  });
```

- [ ] **Step 2: Update `mkApp` to expose the DB handle**

Currently `mkApp()` only returns `{ app, root }`. Change it to also return `handle`. In `tests/hub/routes.runs.stdout.test.ts`:

```ts
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
  return { app, root, handle };  // <-- added handle
}
```

- [ ] **Step 3: Run the new tests; verify they fail**

Run: `pnpm test tests/hub/routes.runs.stdout.test.ts 2>&1 | tail -30`
Expected: the four new tests fail (likely with 404 in the first case because the endpoint still computes the runner-logs path; with `eof:true` in the second; etc.).

- [ ] **Step 4: Update the endpoint — path resolution + EOF logic**

In `src/hub/routes/runs_runner.ts`, replace the body of the `GET /admin/runs/:id/stdout` handler (lines 128-159) with:

```ts
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
```

Key changes from the original:
1. Added the `runsRow` SELECT (one DB read per poll).
2. Path priority: `cur.stdoutPath` → `runsRow.stdoutPath` → legacy `runner-logs/<id>.log` fallback.
3. `isLive` derived from supervisor OR `terminatedAt == null`.
4. Both EOF return sites use `!isLive` instead of the old `cur?.runId !== id`.

- [ ] **Step 5: Run all stdout tests; verify all pass**

Run: `pnpm test tests/hub/routes.runs.stdout.test.ts 2>&1 | tail -15`
Expected: every test in this file passes (3 original + 4 new = 7 total in the describe block).

- [ ] **Step 6: Run full suite; confirm no regressions**

Run: `pnpm test -- --reporter=dot 2>&1 | tail -5`
Expected: baseline count + 6 new tests (2 in eventHandlers + 4 in stdout), all passing.

- [ ] **Step 7: Commit**

```bash
git add src/hub/ingest/eventHandlers.ts src/hub/routes/runs_runner.ts \
        tests/hub/eventHandlers.test.ts tests/hub/routes.runs.stdout.test.ts
git commit -m "$(cat <<'EOF'
feat(hub): stdout endpoint reads runs.stdout_path; terminatedAt-gated EOF

run_started ingest now persists stdout_path. The stdout endpoint
resolves the log file in three tiers: live Hub-spawned run → DB
stdout_path (external run) → legacy runner-logs fallback. EOF flag is
derived from terminatedAt instead of supervisor identity so externally
started runs stay 'live' until run_terminated arrives.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Commit 3 — End-to-end integration test + spec cross-link

### Task 4: Add end-to-end integration test

**Files:**
- Create: `tests/hub/integration.d2p-external.test.ts`

- [ ] **Step 1: Write the test**

Create `tests/hub/integration.d2p-external.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDb, migrate } from '../../src/hub/db/client.js';
import { buildApp } from '../../src/hub/server.js';
import { RunSupervisor } from '../../src/hub/runner/supervisor.js';
import { d2pInstances } from '../../src/hub/db/schema.js';
import bcrypt from 'bcryptjs';

function mkEnv() {
  const root = mkdtempSync(join(tmpdir(), 'ext-int-'));
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
  // Seed an instance the integration test can authenticate as.
  // Pattern lifted from tests/hub/instanceLookup.test.ts:19.
  const tokenPlain = 'inst-token-xyz';
  const instId = randomUUID();
  handle.db.insert(d2pInstances).values({
    id: instId,
    name: 'ext-test',
    tokenHash: bcrypt.hashSync(tokenPlain, 4),
  }).run();
  return { app, root, handle, instId, tokenPlain };
}

describe('end-to-end: external d2p run becomes visible', () => {
  let env: ReturnType<typeof mkEnv>;
  beforeEach(() => { env = mkEnv(); });

  it('run_started → stdout poll → iter_complete → terminate → eof', async () => {
    const runId = 'run-20260527-ext';
    const logDir = join(env.root, 'project', '.d2p', runId);
    mkdirSync(logDir, { recursive: true });
    const logPath = join(logDir, 'd2p.log');
    writeFileSync(logPath, '');  // touch first, per contract

    // d2p posts run_started
    const r1 = await env.app.request('/events', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.tokenPlain}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'run_started',
        run_id: runId,
        payload: {
          project_path: join(env.root, 'project'),
          stdout_path: logPath,
          started_at: '2026-05-27T09:42:42Z',
          detected_archetype: 'node-cli',
        },
      }),
    });
    expect(r1.status).toBe(200);

    // First poll — empty file, still live
    appendFileSync(logPath, 'starting iter 1\n');
    const p1 = await env.app.request(
      `/admin/runs/${runId}/stdout?from=0`,
      { headers: { Authorization: 'Bearer sec' } },
    );
    const j1 = await p1.json();
    expect(j1.content).toBe('starting iter 1\n');
    expect(j1.eof).toBe(false);

    // d2p appends more, posts iteration_complete
    appendFileSync(logPath, 'iter 1 done\n');
    await env.app.request('/events', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.tokenPlain}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'iteration_complete',
        run_id: runId,
        payload: {
          iter_n: 1,
          started_at: 't1',
          ended_at: 't2',
          analyzer_summary: 'looks ok',
        },
      }),
    });

    // Incremental poll from offset
    const p2 = await env.app.request(
      `/admin/runs/${runId}/stdout?from=${j1.next_offset}`,
      { headers: { Authorization: 'Bearer sec' } },
    );
    const j2 = await p2.json();
    expect(j2.content).toBe('iter 1 done\n');
    expect(j2.eof).toBe(false);

    // Confirm /runs/:id surfaces the iteration so milestones panel works
    const detail = await env.app.request(`/runs/${runId}`);
    expect(detail.status).toBe(200);
    const dj = await detail.json();
    expect(dj.run.id).toBe(runId);
    expect(dj.iterations).toHaveLength(1);
    expect(dj.iterations[0].analyzer_summary).toBe('looks ok');

    // d2p posts run_terminated
    await env.app.request('/events', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.tokenPlain}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'run_terminated',
        run_id: runId,
        payload: {
          terminal_state: 'CLEAN',
          terminated_at: '2026-05-27T10:00:00Z',
          total_iterations: 1,
        },
      }),
    });

    // Final poll — at end of file, now eof:true
    const p3 = await env.app.request(
      `/admin/runs/${runId}/stdout?from=${j2.next_offset}`,
      { headers: { Authorization: 'Bearer sec' } },
    );
    const j3 = await p3.json();
    expect(j3.content).toBe('');
    expect(j3.eof).toBe(true);
  });
});
```

- [ ] **Step 2: Sanity-check the bcrypt import path resolves**

Run: `pnpm exec tsc --noEmit tests/hub/integration.d2p-external.test.ts 2>&1 | tail -10`
Expected: no errors. `bcryptjs` is already a runtime dep (see `tests/hub/instanceLookup.test.ts:19` for the established pattern this test mirrors).

- [ ] **Step 3: Run the integration test**

Run: `pnpm test tests/hub/integration.d2p-external.test.ts 2>&1 | tail -20`
Expected: 1 test passes.

If the `/runs/:id` shape assertion fails (`dj.run.id`, `dj.iterations[0].analyzer_summary`), check the actual route response shape:
```
grep -n 'c.json\|return c.json' src/hub/routes/runs.ts | head -10
```
Adjust the assertion to match the actual key names (e.g., `dj.id` vs `dj.run.id`, snake vs camel) — do not change the route to fit the test.

- [ ] **Step 4: Run full suite once more**

Run: `pnpm test -- --reporter=dot 2>&1 | tail -5`
Expected: baseline + 7 new tests (2 ingest + 4 stdout + 1 integration), all passing.

### Task 5: Add spec cross-link in the logs-tab design doc

**Files:**
- Modify: `docs/superpowers/specs/2026-05-26-hub-logs-tab-design.md` (append one line at the end)

- [ ] **Step 1: Append the pointer**

Open `docs/superpowers/specs/2026-05-26-hub-logs-tab-design.md` and append at the very bottom:

```markdown

---

**Follow-up**: external (non-Hub-spawned) d2p runs are made visible by
`2026-05-27-hub-d2p-log-integration-design.md`. No frontend changes;
backend-only.
```

- [ ] **Step 2: Commit Task 4 + Task 5 together**

```bash
git add tests/hub/integration.d2p-external.test.ts \
        docs/superpowers/specs/2026-05-26-hub-logs-tab-design.md
git commit -m "$(cat <<'EOF'
test(hub): end-to-end external d2p run integration + doc cross-link

Single test exercises the full contract: POST /events run_started with
stdout_path, append-poll-append-poll loop, iteration_complete fills the
milestones panel via /runs/:id, run_terminated flips eof. Cross-links
the new integration spec from the logs-tab design.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Post-flight verification

### Task 6: Final sanity

- [ ] **Step 1: Confirm 3 commits on the branch**

Run: `git log --oneline main..hub-d2p-log-integration`
Expected: exactly 3 lines, in this order (bottom-up):
1. `feat(hub): runs.stdout_path column for external d2p run logs`
2. `feat(hub): stdout endpoint reads runs.stdout_path; terminatedAt-gated EOF`
3. `test(hub): end-to-end external d2p run integration + doc cross-link`

- [ ] **Step 2: Confirm working tree clean**

Run: `git status`
Expected: `nothing to commit, working tree clean`.

- [ ] **Step 3: Confirm typecheck passes**

Run: `pnpm exec tsc -p tsconfig.json --noEmit 2>&1 | tail -10`
Expected: no output (success) or only warnings; no errors.

- [ ] **Step 4: Confirm full test suite passes**

Run: `pnpm test -- --reporter=dot 2>&1 | tail -5`
Expected: baseline_N + 7 = final passing count, all green.

- [ ] **Step 5: Hand off**

Report final state:
- Branch: `hub-d2p-log-integration`, 3 commits, all unpushed
- Tests: baseline + 7 new
- Open question for user: merge order with `logs-tab` branch (this branch is independent; can merge either first)
- Reminder: this is half the integration. The d2p session must also ship its half (env vars, POST /events on run start with stdout_path, tee stdout to the file, POST run_terminated on exit). Until then, the Hub side is dormant for external runs — no regression, just no new functionality visible.

---

## Notes for the implementing engineer

- **Why three commits not one**: each commit leaves the suite green and the system in a sensible state. Commit 1 adds dormant infrastructure (column unused — safe). Commit 2 wires it up + fixes the EOF bug. Commit 3 proves the end-to-end story with one test that exercises the cross-component contract. Bisect-friendly.
- **Why no frontend changes**: the logs tab already polls `/runs/:id` and `/admin/runs/:id/stdout`. Both endpoints now serve external runs correctly. The 30s milestone refetch in `RunDetail.vue` (added in `fbe1677` on the `logs-tab` branch) already covers "live external run, milestones panel needs refreshing."
- **Why DB row direct-insert in tests**: bypassing the `/events` POST in unit tests keeps each test focused on one route. The integration test (Task 4) is the one that exercises the full event-posting path.
- **Why no path-safety check on `stdout_path`**: instance token is the trust boundary; spec §9 explicitly defers symlink/allowlist hardening. If you find yourself wanting to add validation, stop and re-read §4 and §9.
- **Why `terminatedAt` not `terminalState`**: `terminalState` is set to `'RUNNING'` immediately on `run_started`, so it's never null after the first event. `terminatedAt` stays NULL until termination — that's the right "is the run done" signal. (Spec was originally wrong about this; corrected during planning.)
