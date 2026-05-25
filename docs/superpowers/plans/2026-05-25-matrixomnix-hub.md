# MatrixOmnix Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build MatrixOmnix Hub — a localhost-first PM + mentor cockpit for d2p productization runs. Multiple d2p instances push events here; this hub aggregates, learns standards drift, surfaces decisions to a human via a humanized Vue dashboard, and serves standards back to d2p verifier on demand.

**Architecture:** Single Node process (Hono) serving both HTTP API and static Vue UI on one port. SQLite file via Drizzle ORM for persistence. Learner is two-track: 5 SQL-based rules debounced post-event + weekly Opus summariser, both feeding a single human-approval queue. d2p side gets a ~200 LOC HubClient that is fully fail-safe (hub down → d2p keeps running).

**Tech Stack:** TypeScript, Hono, better-sqlite3, Drizzle ORM, Vue 3 + Vite + Pinia + Vue Router + Tailwind, vitest, tsup. d2p side: Python 3.11+, httpx, pytest.

**Spec:** [`docs/superpowers/specs/2026-05-25-matrixomnix-hub-design.md`](../specs/2026-05-25-matrixomnix-hub-design.md)

### Honest scope note on existing-asset reuse

Spec §8.1 anticipates "adapter" tasks that bridge the existing 12k LOC TypeScript subsystems (eventStore, QACaseStore, standards manager, gapAnalyzer, etc.) into SQLite. **This plan does not do that integration work.** It writes fresh Drizzle-backed hub code that owns its own storage.

This is intentional and pragmatic:
- The existing subsystems were designed for the verifier-pivot architecture (in-process Verifier reading project files). The hub's job (ingest events, store metrics, surface UI) is structurally different.
- Rewriting QACaseStore + standards manager + eventStore as SQLite adapters would roughly double the plan size with low immediate value.
- The existing files remain in `src/core/`, `src/qa/`, `src/standards/` — available to import as library code if a future learner rule needs them. They are *not* deleted (only `VerifierAgent.ts` and `src/mcp/` are deleted in Task 7.2).
- A future phase can add adapter tasks if a use-case appears (e.g., when implementing a richer mentor critique that reuses QASimilarity).

If you (the engineer) hit a learner rule or UI feature that would clearly benefit from one of the existing subsystems, prefer importing it as a pure function call over re-implementing — but otherwise, do not force-wire them.

---

## Phase 0 — Branch + baseline tag

### Task 0.1: Tag pre-hub state + create hub branch

**Files:** (none — git ops)

- [ ] **Step 1: Verify clean working tree**

Run: `git status -s`
Expected: empty (no uncommitted files).

- [ ] **Step 2: Tag current main**

Run: `git tag v0.0.7-verifier-pivot HEAD`
Then: `git log --oneline -3`
Expected: tag created on the latest spec commit.

- [ ] **Step 3: Create hub branch**

Run: `git switch -c hub-implementation`
Expected: now on branch `hub-implementation`.

---

## Phase 1 — Hub foundation (deps + DB + minimal HTTP)

### Task 1.1: Install hub dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add runtime deps**

Run: `pnpm add hono @hono/node-server better-sqlite3 drizzle-orm zod bcryptjs`
Expected: 6 packages added under `dependencies`; lockfile updates.

- [ ] **Step 2: Add dev deps**

Run: `pnpm add -D drizzle-kit tsup tsx @types/better-sqlite3 @types/bcryptjs`
Expected: 5 packages added under `devDependencies`.

- [ ] **Step 3: Commit**

Run: `git add package.json pnpm-lock.yaml && git commit -m "deps: add Hono + Drizzle + SQLite for hub"`

---

### Task 1.2: Config module (env reading)

**Files:**
- Create: `src/hub/config.ts`
- Create: `tests/hub/config.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/hub/config.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../../src/hub/config.js';

describe('hub config', () => {
  const origEnv = { ...process.env };
  beforeEach(() => { process.env = { ...origEnv }; });
  afterEach(() => { process.env = origEnv; });

  it('uses defaults when no env vars set', () => {
    delete process.env.HUB_PORT;
    delete process.env.HUB_DB_PATH;
    delete process.env.HUB_BIND;
    const cfg = loadConfig();
    expect(cfg.port).toBe(3030);
    expect(cfg.bind).toBe('127.0.0.1');
    expect(cfg.dbPath).toMatch(/\.matrixomnix\/hub\.db$/);
  });

  it('reads HUB_PORT as number', () => {
    process.env.HUB_PORT = '4040';
    expect(loadConfig().port).toBe(4040);
  });

  it('throws on missing HUB_ADMIN_TOKEN when required', () => {
    delete process.env.HUB_ADMIN_TOKEN;
    expect(() => loadConfig({ requireAdminToken: true }))
      .toThrow(/HUB_ADMIN_TOKEN/);
  });

  it('disables LLM learner when ANTHROPIC_API_KEY missing', () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(loadConfig().llmLearnerEnabled).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/hub/config.test.ts`
Expected: FAIL — "Cannot find module".

- [ ] **Step 3: Implement config**

Create `src/hub/config.ts`:
```typescript
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface HubConfig {
  port: number;
  bind: string;
  dbPath: string;
  adminToken: string | null;
  llmLearnerEnabled: boolean;
  anthropicApiKey: string | null;
  disabledRules: Set<string>;
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
  return { port, bind, dbPath, adminToken, llmLearnerEnabled,
           anthropicApiKey, disabledRules };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/hub/config.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

Run: `git add src/hub/config.ts tests/hub/config.test.ts && git commit -m "hub: env-driven config module"`

---

### Task 1.3: Drizzle schema for all 10 tables

**Files:**
- Create: `src/hub/db/schema.ts`
- Create: `drizzle.config.ts`

- [ ] **Step 1: Write Drizzle schema**

Create `src/hub/db/schema.ts`:
```typescript
import { sqliteTable, text, integer, real, primaryKey, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const d2pInstances = sqliteTable('d2p_instances', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull(),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  lastSeenAt: text('last_seen_at'),
});

export const runs = sqliteTable('runs', {
  id: text('id').primaryKey(),
  instanceId: text('instance_id').notNull().references(() => d2pInstances.id),
  projectPath: text('project_path').notNull(),
  detectedArchetype: text('detected_archetype'),
  startedAt: text('started_at').notNull(),
  terminatedAt: text('terminated_at'),
  terminalState: text('terminal_state'),
  totalCostUsd: real('total_cost_usd').default(0),
  totalIterations: integer('total_iterations').default(0),
}, (t) => ({
  byInstanceTime: index('runs_instance_time').on(t.instanceId, t.startedAt),
  byArchetypeState: index('runs_archetype_state').on(t.detectedArchetype, t.terminalState),
}));

export const iterations = sqliteTable('iterations', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull().references(() => runs.id),
  iterN: integer('iter_n').notNull(),
  startedAt: text('started_at').notNull(),
  endedAt: text('ended_at'),
  analyzerSummary: text('analyzer_summary'),
  plannerSummary: text('planner_summary'),
  executorSummary: text('executor_summary'),
  qaSummary: text('qa_summary'),
}, (t) => ({
  byRun: index('iter_by_run').on(t.runId, t.iterN),
}));

export const standards = sqliteTable('standards', {
  id: text('id').primaryKey(),
  archetype: text('archetype').notNull(),
  version: integer('version').notNull(),
  bodyMd: text('body_md').notNull(),
  isCurrent: integer('is_current', { mode: 'boolean' }).notNull(),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  approvedBy: text('approved_by'),
  source: text('source').notNull(),
}, (t) => ({
  byArchetypeCurrent: index('standards_arche_current').on(t.archetype, t.isCurrent),
}));

export const standardVersions = sqliteTable('standard_versions', {
  id: text('id').primaryKey(),
  standardsId: text('standards_id').notNull().references(() => standards.id),
  version: integer('version').notNull(),
  bodyMd: text('body_md').notNull(),
  diffFromPrevMd: text('diff_from_prev_md'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const verdicts = sqliteTable('verdicts', {
  id: text('id').primaryKey(),
  iterationId: text('iteration_id').notNull().references(() => iterations.id),
  verdict: text('verdict').notNull(),
  confidence: real('confidence'),
  stabilitySignal: text('stability_signal'),
  suggestedNextFocus: text('suggested_next_focus'),
  rawResponse: text('raw_response'),
  standardsVersionId: text('standards_version_id').references(() => standardVersions.id),
});

export const findings = sqliteTable('findings', {
  id: text('id').primaryKey(),
  verdictId: text('verdict_id').notNull().references(() => verdicts.id),
  category: text('category').notNull(),
  severity: text('severity').notNull(),
  message: text('message'),
  evidence: text('evidence'),
  isNew: integer('is_new', { mode: 'boolean' }).notNull(),
}, (t) => ({
  byCatSev: index('findings_cat_sev').on(t.category, t.severity),
  byVerdict: index('findings_by_verdict').on(t.verdictId),
}));

export const proposals = sqliteTable('proposals', {
  id: text('id').primaryKey(),
  archetype: text('archetype').notNull(),
  proposalType: text('proposal_type').notNull(),
  bodyMd: text('body_md').notNull(),
  rationaleMd: text('rationale_md').notNull(),
  source: text('source').notNull(),
  status: text('status').notNull().default('pending'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  decidedAt: text('decided_at'),
  decidedBy: text('decided_by'),
  resultingStandardVersionId: text('resulting_standard_version_id')
    .references(() => standardVersions.id),
}, (t) => ({
  byStatusArchetype: index('proposals_status_arche').on(t.status, t.archetype),
}));

export const proposalEvidence = sqliteTable('proposal_evidence', {
  proposalId: text('proposal_id').notNull().references(() => proposals.id),
  findingId: text('finding_id').notNull().references(() => findings.id),
}, (t) => ({
  pk: primaryKey({ columns: [t.proposalId, t.findingId] }),
}));

export const mentorNotes = sqliteTable('mentor_notes', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull().references(() => runs.id),
  author: text('author').notNull(),
  bodyMd: text('body_md').notNull(),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const events = sqliteTable('events', {
  id: text('id').primaryKey(),
  instanceId: text('instance_id').notNull().references(() => d2pInstances.id),
  eventType: text('event_type').notNull(),
  payload: text('payload').notNull(),
  payloadHash: text('payload_hash').notNull(),
  receivedAt: text('received_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => ({
  byTime: index('events_time').on(t.receivedAt),
  uniqDedup: uniqueIndex('events_dedup').on(t.instanceId, t.eventType, t.payloadHash),
}));
```

- [ ] **Step 2: Create drizzle.config.ts at repo root**

```typescript
import type { Config } from 'drizzle-kit';

export default {
  schema: './src/hub/db/schema.ts',
  out: './src/hub/db/migrations',
  dialect: 'sqlite',
} satisfies Config;
```

- [ ] **Step 3: Generate initial migration**

Run: `pnpm exec drizzle-kit generate --name init`
Then: `ls src/hub/db/migrations`
Expected: `0000_*.sql` and `meta/` directory created.

- [ ] **Step 4: Commit**

Run: `git add src/hub/db/schema.ts drizzle.config.ts src/hub/db/migrations && git commit -m "hub: drizzle schema + initial migration"`

---

### Task 1.4: DB client + migrations runner

**Files:**
- Create: `src/hub/db/client.ts`
- Create: `tests/hub/db.test.ts`
- Modify: `scripts/copy-assets.mjs` (if exists; else create)

- [ ] **Step 1: Write the failing test**

Create `tests/hub/db.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, migrate } from '../../src/hub/db/client.js';
import { d2pInstances, runs } from '../../src/hub/db/schema.js';
import { randomUUID } from 'node:crypto';

describe('db client', () => {
  let dbPath: string;
  beforeEach(() => {
    dbPath = join(mkdtempSync(join(tmpdir(), 'hub-db-')), 'test.db');
  });

  it('migrate creates tables', () => {
    const { sqlite } = openDb(dbPath);
    migrate(sqlite);
    const tables = sqlite.prepare(
      "SELECT name FROM sqlite_master WHERE type='table'"
    ).all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain('d2p_instances');
    expect(names).toContain('runs');
    expect(names).toContain('findings');
    expect(names).toContain('proposals');
    expect(names).toContain('events');
  });

  it('insert and select round-trips', () => {
    const { db, sqlite } = openDb(dbPath);
    migrate(sqlite);
    const instId = randomUUID();
    db.insert(d2pInstances).values({
      id: instId, name: 'dev', tokenHash: 'xxx',
    }).run();
    const runId = randomUUID();
    db.insert(runs).values({
      id: runId, instanceId: instId, projectPath: '/tmp/p',
      startedAt: new Date().toISOString(),
    }).run();
    const got = db.select().from(runs).all();
    expect(got).toHaveLength(1);
    expect(got[0].id).toBe(runId);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/hub/db.test.ts`
Expected: FAIL — "Cannot find module".

- [ ] **Step 3: Implement client**

Create `src/hub/db/client.ts`:
```typescript
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from './schema.js';

export interface DbHandle {
  db: BetterSQLite3Database<typeof schema>;
  sqlite: Database.Database;
}

export function openDb(path: string): DbHandle {
  mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}

export function migrate(sqlite: Database.Database) {
  const here = dirname(fileURLToPath(import.meta.url));
  const dir = join(here, 'migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    const sqlText = readFileSync(join(dir, f), 'utf-8');
    sqlite.exec(sqlText);
  }
}
```

- [ ] **Step 4: Ensure migrations are copied into dist on build**

If `scripts/copy-assets.mjs` doesn't exist, create it:
```javascript
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const dest = join(root, 'dist', 'hub', 'db', 'migrations');
const src = join(root, 'src', 'hub', 'db', 'migrations');
if (existsSync(src)) {
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true });
  console.log('Copied migrations to', dest);
}
```

If it already exists, add the above logic to it (don't overwrite existing copies).

- [ ] **Step 5: Run test**

Run: `pnpm exec vitest run tests/hub/db.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

Run: `git add src/hub/db/client.ts tests/hub/db.test.ts scripts/copy-assets.mjs && git commit -m "hub: db client (better-sqlite3 + drizzle) with migrations runner"`

---

### Task 1.5: Payload hash helper

**Files:**
- Create: `src/hub/ingest/payloadHash.ts`
- Create: `tests/hub/payloadHash.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/hub/payloadHash.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { payloadHash } from '../../src/hub/ingest/payloadHash.js';

describe('payloadHash', () => {
  it('is deterministic for same payload', () => {
    const p = { foo: 1, bar: 'x' };
    expect(payloadHash(p)).toBe(payloadHash(p));
  });
  it('is key-order independent', () => {
    expect(payloadHash({ a: 1, b: 2 })).toBe(payloadHash({ b: 2, a: 1 }));
  });
  it('changes when payload changes', () => {
    expect(payloadHash({ a: 1 })).not.toBe(payloadHash({ a: 2 }));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/hub/payloadHash.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/hub/ingest/payloadHash.ts`:
```typescript
import { createHash } from 'node:crypto';

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  const keys = Object.keys(v as object).sort();
  return '{' + keys.map(
    (k) => JSON.stringify(k) + ':' + stableStringify((v as any)[k]),
  ).join(',') + '}';
}

export function payloadHash(payload: unknown): string {
  return createHash('sha256').update(stableStringify(payload)).digest('hex');
}
```

- [ ] **Step 4: Run test**

Run: `pnpm exec vitest run tests/hub/payloadHash.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

Run: `git add src/hub/ingest/payloadHash.ts tests/hub/payloadHash.test.ts && git commit -m "hub: stable payload hash for event dedup"`

---

### Task 1.6: Auth middleware

**Files:**
- Create: `src/hub/auth.ts`
- Create: `tests/hub/auth.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/hub/auth.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import bcrypt from 'bcryptjs';
import { bearerAuth } from '../../src/hub/auth.js';

describe('bearerAuth', () => {
  const hash = bcrypt.hashSync('secret-token', 4);
  const instances = [{ id: 'inst-1', name: 'dev', tokenHash: hash }];

  function app() {
    const a = new Hono();
    a.use('*', bearerAuth(async (token) => {
      for (const i of instances) {
        if (bcrypt.compareSync(token, i.tokenHash)) return i;
      }
      return null;
    }));
    a.get('/ok', (c) => c.json({ instance: c.get('instance' as never) }));
    return a;
  }

  it('401 without header', async () => {
    const res = await app().request('/ok');
    expect(res.status).toBe(401);
  });

  it('401 with wrong token', async () => {
    const res = await app().request('/ok', {
      headers: { Authorization: 'Bearer wrong' },
    });
    expect(res.status).toBe(401);
  });

  it('200 with valid token, attaches instance', async () => {
    const res = await app().request('/ok', {
      headers: { Authorization: 'Bearer secret-token' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.instance.id).toBe('inst-1');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/hub/auth.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement auth**

Create `src/hub/auth.ts`:
```typescript
import type { MiddlewareHandler } from 'hono';

export interface InstanceInfo { id: string; name: string; tokenHash: string }
export type InstanceLookup = (token: string) => Promise<InstanceInfo | null>;

export function bearerAuth(lookup: InstanceLookup): MiddlewareHandler {
  return async (c, next) => {
    const hdr = c.req.header('Authorization') ?? '';
    const m = /^Bearer\s+(.+)$/i.exec(hdr);
    if (!m) return c.json({ error: 'missing bearer' }, 401);
    const inst = await lookup(m[1]);
    if (!inst) return c.json({ error: 'invalid token' }, 401);
    c.set('instance' as never, inst);
    await next();
  };
}

export function adminAuth(expected: string | null): MiddlewareHandler {
  return async (c, next) => {
    if (!expected) return c.json({ error: 'admin disabled' }, 503);
    const hdr = c.req.header('Authorization') ?? '';
    if (hdr !== `Bearer ${expected}`) return c.json({ error: 'forbidden' }, 403);
    await next();
  };
}
```

- [ ] **Step 4: Run test**

Run: `pnpm exec vitest run tests/hub/auth.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

Run: `git add src/hub/auth.ts tests/hub/auth.test.ts && git commit -m "hub: bearer + admin auth middleware"`

---

### Task 1.7: Server skeleton + entrypoint

**Files:**
- Create: `src/hub/server.ts`
- Create: `src/hub/index.ts`
- Create: `tests/hub/server.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/hub/server.test.ts`:
```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../../src/hub/server.js';
import { openDb, migrate } from '../../src/hub/db/client.js';

describe('server skeleton', () => {
  let app: ReturnType<typeof buildApp>;
  beforeAll(() => {
    const dbPath = join(mkdtempSync(join(tmpdir(), 'srv-')), 'h.db');
    const handle = openDb(dbPath);
    migrate(handle.sqlite);
    app = buildApp(handle, { adminToken: 'admin-secret' });
  });

  it('GET /admin/health returns 403 without token', async () => {
    const res = await app.request('/admin/health');
    expect(res.status).toBe(403);
  });

  it('GET /admin/health returns 200 with admin token', async () => {
    const res = await app.request('/admin/health', {
      headers: { Authorization: 'Bearer admin-secret' },
    });
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.db_ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/hub/server.test.ts`
Expected: FAIL — "Cannot find module".

- [ ] **Step 3: Implement server skeleton**

Create `src/hub/server.ts`:
```typescript
import { Hono } from 'hono';
import type { DbHandle } from './db/client.js';
import { adminAuth } from './auth.js';

export interface AppOpts {
  adminToken: string | null;
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

  return app;
}
```

- [ ] **Step 4: Create entrypoint**

Create `src/hub/index.ts`:
```typescript
import { serve } from '@hono/node-server';
import { openDb, migrate } from './db/client.js';
import { loadConfig } from './config.js';
import { buildApp } from './server.js';

async function main() {
  const cfg = loadConfig({ requireAdminToken: true });
  const handle = openDb(cfg.dbPath);
  migrate(handle.sqlite);
  const app = buildApp(handle, { adminToken: cfg.adminToken });
  serve({ fetch: app.fetch, port: cfg.port, hostname: cfg.bind }, (info) => {
    process.stderr.write(`MatrixOmnix Hub listening on http://${cfg.bind}:${info.port}\n`);
  });
}

main().catch((e) => {
  process.stderr.write(`hub fatal: ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
  process.exit(1);
});
```

- [ ] **Step 5: Run test**

Run: `pnpm exec vitest run tests/hub/server.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

Run: `git add src/hub/server.ts src/hub/index.ts tests/hub/server.test.ts && git commit -m "hub: server skeleton + /admin/health + entrypoint"`

---

---

## Phase 2 — Events ingest + standards pull (d2p-facing API)

### Task 2.1: Instance lookup helper

**Files:**
- Create: `src/hub/instanceLookup.ts`
- Create: `tests/hub/instanceLookup.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/hub/instanceLookup.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { openDb, migrate } from '../../src/hub/db/client.js';
import { d2pInstances } from '../../src/hub/db/schema.js';
import { makeInstanceLookup } from '../../src/hub/instanceLookup.js';

describe('instance lookup', () => {
  let handle: ReturnType<typeof openDb>;
  beforeEach(() => {
    const p = join(mkdtempSync(join(tmpdir(), 'il-')), 'h.db');
    handle = openDb(p);
    migrate(handle.sqlite);
    handle.db.insert(d2pInstances).values({
      id: randomUUID(), name: 'dev',
      tokenHash: bcrypt.hashSync('plaintext-token', 4),
    }).run();
  });

  it('returns instance for valid token', async () => {
    const lookup = makeInstanceLookup(handle);
    const i = await lookup('plaintext-token');
    expect(i?.name).toBe('dev');
  });

  it('returns null for unknown token', async () => {
    const lookup = makeInstanceLookup(handle);
    expect(await lookup('wrong')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/hub/instanceLookup.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/hub/instanceLookup.ts`:
```typescript
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import type { DbHandle } from './db/client.js';
import { d2pInstances } from './db/schema.js';
import type { InstanceLookup, InstanceInfo } from './auth.js';

export function makeInstanceLookup(handle: DbHandle): InstanceLookup {
  return async (token: string): Promise<InstanceInfo | null> => {
    const rows = handle.db.select().from(d2pInstances).all();
    for (const r of rows) {
      if (bcrypt.compareSync(token, r.tokenHash)) {
        handle.db.update(d2pInstances)
          .set({ lastSeenAt: new Date().toISOString() })
          .where(eq(d2pInstances.id, r.id))
          .run();
        return { id: r.id, name: r.name, tokenHash: r.tokenHash };
      }
    }
    return null;
  };
}
```

- [ ] **Step 4: Run test**

Run: `pnpm exec vitest run tests/hub/instanceLookup.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

Run: `git add src/hub/instanceLookup.ts tests/hub/instanceLookup.test.ts && git commit -m "hub: instance lookup with bcrypt + last_seen update"`

---

### Task 2.2: POST /events route

**Files:**
- Create: `src/hub/routes/events.ts`
- Create: `src/hub/ingest/eventHandlers.ts` (stub for this task)
- Modify: `src/hub/server.ts`
- Create: `tests/hub/routes.events.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/hub/routes.events.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { openDb, migrate } from '../../src/hub/db/client.js';
import { d2pInstances, events } from '../../src/hub/db/schema.js';
import { buildApp } from '../../src/hub/server.js';

describe('POST /events', () => {
  let handle: ReturnType<typeof openDb>;
  let app: ReturnType<typeof buildApp>;
  const TOKEN = 'tk-secret';

  beforeEach(() => {
    const p = join(mkdtempSync(join(tmpdir(), 'evt-')), 'h.db');
    handle = openDb(p);
    migrate(handle.sqlite);
    handle.db.insert(d2pInstances).values({
      id: randomUUID(), name: 'dev', tokenHash: bcrypt.hashSync(TOKEN, 4),
    }).run();
    app = buildApp(handle, { adminToken: 'a' });
  });

  it('401 without bearer', async () => {
    const r = await app.request('/events', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'run_started', run_id: 'r1', payload: {} }),
    });
    expect(r.status).toBe(401);
  });

  it('200 inserts event', async () => {
    const r = await app.request('/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ type: 'run_started', run_id: 'r1', payload: { foo: 1 } }),
    });
    expect(r.status).toBe(200);
    const rows = handle.db.select().from(events).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].eventType).toBe('run_started');
  });

  it('duplicate same-payload is de-duped', async () => {
    const body = JSON.stringify({ type: 'iteration_complete', run_id: 'r1', payload: { iter: 1 } });
    const headers = { 'content-type': 'application/json', Authorization: `Bearer ${TOKEN}` };
    await app.request('/events', { method: 'POST', headers, body });
    await app.request('/events', { method: 'POST', headers, body });
    const rows = handle.db.select().from(events).all();
    expect(rows).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/hub/routes.events.test.ts`
Expected: FAIL — route not mounted.

- [ ] **Step 3: Create stub handler dispatcher**

Create `src/hub/ingest/eventHandlers.ts`:
```typescript
import type { DbHandle } from '../db/client.js';
import type { InstanceInfo } from '../auth.js';

export function dispatchIngest(
  _handle: DbHandle, _inst: InstanceInfo,
  _type: string, _runId: string, _payload: Record<string, any>,
): void {
  // wired per-event-type in Task 2.3
}
```

- [ ] **Step 4: Implement events route**

Create `src/hub/routes/events.ts`:
```typescript
import { Hono } from 'hono';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { DbHandle } from '../db/client.js';
import { events } from '../db/schema.js';
import { bearerAuth, type InstanceLookup, type InstanceInfo } from '../auth.js';
import { payloadHash } from '../ingest/payloadHash.js';
import { dispatchIngest } from '../ingest/eventHandlers.js';

const EventBody = z.object({
  type: z.enum([
    'run_started', 'iteration_complete', 'verdict_emitted',
    'finding_recorded', 'run_terminated',
  ]),
  run_id: z.string(),
  payload: z.record(z.any()),
});

export function eventsRoute(handle: DbHandle, lookup: InstanceLookup) {
  const r = new Hono();
  r.post('/events', bearerAuth(lookup), async (c) => {
    const parsed = EventBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'bad payload' }, 400);
    const { type, run_id, payload } = parsed.data;
    const inst = c.get('instance' as never) as InstanceInfo;
    const id = randomUUID();
    const hash = payloadHash({ run_id, ...payload });

    try {
      handle.db.insert(events).values({
        id,
        instanceId: inst.id,
        eventType: type,
        payload: JSON.stringify({ run_id, ...payload }),
        payloadHash: hash,
      }).run();
    } catch (e: any) {
      if (String(e?.message ?? '').includes('UNIQUE')) {
        return c.json({ event_id: null, deduped: true });
      }
      throw e;
    }

    dispatchIngest(handle, inst, type, run_id, payload);
    return c.json({ event_id: id });
  });
  return r;
}
```

- [ ] **Step 5: Mount in `src/hub/server.ts`**

Modify `src/hub/server.ts` — add imports and mount inside `buildApp`:
```typescript
import { eventsRoute } from './routes/events.js';
import { makeInstanceLookup } from './instanceLookup.js';

// inside buildApp, before `return app`:
const lookup = makeInstanceLookup(handle);
app.route('/', eventsRoute(handle, lookup));
```

- [ ] **Step 6: Run test**

Run: `pnpm exec vitest run tests/hub/routes.events.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 7: Commit**

Run: `git add src/hub/routes/events.ts src/hub/ingest/eventHandlers.ts src/hub/server.ts tests/hub/routes.events.test.ts && git commit -m "hub: POST /events with bearer + UNIQUE dedup"`

---

### Task 2.3: Event handlers — derive runs/iterations/verdicts/findings

**Files:**
- Modify: `src/hub/ingest/eventHandlers.ts`
- Create: `tests/hub/eventHandlers.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/hub/eventHandlers.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDb, migrate } from '../../src/hub/db/client.js';
import {
  d2pInstances, runs, iterations, verdicts, findings,
} from '../../src/hub/db/schema.js';
import { dispatchIngest } from '../../src/hub/ingest/eventHandlers.js';

describe('event handlers', () => {
  let handle: ReturnType<typeof openDb>;
  let inst: { id: string; name: string; tokenHash: string };
  beforeEach(() => {
    const p = join(mkdtempSync(join(tmpdir(), 'eh-')), 'h.db');
    handle = openDb(p);
    migrate(handle.sqlite);
    inst = { id: randomUUID(), name: 'dev', tokenHash: 'x' };
    handle.db.insert(d2pInstances).values(inst).run();
  });

  it('run_started upserts a run', () => {
    dispatchIngest(handle, inst, 'run_started', 'run-1', {
      project_path: '/p', detected_archetype: 'fastapi-api',
      started_at: '2026-05-25T10:00:00Z',
    });
    const r = handle.db.select().from(runs).all();
    expect(r).toHaveLength(1);
    expect(r[0].terminalState).toBe('RUNNING');
  });

  it('iteration_complete out-of-order creates placeholder then fills', () => {
    dispatchIngest(handle, inst, 'iteration_complete', 'run-2', {
      iter_n: 1, started_at: 't1', ended_at: 't2',
    });
    dispatchIngest(handle, inst, 'run_started', 'run-2', {
      project_path: '/q', detected_archetype: 'node-server',
      started_at: 't0',
    });
    const r = handle.db.select().from(runs).all();
    expect(r).toHaveLength(1);
    expect(r[0].projectPath).toBe('/q');
    expect(handle.db.select().from(iterations).all()).toHaveLength(1);
  });

  it('verdict + finding chain inserts correctly', () => {
    dispatchIngest(handle, inst, 'run_started', 'r3', {
      project_path: '/p', started_at: 't0',
    });
    dispatchIngest(handle, inst, 'iteration_complete', 'r3', {
      iter_n: 1, started_at: 't1', ended_at: 't2',
    });
    dispatchIngest(handle, inst, 'verdict_emitted', 'r3', {
      iter_n: 1, verdict: 'needs_repair', confidence: 0.7,
      stability_signal: 'new_findings',
    });
    dispatchIngest(handle, inst, 'finding_recorded', 'r3', {
      iter_n: 1, category: 'missing_env_example',
      severity: 'low', message: 'no .env.example', is_new: true,
    });
    expect(handle.db.select().from(verdicts).all()).toHaveLength(1);
    const f = handle.db.select().from(findings).all();
    expect(f).toHaveLength(1);
    expect(f[0].category).toBe('missing_env_example');
  });

  it('run_terminated sets terminal_state + totals', () => {
    dispatchIngest(handle, inst, 'run_started', 'r4', {
      project_path: '/p', started_at: 't0',
    });
    dispatchIngest(handle, inst, 'run_terminated', 'r4', {
      terminal_state: 'CLEAN', terminated_at: 't9',
      total_cost_usd: 1.20, total_iterations: 6,
    });
    const r = handle.db.select().from(runs).all();
    expect(r[0].terminalState).toBe('CLEAN');
    expect(r[0].totalIterations).toBe(6);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/hub/eventHandlers.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement handlers**

Replace `src/hub/ingest/eventHandlers.ts`:
```typescript
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
```

- [ ] **Step 4: Run test**

Run: `pnpm exec vitest run tests/hub/eventHandlers.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

Run: `git add src/hub/ingest/eventHandlers.ts tests/hub/eventHandlers.test.ts && git commit -m "hub: ingest handlers (upsert runs/iters/verdicts/findings; tolerate out-of-order)"`

---

### Task 2.4: GET /standards/:archetype with ETag

**Files:**
- Create: `src/hub/routes/standards.ts`
- Modify: `src/hub/server.ts`
- Create: `tests/hub/routes.standards.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/hub/routes.standards.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDb, migrate } from '../../src/hub/db/client.js';
import { standards } from '../../src/hub/db/schema.js';
import { buildApp } from '../../src/hub/server.js';

describe('GET /standards/:archetype', () => {
  let handle: ReturnType<typeof openDb>;
  let app: ReturnType<typeof buildApp>;
  const archetype = 'fastapi-api';

  beforeEach(() => {
    const p = join(mkdtempSync(join(tmpdir(), 'std-')), 'h.db');
    handle = openDb(p);
    migrate(handle.sqlite);
    handle.db.insert(standards).values({
      id: randomUUID(), archetype, version: 1,
      bodyMd: '# Initial fastapi-api standards\n- tests pass',
      isCurrent: true, source: 'manual',
    }).run();
    app = buildApp(handle, { adminToken: 'a' });
  });

  it('200 returns current body + etag', async () => {
    const res = await app.request(`/standards/${archetype}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('etag')).toBe('1');
    const j = await res.json();
    expect(j.version).toBe(1);
    expect(j.body_md).toMatch(/tests pass/);
  });

  it('304 when If-None-Match matches', async () => {
    const res = await app.request(`/standards/${archetype}`, {
      headers: { 'If-None-Match': '1' },
    });
    expect(res.status).toBe(304);
  });

  it('404 when archetype unknown', async () => {
    const res = await app.request('/standards/unknown-thing');
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/hub/routes.standards.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement standards route**

Create `src/hub/routes/standards.ts`:
```typescript
import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import type { DbHandle } from '../db/client.js';
import { standards } from '../db/schema.js';

export function standardsRoute(handle: DbHandle) {
  const r = new Hono();

  r.get('/standards/:archetype', (c) => {
    const archetype = c.req.param('archetype');
    const row = handle.db.select().from(standards)
      .where(and(eq(standards.archetype, archetype), eq(standards.isCurrent, true)))
      .get();
    if (!row) return c.json({ error: 'unknown archetype' }, 404);
    const etag = String(row.version);
    if (c.req.header('if-none-match') === etag) {
      return new Response(null, { status: 304 });
    }
    c.header('ETag', etag);
    return c.json({ version: row.version, body_md: row.bodyMd, etag });
  });

  return r;
}
```

- [ ] **Step 4: Mount in `src/hub/server.ts`**

Add import and mount:
```typescript
import { standardsRoute } from './routes/standards.js';
// inside buildApp:
app.route('/', standardsRoute(handle));
```

- [ ] **Step 5: Run test**

Run: `pnpm exec vitest run tests/hub/routes.standards.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

Run: `git add src/hub/routes/standards.ts src/hub/server.ts tests/hub/routes.standards.test.ts && git commit -m "hub: GET /standards/:archetype with ETag/304"`

---

### Task 2.5: Seed script — baseline standards + initial instance token

**Files:**
- Create: `src/hub/cli/seed.ts`
- Modify: `package.json` (add `hub:seed` script)

- [ ] **Step 1: Implement seed**

Create `src/hub/cli/seed.ts`:
```typescript
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { openDb, migrate } from '../db/client.js';
import { loadConfig } from '../config.js';
import { standards, d2pInstances } from '../db/schema.js';

const ARCHETYPE_BASELINE: Record<string, string> = {
  'fastapi-api': `# fastapi-api · v1 baseline
- tests_run_and_pass: tests run, not empty
- error_envelope_present: 404 + unhandled exception return structured JSON
- readme_cmd_matches_manifest: README commands match the package manifest
- missing_env_example: a .env.example template exists
- dockerfile_uses_prod_server: Dockerfile uses gunicorn/uvicorn, not dev server
`,
  'node-server': `# node-server · v1 baseline
- tests_run_and_pass
- error_envelope_present
- readme_cmd_matches_manifest
- pinned_production_deps (no "*" in dependencies)
- missing_env_example
`,
  'python-library': `# python-library · v1 baseline
- tests_run_and_pass
- pyproject_complete (name + version + license + classifiers)
- readme_install_command_works
- public_api_documented
`,
  'python-cli': `# python-cli · v1 baseline
- tests_run_and_pass
- cli_help_flag_present (--help works)
- entry_point_declared_in_manifest
- readme_usage_section_present
`,
};

function genToken(len = 32): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

async function main() {
  const cfg = loadConfig();
  const { db, sqlite } = openDb(cfg.dbPath);
  migrate(sqlite);

  for (const [arch, body] of Object.entries(ARCHETYPE_BASELINE)) {
    const existing = db.select().from(standards).where(eq(standards.archetype, arch)).all();
    if (existing.length > 0) { console.log(`skip ${arch} (already seeded)`); continue; }
    db.insert(standards).values({
      id: randomUUID(), archetype: arch, version: 1,
      bodyMd: body, isCurrent: true, source: 'manual', approvedBy: 'seed',
    }).run();
    console.log(`seeded ${arch} v1`);
  }

  const existingInstances = db.select().from(d2pInstances).all();
  if (existingInstances.length === 0) {
    const token = genToken();
    db.insert(d2pInstances).values({
      id: randomUUID(), name: 'default',
      tokenHash: bcrypt.hashSync(token, 8),
    }).run();
    console.log('\n== d2p instance "default" created ==');
    console.log(`HUB_TOKEN=${token}`);
    console.log('Set this in d2p env. It will NOT be shown again.\n');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Add npm script**

Modify `package.json` `scripts` to include:
```json
"hub:seed": "tsx src/hub/cli/seed.ts"
```

- [ ] **Step 3: Smoke test seed (manual; no test commit)**

Run: `HUB_DB_PATH=/tmp/seed-smoke.db pnpm hub:seed`
Then run again: `HUB_DB_PATH=/tmp/seed-smoke.db pnpm hub:seed`
Expected: first run seeds 4 archetypes + prints a token; second run prints "skip" for each archetype and no token.

- [ ] **Step 4: Commit**

Run: `git add src/hub/cli/seed.ts package.json && git commit -m "hub: seed script (baseline standards for 4 archetypes + initial instance token)"`

---

End of Phase 2. The d2p-facing surface now works end-to-end (push events, pull standards, dedup, fail-safe ingest). Phase 3 adds the read APIs the Vue UI needs.

---

## Phase 3 — Read APIs for UI

### Task 3.1: GET /runs list with filters

**Files:**
- Modify: `src/hub/routes/runs.ts` (create)
- Modify: `src/hub/server.ts`
- Create: `tests/hub/routes.runs.list.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/hub/routes.runs.list.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDb, migrate } from '../../src/hub/db/client.js';
import { d2pInstances, runs } from '../../src/hub/db/schema.js';
import { buildApp } from '../../src/hub/server.js';

describe('GET /runs', () => {
  let handle: ReturnType<typeof openDb>;
  let app: ReturnType<typeof buildApp>;
  let instId: string;

  beforeEach(() => {
    const p = join(mkdtempSync(join(tmpdir(), 'rl-')), 'h.db');
    handle = openDb(p);
    migrate(handle.sqlite);
    instId = randomUUID();
    handle.db.insert(d2pInstances).values({
      id: instId, name: 'i1', tokenHash: 'x',
    }).run();
    for (let i = 0; i < 5; i++) {
      handle.db.insert(runs).values({
        id: randomUUID(), instanceId: instId, projectPath: `/p${i}`,
        detectedArchetype: i % 2 === 0 ? 'fastapi-api' : 'node-server',
        startedAt: new Date(Date.now() - i * 60_000).toISOString(),
        terminalState: i === 0 ? 'RUNNING' : 'CLEAN',
      }).run();
    }
    app = buildApp(handle, { adminToken: 'a' });
  });

  it('returns all 5 by default, newest first', async () => {
    const res = await app.request('/runs');
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.items).toHaveLength(5);
    expect(new Date(j.items[0].started_at).getTime())
      .toBeGreaterThanOrEqual(new Date(j.items[1].started_at).getTime());
  });

  it('filters by archetype', async () => {
    const res = await app.request('/runs?archetype=fastapi-api');
    const j = await res.json();
    expect(j.items.every((r: any) => r.detected_archetype === 'fastapi-api')).toBe(true);
  });

  it('filters by state', async () => {
    const res = await app.request('/runs?state=RUNNING');
    const j = await res.json();
    expect(j.items).toHaveLength(1);
  });

  it('limits via limit param', async () => {
    const res = await app.request('/runs?limit=2');
    const j = await res.json();
    expect(j.items).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/hub/routes.runs.list.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement runs route**

Create `src/hub/routes/runs.ts`:
```typescript
import { Hono } from 'hono';
import { and, eq, desc, sql } from 'drizzle-orm';
import type { DbHandle } from '../db/client.js';
import { runs, iterations, verdicts, findings, mentorNotes } from '../db/schema.js';

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
```

- [ ] **Step 4: Mount in server.ts**

Modify `src/hub/server.ts`:
```typescript
import { runsRoute } from './routes/runs.js';
// inside buildApp:
app.route('/', runsRoute(handle));
```

- [ ] **Step 5: Run test**

Run: `pnpm exec vitest run tests/hub/routes.runs.list.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

Run: `git add src/hub/routes/runs.ts src/hub/server.ts tests/hub/routes.runs.list.test.ts && git commit -m "hub: GET /runs with archetype/state/instance/limit filters"`

---

### Task 3.2: GET /runs/:id drill-down

**Files:**
- Modify: `src/hub/routes/runs.ts`
- Create: `tests/hub/routes.runs.detail.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/hub/routes.runs.detail.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDb, migrate } from '../../src/hub/db/client.js';
import { d2pInstances } from '../../src/hub/db/schema.js';
import { buildApp } from '../../src/hub/server.js';
import { dispatchIngest } from '../../src/hub/ingest/eventHandlers.js';

describe('GET /runs/:id', () => {
  let handle: ReturnType<typeof openDb>;
  let app: ReturnType<typeof buildApp>;
  let inst: { id: string; name: string; tokenHash: string };

  beforeEach(() => {
    const p = join(mkdtempSync(join(tmpdir(), 'rd-')), 'h.db');
    handle = openDb(p);
    migrate(handle.sqlite);
    inst = { id: randomUUID(), name: 'i', tokenHash: 'x' };
    handle.db.insert(d2pInstances).values(inst).run();
    app = buildApp(handle, { adminToken: 'a' });
    dispatchIngest(handle, inst, 'run_started', 'r1', {
      project_path: '/p', detected_archetype: 'fastapi-api', started_at: 't0',
    });
    dispatchIngest(handle, inst, 'iteration_complete', 'r1', {
      iter_n: 1, started_at: 't1', ended_at: 't2',
    });
    dispatchIngest(handle, inst, 'verdict_emitted', 'r1', {
      iter_n: 1, verdict: 'needs_repair',
    });
    dispatchIngest(handle, inst, 'finding_recorded', 'r1', {
      iter_n: 1, category: 'missing_env_example', severity: 'low', is_new: true,
    });
  });

  it('404 for unknown', async () => {
    const res = await app.request('/runs/nope');
    expect(res.status).toBe(404);
  });

  it('returns full nested structure', async () => {
    const res = await app.request('/runs/r1');
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.run.id).toBe('r1');
    expect(j.iterations).toHaveLength(1);
    expect(j.verdicts).toHaveLength(1);
    expect(j.findings).toHaveLength(1);
    expect(j.findings[0].category).toBe('missing_env_example');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/hub/routes.runs.detail.test.ts`
Expected: FAIL — route not found.

- [ ] **Step 3: Extend runs route**

Append to `src/hub/routes/runs.ts` (inside `runsRoute`, before `return r;`):
```typescript
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
```

- [ ] **Step 4: Run test**

Run: `pnpm exec vitest run tests/hub/routes.runs.detail.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

Run: `git add src/hub/routes/runs.ts tests/hub/routes.runs.detail.test.ts && git commit -m "hub: GET /runs/:id with nested iterations/verdicts/findings/notes"`

---

### Task 3.3: POST /runs/:id/notes

**Files:**
- Modify: `src/hub/routes/runs.ts`
- Create: `tests/hub/routes.runs.notes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/hub/routes.runs.notes.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDb, migrate } from '../../src/hub/db/client.js';
import { d2pInstances, runs, mentorNotes } from '../../src/hub/db/schema.js';
import { buildApp } from '../../src/hub/server.js';

describe('POST /runs/:id/notes', () => {
  let handle: ReturnType<typeof openDb>;
  let app: ReturnType<typeof buildApp>;
  beforeEach(() => {
    const p = join(mkdtempSync(join(tmpdir(), 'rn-')), 'h.db');
    handle = openDb(p);
    migrate(handle.sqlite);
    const instId = randomUUID();
    handle.db.insert(d2pInstances).values({
      id: instId, name: 'i', tokenHash: 'x',
    }).run();
    handle.db.insert(runs).values({
      id: 'r1', instanceId: instId, projectPath: '/p',
      startedAt: new Date().toISOString(),
    }).run();
    app = buildApp(handle, { adminToken: 'a' });
  });

  it('inserts a human note', async () => {
    const res = await app.request('/runs/r1/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body_md: 'looks good', author: 'human' }),
    });
    expect(res.status).toBe(200);
    const rows = handle.db.select().from(mentorNotes).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].bodyMd).toBe('looks good');
  });

  it('400 if body_md missing', async () => {
    const res = await app.request('/runs/r1/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/hub/routes.runs.notes.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Append to `src/hub/routes/runs.ts`:
```typescript
import { z } from 'zod';
const NoteBody = z.object({ body_md: z.string().min(1), author: z.enum(['human', 'llm']).default('human') });

// inside runsRoute, before return:
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
```
(Don't forget to add `randomUUID` import at top of file if not present.)

- [ ] **Step 4: Run test**

Run: `pnpm exec vitest run tests/hub/routes.runs.notes.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

Run: `git add src/hub/routes/runs.ts tests/hub/routes.runs.notes.test.ts && git commit -m "hub: POST /runs/:id/notes for human/llm mentor notes"`

---

### Task 3.4: Standards list + history endpoints

**Files:**
- Modify: `src/hub/routes/standards.ts`
- Create: `tests/hub/routes.standards.list.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/hub/routes.standards.list.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDb, migrate } from '../../src/hub/db/client.js';
import { standards, standardVersions } from '../../src/hub/db/schema.js';
import { buildApp } from '../../src/hub/server.js';

describe('standards list + history', () => {
  let handle: ReturnType<typeof openDb>;
  let app: ReturnType<typeof buildApp>;
  let stdId: string;

  beforeEach(() => {
    const p = join(mkdtempSync(join(tmpdir(), 'sl-')), 'h.db');
    handle = openDb(p);
    migrate(handle.sqlite);
    stdId = randomUUID();
    handle.db.insert(standards).values({
      id: stdId, archetype: 'fastapi-api', version: 2,
      bodyMd: '- v2 content', isCurrent: true, source: 'rule',
    }).run();
    handle.db.insert(standardVersions).values({
      id: randomUUID(), standardsId: stdId, version: 1, bodyMd: '- v1 content',
    }).run();
    handle.db.insert(standardVersions).values({
      id: randomUUID(), standardsId: stdId, version: 2, bodyMd: '- v2 content',
      diffFromPrevMd: '+ new line',
    }).run();
    app = buildApp(handle, { adminToken: 'a' });
  });

  it('GET /standards returns list of archetypes', async () => {
    const res = await app.request('/standards');
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.items).toHaveLength(1);
    expect(j.items[0].archetype).toBe('fastapi-api');
    expect(j.items[0].current_version).toBe(2);
  });

  it('GET /standards/:archetype/history returns version log', async () => {
    const res = await app.request('/standards/fastapi-api/history');
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.versions).toHaveLength(2);
    expect(j.versions[0].version).toBeGreaterThan(j.versions[1].version);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/hub/routes.standards.list.test.ts`
Expected: FAIL.

- [ ] **Step 3: Extend standards route**

Append inside `standardsRoute` in `src/hub/routes/standards.ts`:
```typescript
import { desc } from 'drizzle-orm';
import { standardVersions, proposals } from '../db/schema.js';

// inside standardsRoute, before return r:
r.get('/standards', (c) => {
  const rows = handle.db.select().from(standards).where(eq(standards.isCurrent, true)).all();
  const items = rows.map((row) => {
    const vcount = handle.db.select().from(standardVersions)
      .where(eq(standardVersions.standardsId, row.id)).all().length;
    return {
      archetype: row.archetype,
      current_version: row.version,
      version_count: Math.max(vcount, 1),
    };
  });
  return c.json({ items });
});

r.get('/standards/:archetype/history', (c) => {
  const archetype = c.req.param('archetype');
  const std = handle.db.select().from(standards)
    .where(eq(standards.archetype, archetype)).get();
  if (!std) return c.json({ error: 'unknown archetype' }, 404);
  const versions = handle.db.select().from(standardVersions)
    .where(eq(standardVersions.standardsId, std.id))
    .orderBy(desc(standardVersions.version)).all();
  const pending = handle.db.select().from(proposals)
    .where(and(eq(proposals.archetype, archetype), eq(proposals.status, 'pending'))).all();
  return c.json({
    versions: versions.map((v) => ({
      id: v.id, version: v.version, body_md: v.bodyMd,
      diff_from_prev_md: v.diffFromPrevMd, created_at: v.createdAt,
    })),
    proposals: pending.map((p) => ({
      id: p.id, proposal_type: p.proposalType, body_md: p.bodyMd,
      created_at: p.createdAt,
    })),
  });
});
```

- [ ] **Step 4: Run test**

Run: `pnpm exec vitest run tests/hub/routes.standards.list.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

Run: `git add src/hub/routes/standards.ts tests/hub/routes.standards.list.test.ts && git commit -m "hub: GET /standards (list) + /standards/:archetype/history"`

---

### Task 3.5: Proposals list/detail/decision endpoints

**Files:**
- Create: `src/hub/routes/proposals.ts`
- Modify: `src/hub/server.ts`
- Create: `tests/hub/routes.proposals.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/hub/routes.proposals.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDb, migrate } from '../../src/hub/db/client.js';
import { standards, proposals } from '../../src/hub/db/schema.js';
import { buildApp } from '../../src/hub/server.js';

describe('proposals routes', () => {
  let handle: ReturnType<typeof openDb>;
  let app: ReturnType<typeof buildApp>;
  let propId: string;

  beforeEach(() => {
    const p = join(mkdtempSync(join(tmpdir(), 'pr-')), 'h.db');
    handle = openDb(p);
    migrate(handle.sqlite);
    handle.db.insert(standards).values({
      id: randomUUID(), archetype: 'fastapi-api', version: 1,
      bodyMd: '# baseline\n- tests', isCurrent: true, source: 'manual',
    }).run();
    propId = randomUUID();
    handle.db.insert(proposals).values({
      id: propId, archetype: 'fastapi-api', proposalType: 'add_check',
      bodyMd: 'cors_policy_explicit', rationaleMd: 'seen 7/10 runs',
      source: 'rule', status: 'pending',
    }).run();
    app = buildApp(handle, { adminToken: 'a' });
  });

  it('GET /proposals returns pending', async () => {
    const res = await app.request('/proposals?status=pending');
    const j = await res.json();
    expect(j.items).toHaveLength(1);
    expect(j.items[0].id).toBe(propId);
  });

  it('GET /proposals/:id returns full', async () => {
    const res = await app.request(`/proposals/${propId}`);
    const j = await res.json();
    expect(j.proposal.archetype).toBe('fastapi-api');
  });

  it('POST decision approve creates new standards version', async () => {
    const res = await app.request(`/proposals/${propId}/decision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'approve' }),
    });
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.new_standard_version_id).toBeTruthy();
    const std = handle.db.select().from(standards).all();
    expect(std[0].version).toBe(2);
    const p = handle.db.select().from(proposals).all();
    expect(p[0].status).toBe('approved');
  });

  it('POST decision reject marks rejected, no new version', async () => {
    const res = await app.request(`/proposals/${propId}/decision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'reject', note: 'too noisy' }),
    });
    expect(res.status).toBe(200);
    const p = handle.db.select().from(proposals).all();
    expect(p[0].status).toBe('rejected');
    const std = handle.db.select().from(standards).all();
    expect(std[0].version).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/hub/routes.proposals.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement proposals route**

Create `src/hub/routes/proposals.ts`:
```typescript
import { Hono } from 'hono';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { and, eq, desc } from 'drizzle-orm';
import type { DbHandle } from '../db/client.js';
import { proposals, proposalEvidence, standards, standardVersions, findings } from '../db/schema.js';

const DecisionBody = z.object({
  decision: z.enum(['approve', 'reject']),
  note: z.string().optional(),
  edited_body_md: z.string().optional(),
});

export function proposalsRoute(handle: DbHandle) {
  const r = new Hono();

  r.get('/proposals', (c) => {
    const status = c.req.query('status') ?? 'pending';
    const archetype = c.req.query('archetype');
    const conds = [eq(proposals.status, status)];
    if (archetype) conds.push(eq(proposals.archetype, archetype));
    const rows = handle.db.select().from(proposals)
      .where(and(...conds)).orderBy(desc(proposals.createdAt)).all();
    return c.json({
      items: rows.map((p) => ({
        id: p.id, archetype: p.archetype, proposal_type: p.proposalType,
        body_md: p.bodyMd, rationale_md: p.rationaleMd, source: p.source,
        status: p.status, created_at: p.createdAt,
      })),
    });
  });

  r.get('/proposals/:id', (c) => {
    const id = c.req.param('id');
    const p = handle.db.select().from(proposals).where(eq(proposals.id, id)).get();
    if (!p) return c.json({ error: 'not found' }, 404);
    const links = handle.db.select().from(proposalEvidence)
      .where(eq(proposalEvidence.proposalId, id)).all();
    const evidenceFindings = [];
    for (const l of links) {
      const f = handle.db.select().from(findings).where(eq(findings.id, l.findingId)).get();
      if (f) evidenceFindings.push({
        id: f.id, category: f.category, severity: f.severity,
        message: f.message, evidence: f.evidence,
      });
    }
    return c.json({
      proposal: {
        id: p.id, archetype: p.archetype, proposal_type: p.proposalType,
        body_md: p.bodyMd, rationale_md: p.rationaleMd, source: p.source,
        status: p.status, created_at: p.createdAt,
        decided_at: p.decidedAt, decided_by: p.decidedBy,
      },
      evidence: evidenceFindings,
    });
  });

  r.post('/proposals/:id/decision', async (c) => {
    const id = c.req.param('id');
    const parsed = DecisionBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'bad body' }, 400);
    const p = handle.db.select().from(proposals).where(eq(proposals.id, id)).get();
    if (!p) return c.json({ error: 'not found' }, 404);
    if (p.status !== 'pending') return c.json({ error: 'not pending' }, 409);

    if (parsed.data.decision === 'reject') {
      handle.db.update(proposals).set({
        status: 'rejected',
        decidedAt: new Date().toISOString(),
        decidedBy: 'human',
      }).where(eq(proposals.id, id)).run();
      return c.json({ new_standard_version_id: null });
    }

    const std = handle.db.select().from(standards)
      .where(and(eq(standards.archetype, p.archetype), eq(standards.isCurrent, true))).get();
    if (!std) return c.json({ error: 'no current standards for archetype' }, 500);
    const newVersion = std.version + 1;
    const newBody = (parsed.data.edited_body_md ?? std.bodyMd + '\n' + p.bodyMd);
    const versionId = randomUUID();
    handle.db.insert(standardVersions).values({
      id: versionId, standardsId: std.id, version: newVersion,
      bodyMd: newBody, diffFromPrevMd: `+ ${p.bodyMd}`,
    }).run();
    handle.db.update(standards).set({
      version: newVersion, bodyMd: newBody,
      source: parsed.data.edited_body_md ? 'manual' : p.source,
      approvedBy: 'human',
    }).where(eq(standards.id, std.id)).run();
    handle.db.update(proposals).set({
      status: 'approved',
      decidedAt: new Date().toISOString(),
      decidedBy: 'human',
      resultingStandardVersionId: versionId,
    }).where(eq(proposals.id, id)).run();
    return c.json({ new_standard_version_id: versionId });
  });

  return r;
}
```

- [ ] **Step 4: Mount in server.ts**

```typescript
import { proposalsRoute } from './routes/proposals.js';
// inside buildApp:
app.route('/', proposalsRoute(handle));
```

- [ ] **Step 5: Run test**

Run: `pnpm exec vitest run tests/hub/routes.proposals.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

Run: `git add src/hub/routes/proposals.ts src/hub/server.ts tests/hub/routes.proposals.test.ts && git commit -m "hub: proposals list/detail/decision (approve creates new standards version)"`

---

End of Phase 3. All read APIs work. The Vue UI in Phase 5 will consume these.

---

## Phase 4 — Learner (rules + LLM + dedup + cron)

### Task 4.1: Dedup + supersede core

**Files:**
- Create: `src/hub/learner/dedup.ts`
- Create: `src/hub/learner/types.ts`
- Create: `tests/hub/learner.dedup.test.ts`

- [ ] **Step 1: Define proposal candidate shape**

Create `src/hub/learner/types.ts`:
```typescript
export interface ProposalCandidate {
  archetype: string;
  proposalType: 'add_check' | 'adjust_weight' | 'remove_check' | 'reword';
  bodyMd: string;
  rationaleMd: string;
  source: 'rule' | 'llm';
  evidenceFindingIds: string[];
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/hub/learner.dedup.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDb, migrate } from '../../src/hub/db/client.js';
import { proposals } from '../../src/hub/db/schema.js';
import { upsertCandidate } from '../../src/hub/learner/dedup.js';
import type { ProposalCandidate } from '../../src/hub/learner/types.js';

const cand = (over: Partial<ProposalCandidate> = {}): ProposalCandidate => ({
  archetype: 'fastapi-api',
  proposalType: 'add_check',
  bodyMd: 'check cors_policy_explicit',
  rationaleMd: 'seen 7/10',
  source: 'rule',
  evidenceFindingIds: [],
  ...over,
});

describe('dedup', () => {
  let handle: ReturnType<typeof openDb>;
  beforeEach(() => {
    const p = join(mkdtempSync(join(tmpdir(), 'dd-')), 'h.db');
    handle = openDb(p);
    migrate(handle.sqlite);
  });

  it('first candidate inserts as pending', () => {
    upsertCandidate(handle, cand());
    const ps = handle.db.select().from(proposals).all();
    expect(ps).toHaveLength(1);
    expect(ps[0].status).toBe('pending');
  });

  it('similar candidate supersedes the prior', () => {
    upsertCandidate(handle, cand({ bodyMd: 'check cors_policy_explicit (v1)' }));
    upsertCandidate(handle, cand({ bodyMd: 'check cors_policy_explicit (v2)' }));
    const ps = handle.db.select().from(proposals).all();
    expect(ps).toHaveLength(2);
    const superseded = ps.filter((p) => p.status === 'superseded');
    const pending = ps.filter((p) => p.status === 'pending');
    expect(superseded).toHaveLength(1);
    expect(pending).toHaveLength(1);
  });

  it('does not re-propose if a similar one was rejected recently', () => {
    const propId = randomUUID();
    handle.db.insert(proposals).values({
      id: propId, archetype: 'fastapi-api', proposalType: 'add_check',
      bodyMd: 'check cors_policy_explicit', rationaleMd: 'r', source: 'rule',
      status: 'rejected', decidedAt: new Date().toISOString(), decidedBy: 'human',
    }).run();
    upsertCandidate(handle, cand());
    const pending = handle.db.select().from(proposals)
      .where((p: any) => p.status === 'pending' as never).all();
    expect(pending.filter((p: any) => p.status === 'pending')).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm exec vitest run tests/hub/learner.dedup.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement dedup**

Create `src/hub/learner/dedup.ts`:
```typescript
import { randomUUID } from 'node:crypto';
import { and, eq, gte, like, sql } from 'drizzle-orm';
import type { DbHandle } from '../db/client.js';
import { proposals, proposalEvidence } from '../db/schema.js';
import type { ProposalCandidate } from './types.js';

const REJECT_WINDOW_DAYS = 30;

function bodyPrefix(s: string): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, 80);
}

export function upsertCandidate(handle: DbHandle, cand: ProposalCandidate): string | null {
  const prefix = bodyPrefix(cand.bodyMd);
  const since = new Date(Date.now() - REJECT_WINDOW_DAYS * 86400_000).toISOString();
  const recentReject = handle.db.select().from(proposals).where(and(
    eq(proposals.archetype, cand.archetype),
    eq(proposals.proposalType, cand.proposalType),
    eq(proposals.status, 'rejected'),
    gte(proposals.decidedAt, since),
    like(proposals.bodyMd, `${prefix}%`),
  )).get();
  if (recentReject) return null;

  const pendingMatch = handle.db.select().from(proposals).where(and(
    eq(proposals.archetype, cand.archetype),
    eq(proposals.proposalType, cand.proposalType),
    eq(proposals.status, 'pending'),
    like(proposals.bodyMd, `${prefix}%`),
  )).get();

  if (pendingMatch) {
    handle.db.update(proposals).set({ status: 'superseded' })
      .where(eq(proposals.id, pendingMatch.id)).run();
  }

  const newId = randomUUID();
  handle.db.insert(proposals).values({
    id: newId, archetype: cand.archetype,
    proposalType: cand.proposalType,
    bodyMd: cand.bodyMd, rationaleMd: cand.rationaleMd,
    source: cand.source, status: 'pending',
  }).run();

  const allEvidence = pendingMatch
    ? [
        ...handle.db.select().from(proposalEvidence)
          .where(eq(proposalEvidence.proposalId, pendingMatch.id)).all()
          .map((e) => e.findingId),
        ...cand.evidenceFindingIds,
      ]
    : cand.evidenceFindingIds;
  const uniqueEvidence = Array.from(new Set(allEvidence));
  for (const findingId of uniqueEvidence) {
    try {
      handle.db.insert(proposalEvidence).values({ proposalId: newId, findingId }).run();
    } catch { /* dup link */ }
  }
  return newId;
}
```

- [ ] **Step 5: Run test**

Run: `pnpm exec vitest run tests/hub/learner.dedup.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

Run: `git add src/hub/learner/dedup.ts src/hub/learner/types.ts tests/hub/learner.dedup.test.ts && git commit -m "hub: learner dedup + supersede + recent-reject suppression"`

---

### Task 4.2: Rule R1 — persistent finding

**Files:**
- Create: `src/hub/learner/rules/r1_persistent_finding.ts`
- Create: `tests/hub/learner.r1.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/hub/learner.r1.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDb, migrate } from '../../src/hub/db/client.js';
import {
  d2pInstances, runs, iterations, verdicts, findings, standards,
} from '../../src/hub/db/schema.js';
import { r1PersistentFinding } from '../../src/hub/learner/rules/r1_persistent_finding.js';

describe('R1 persistent_finding', () => {
  let handle: ReturnType<typeof openDb>;
  let instId: string;

  function seedRunWithFinding(category: string) {
    const runId = randomUUID();
    handle.db.insert(runs).values({
      id: runId, instanceId: instId, projectPath: '/p',
      detectedArchetype: 'fastapi-api',
      startedAt: new Date().toISOString(),
      terminalState: 'CLEAN',
    }).run();
    const itId = randomUUID();
    handle.db.insert(iterations).values({
      id: itId, runId, iterN: 1, startedAt: new Date().toISOString(),
    }).run();
    const vdId = randomUUID();
    handle.db.insert(verdicts).values({
      id: vdId, iterationId: itId, verdict: 'pass',
    }).run();
    handle.db.insert(findings).values({
      id: randomUUID(), verdictId: vdId, category, severity: 'medium',
      isNew: true,
    }).run();
  }

  beforeEach(() => {
    const p = join(mkdtempSync(join(tmpdir(), 'r1-')), 'h.db');
    handle = openDb(p);
    migrate(handle.sqlite);
    instId = randomUUID();
    handle.db.insert(d2pInstances).values({ id: instId, name: 'i', tokenHash: 'x' }).run();
    handle.db.insert(standards).values({
      id: randomUUID(), archetype: 'fastapi-api', version: 1,
      bodyMd: '- tests_run_and_pass\n- readme_cmd_matches_manifest',
      isCurrent: true, source: 'manual',
    }).run();
  });

  it('produces candidate when category in >=5 of last 10 runs not in standards', async () => {
    for (let i = 0; i < 7; i++) seedRunWithFinding('cors_policy_missing');
    for (let i = 0; i < 3; i++) seedRunWithFinding('other_thing');
    const cands = await r1PersistentFinding(handle);
    const corsCand = cands.find((c) => c.bodyMd.includes('cors_policy_missing'));
    expect(corsCand).toBeDefined();
    expect(corsCand!.proposalType).toBe('add_check');
  });

  it('does not propose for categories already in current standards', async () => {
    for (let i = 0; i < 7; i++) seedRunWithFinding('readme_cmd_matches_manifest');
    const cands = await r1PersistentFinding(handle);
    expect(cands.find((c) => c.bodyMd.includes('readme_cmd_matches_manifest')))
      .toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/hub/learner.r1.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement R1**

Create `src/hub/learner/rules/r1_persistent_finding.ts`:
```typescript
import { sql } from 'drizzle-orm';
import type { DbHandle } from '../../db/client.js';
import type { ProposalCandidate } from '../types.js';

const WINDOW_RUNS = 10;
const THRESHOLD = 5;

export async function r1PersistentFinding(handle: DbHandle): Promise<ProposalCandidate[]> {
  const rows = handle.sqlite.prepare(`
    WITH recent_runs AS (
      SELECT id, detected_archetype, ROW_NUMBER() OVER (
        PARTITION BY detected_archetype ORDER BY started_at DESC
      ) AS rn
      FROM runs
      WHERE detected_archetype IS NOT NULL
    ),
    in_window AS (
      SELECT id, detected_archetype FROM recent_runs WHERE rn <= ?
    ),
    cat_counts AS (
      SELECT iw.detected_archetype AS archetype, f.category,
             COUNT(DISTINCT iw.id) AS run_count
      FROM in_window iw
      JOIN iterations i ON i.run_id = iw.id
      JOIN verdicts v ON v.iteration_id = i.id
      JOIN findings f ON f.verdict_id = v.id
      GROUP BY iw.detected_archetype, f.category
      HAVING run_count >= ?
    )
    SELECT cc.archetype, cc.category, cc.run_count, s.body_md
    FROM cat_counts cc
    LEFT JOIN standards s ON s.archetype = cc.archetype AND s.is_current = 1
  `).all(WINDOW_RUNS, THRESHOLD) as Array<{
    archetype: string; category: string; run_count: number; body_md: string | null;
  }>;

  const cands: ProposalCandidate[] = [];
  for (const r of rows) {
    if (r.body_md && r.body_md.includes(r.category)) continue;
    cands.push({
      archetype: r.archetype,
      proposalType: 'add_check',
      bodyMd: `check ${r.category}: this category appeared in ${r.run_count} of the last ${WINDOW_RUNS} runs but is not yet in standards.`,
      rationaleMd: `R1: ${r.category} appears in ${r.run_count}/${WINDOW_RUNS} recent ${r.archetype} runs; not currently checked.`,
      source: 'rule',
      evidenceFindingIds: collectFindingIds(handle, r.archetype, r.category, WINDOW_RUNS),
    });
  }
  return cands;
}

function collectFindingIds(
  handle: DbHandle, archetype: string, category: string, windowRuns: number,
): string[] {
  const rows = handle.sqlite.prepare(`
    SELECT f.id FROM findings f
    JOIN verdicts v ON v.id = f.verdict_id
    JOIN iterations i ON i.id = v.iteration_id
    JOIN runs r ON r.id = i.run_id
    WHERE r.detected_archetype = ? AND f.category = ?
    ORDER BY r.started_at DESC
    LIMIT ?
  `).all(archetype, category, windowRuns * 5) as { id: string }[];
  return rows.map((r) => r.id);
}
```

- [ ] **Step 4: Run test**

Run: `pnpm exec vitest run tests/hub/learner.r1.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

Run: `git add src/hub/learner/rules/r1_persistent_finding.ts tests/hub/learner.r1.test.ts && git commit -m "hub: learner rule R1 (persistent finding -> add_check)"`

---

### Task 4.3: Rule R2 — check never fires

**Files:**
- Create: `src/hub/learner/rules/r2_check_never_fires.ts`
- Create: `tests/hub/learner.r2.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/hub/learner.r2.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDb, migrate } from '../../src/hub/db/client.js';
import {
  d2pInstances, runs, iterations, verdicts, findings, standards,
} from '../../src/hub/db/schema.js';
import { r2CheckNeverFires } from '../../src/hub/learner/rules/r2_check_never_fires.js';

describe('R2 check_never_fires', () => {
  let handle: ReturnType<typeof openDb>;
  let instId: string;
  beforeEach(() => {
    const p = join(mkdtempSync(join(tmpdir(), 'r2-')), 'h.db');
    handle = openDb(p);
    migrate(handle.sqlite);
    instId = randomUUID();
    handle.db.insert(d2pInstances).values({ id: instId, name: 'i', tokenHash: 'x' }).run();
    handle.db.insert(standards).values({
      id: randomUUID(), archetype: 'fastapi-api', version: 1,
      bodyMd: '- check_a\n- check_b\n- check_c',
      isCurrent: true, source: 'manual',
    }).run();
  });

  function recentFinding(category: string, daysAgo: number) {
    const runId = randomUUID();
    handle.db.insert(runs).values({
      id: runId, instanceId: instId, projectPath: '/p',
      detectedArchetype: 'fastapi-api',
      startedAt: new Date(Date.now() - daysAgo * 86400_000).toISOString(),
    }).run();
    const itId = randomUUID();
    handle.db.insert(iterations).values({
      id: itId, runId, iterN: 1, startedAt: new Date().toISOString(),
    }).run();
    const vdId = randomUUID();
    handle.db.insert(verdicts).values({
      id: vdId, iterationId: itId, verdict: 'pass',
    }).run();
    handle.db.insert(findings).values({
      id: randomUUID(), verdictId: vdId, category, severity: 'low', isNew: true,
    }).run();
  }

  it('proposes remove_check for checks with no findings in 30 days', async () => {
    recentFinding('check_a', 5);
    recentFinding('check_b', 15);
    const cands = await r2CheckNeverFires(handle);
    expect(cands.find((c) => c.bodyMd.includes('check_c'))).toBeDefined();
    expect(cands.find((c) => c.bodyMd.includes('check_a'))).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/hub/learner.r2.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement R2**

Create `src/hub/learner/rules/r2_check_never_fires.ts`:
```typescript
import type { DbHandle } from '../../db/client.js';
import { standards } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import type { ProposalCandidate } from '../types.js';

const WINDOW_DAYS = 30;

function extractChecks(bodyMd: string): string[] {
  const lines = bodyMd.split('\n');
  const out: string[] = [];
  for (const l of lines) {
    const m = /^[-*]\s+([a-z0-9_]+)/i.exec(l);
    if (m) out.push(m[1]);
  }
  return out;
}

export async function r2CheckNeverFires(handle: DbHandle): Promise<ProposalCandidate[]> {
  const since = new Date(Date.now() - WINDOW_DAYS * 86400_000).toISOString();
  const stds = handle.db.select().from(standards).where(eq(standards.isCurrent, true)).all();
  const cands: ProposalCandidate[] = [];
  for (const s of stds) {
    const checks = extractChecks(s.bodyMd);
    for (const ck of checks) {
      const hits = handle.sqlite.prepare(`
        SELECT COUNT(*) AS n FROM findings f
        JOIN verdicts v ON v.id = f.verdict_id
        JOIN iterations i ON i.id = v.iteration_id
        JOIN runs r ON r.id = i.run_id
        WHERE r.detected_archetype = ?
          AND f.category = ?
          AND r.started_at > ?
      `).get(s.archetype, ck, since) as { n: number };
      if (hits.n === 0) {
        cands.push({
          archetype: s.archetype,
          proposalType: 'remove_check',
          bodyMd: `remove check ${ck}: no finding observed for ${WINDOW_DAYS} days.`,
          rationaleMd: `R2: ${ck} never fired in the last ${WINDOW_DAYS} days; may be obsolete.`,
          source: 'rule',
          evidenceFindingIds: [],
        });
      }
    }
  }
  return cands;
}
```

- [ ] **Step 4: Run test**

Run: `pnpm exec vitest run tests/hub/learner.r2.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

Run: `git add src/hub/learner/rules/r2_check_never_fires.ts tests/hub/learner.r2.test.ts && git commit -m "hub: learner rule R2 (check_never_fires -> remove_check)"`

---

### Task 4.4: Rules R3, R4, R5 (bundled — they share test scaffolding)

**Files:**
- Create: `src/hub/learner/rules/r3_severity_drift.ts`
- Create: `src/hub/learner/rules/r4_archetype_drift.ts`
- Create: `src/hub/learner/rules/r5_repeated_residual.ts`
- Create: `tests/hub/learner.r345.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/hub/learner.r345.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDb, migrate } from '../../src/hub/db/client.js';
import {
  d2pInstances, runs, iterations, verdicts, findings, standards,
} from '../../src/hub/db/schema.js';
import { r3SeverityDrift } from '../../src/hub/learner/rules/r3_severity_drift.js';
import { r4ArchetypeDrift } from '../../src/hub/learner/rules/r4_archetype_drift.js';
import { r5RepeatedResidual } from '../../src/hub/learner/rules/r5_repeated_residual.js';

describe('R3/R4/R5', () => {
  let handle: ReturnType<typeof openDb>;
  let instId: string;
  beforeEach(() => {
    const p = join(mkdtempSync(join(tmpdir(), 'r345-')), 'h.db');
    handle = openDb(p);
    migrate(handle.sqlite);
    instId = randomUUID();
    handle.db.insert(d2pInstances).values({ id: instId, name: 'i', tokenHash: 'x' }).run();
    handle.db.insert(standards).values({
      id: randomUUID(), archetype: 'fastapi-api', version: 1,
      bodyMd: '- check_x: high', isCurrent: true, source: 'manual',
    }).run();
  });

  function seedFindings(category: string, severity: string, count: number) {
    for (let i = 0; i < count; i++) {
      const runId = randomUUID();
      handle.db.insert(runs).values({
        id: runId, instanceId: instId, projectPath: '/p',
        detectedArchetype: 'fastapi-api',
        startedAt: new Date(Date.now() - i * 3600_000).toISOString(),
      }).run();
      const itId = randomUUID();
      handle.db.insert(iterations).values({
        id: itId, runId, iterN: 1, startedAt: new Date().toISOString(),
      }).run();
      const vdId = randomUUID();
      handle.db.insert(verdicts).values({
        id: vdId, iterationId: itId, verdict: 'needs_repair',
      }).run();
      handle.db.insert(findings).values({
        id: randomUUID(), verdictId: vdId, category, severity, isNew: true,
      }).run();
    }
  }

  it('R3: severity disagreement -> adjust_weight', async () => {
    seedFindings('check_x', 'medium', 17);
    seedFindings('check_x', 'high', 3);
    const cands = await r3SeverityDrift(handle);
    expect(cands.find((c) => c.proposalType === 'adjust_weight' && c.bodyMd.includes('check_x'))).toBeDefined();
  });

  it('R4: archetype drift -> mentor_note style proposal', async () => {
    for (const arch of ['fastapi-api', 'node-server', 'fastapi-api']) {
      const runId = randomUUID();
      handle.db.insert(runs).values({
        id: runId, instanceId: instId, projectPath: '/same-project',
        detectedArchetype: arch,
        startedAt: new Date().toISOString(),
      }).run();
    }
    const cands = await r4ArchetypeDrift(handle);
    expect(cands.length).toBeGreaterThan(0);
  });

  it('R5: repeated residual within one run -> reword', async () => {
    const runId = randomUUID();
    handle.db.insert(runs).values({
      id: runId, instanceId: instId, projectPath: '/p',
      detectedArchetype: 'fastapi-api',
      startedAt: new Date().toISOString(),
    }).run();
    for (let iter = 1; iter <= 3; iter++) {
      const itId = randomUUID();
      handle.db.insert(iterations).values({
        id: itId, runId, iterN: iter, startedAt: new Date().toISOString(),
      }).run();
      const vdId = randomUUID();
      handle.db.insert(verdicts).values({
        id: vdId, iterationId: itId, verdict: 'needs_repair',
      }).run();
      handle.db.insert(findings).values({
        id: randomUUID(), verdictId: vdId,
        category: 'tricky_thing', severity: 'medium', isNew: iter === 1,
      }).run();
    }
    const cands = await r5RepeatedResidual(handle);
    expect(cands.find((c) => c.bodyMd.includes('tricky_thing'))).toBeDefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/hub/learner.r345.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement R3**

Create `src/hub/learner/rules/r3_severity_drift.ts`:
```typescript
import type { DbHandle } from '../../db/client.js';
import { standards } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import type { ProposalCandidate } from '../types.js';

const WINDOW_FINDINGS = 20;
const DISAGREE_THRESHOLD = 0.80;

function extractCheckSeverities(bodyMd: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const l of bodyMd.split('\n')) {
    const m = /^[-*]\s+([a-z0-9_]+)\s*:\s*(blocker|high|medium|low)/i.exec(l);
    if (m) out.set(m[1], m[2].toLowerCase());
  }
  return out;
}

export async function r3SeverityDrift(handle: DbHandle): Promise<ProposalCandidate[]> {
  const cands: ProposalCandidate[] = [];
  const stds = handle.db.select().from(standards).where(eq(standards.isCurrent, true)).all();
  for (const s of stds) {
    const decls = extractCheckSeverities(s.bodyMd);
    for (const [check, declSev] of decls) {
      const rows = handle.sqlite.prepare(`
        SELECT f.severity FROM findings f
        JOIN verdicts v ON v.id = f.verdict_id
        JOIN iterations i ON i.id = v.iteration_id
        JOIN runs r ON r.id = i.run_id
        WHERE r.detected_archetype = ? AND f.category = ?
        ORDER BY r.started_at DESC
        LIMIT ?
      `).all(s.archetype, check, WINDOW_FINDINGS) as { severity: string }[];
      if (rows.length < WINDOW_FINDINGS) continue;
      const counts = new Map<string, number>();
      for (const r of rows) counts.set(r.severity, (counts.get(r.severity) ?? 0) + 1);
      let dominant: string | null = null, dominantPct = 0;
      for (const [sev, n] of counts) {
        const pct = n / rows.length;
        if (pct > dominantPct) { dominant = sev; dominantPct = pct; }
      }
      if (dominant && dominant !== declSev && dominantPct >= DISAGREE_THRESHOLD) {
        cands.push({
          archetype: s.archetype,
          proposalType: 'adjust_weight',
          bodyMd: `adjust severity of ${check}: declared ${declSev}, observed ${dominant} in ${Math.round(dominantPct * 100)}% of last ${WINDOW_FINDINGS}.`,
          rationaleMd: `R3: severity disagreement for ${check}.`,
          source: 'rule', evidenceFindingIds: [],
        });
      }
    }
  }
  return cands;
}
```

- [ ] **Step 4: Implement R4**

Create `src/hub/learner/rules/r4_archetype_drift.ts`:
```typescript
import type { DbHandle } from '../../db/client.js';
import type { ProposalCandidate } from '../types.js';

export async function r4ArchetypeDrift(handle: DbHandle): Promise<ProposalCandidate[]> {
  const rows = handle.sqlite.prepare(`
    WITH ordered AS (
      SELECT project_path, detected_archetype, started_at,
             ROW_NUMBER() OVER (PARTITION BY project_path ORDER BY started_at DESC) AS rn
      FROM runs WHERE detected_archetype IS NOT NULL
    )
    SELECT project_path, GROUP_CONCAT(detected_archetype) AS arches
    FROM ordered WHERE rn <= 3
    GROUP BY project_path
    HAVING COUNT(DISTINCT detected_archetype) > 1
  `).all() as { project_path: string; arches: string }[];

  return rows.map((r) => ({
    archetype: r.arches.split(',')[0],
    proposalType: 'reword' as const,
    bodyMd: `archetype drift on ${r.project_path}: recent runs detected ${r.arches}. Consider tightening archetype heuristics.`,
    rationaleMd: `R4: 3 consecutive runs detected different archetypes for the same project.`,
    source: 'rule',
    evidenceFindingIds: [],
  }));
}
```

- [ ] **Step 5: Implement R5**

Create `src/hub/learner/rules/r5_repeated_residual.ts`:
```typescript
import type { DbHandle } from '../../db/client.js';
import type { ProposalCandidate } from '../types.js';

const REPEAT_THRESHOLD = 3;

export async function r5RepeatedResidual(handle: DbHandle): Promise<ProposalCandidate[]> {
  const rows = handle.sqlite.prepare(`
    SELECT r.id AS run_id, r.detected_archetype AS archetype,
           f.category, COUNT(*) AS appearances
    FROM findings f
    JOIN verdicts v ON v.id = f.verdict_id
    JOIN iterations i ON i.id = v.iteration_id
    JOIN runs r ON r.id = i.run_id
    GROUP BY r.id, r.detected_archetype, f.category
    HAVING appearances >= ?
  `).all(REPEAT_THRESHOLD) as Array<{
    run_id: string; archetype: string; category: string; appearances: number;
  }>;

  return rows.filter((r) => r.archetype).map((r) => ({
    archetype: r.archetype,
    proposalType: 'reword' as const,
    bodyMd: `clarify ${r.category}: d2p reported it ${r.appearances} times within a single run (run ${r.run_id.slice(0, 8)}), suggesting the check description may be ambiguous or hard to fix.`,
    rationaleMd: `R5: repeated residual.`,
    source: 'rule',
    evidenceFindingIds: [],
  }));
}
```

- [ ] **Step 6: Run test**

Run: `pnpm exec vitest run tests/hub/learner.r345.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 7: Commit**

Run: `git add src/hub/learner/rules/r3_severity_drift.ts src/hub/learner/rules/r4_archetype_drift.ts src/hub/learner/rules/r5_repeated_residual.ts tests/hub/learner.r345.test.ts && git commit -m "hub: learner rules R3 (severity drift), R4 (archetype drift), R5 (repeated residual)"`

---

### Task 4.5: Runner — invoke all rules + dedup + schedule

**Files:**
- Create: `src/hub/learner/runner.ts`
- Create: `tests/hub/learner.runner.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/hub/learner.runner.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDb, migrate } from '../../src/hub/db/client.js';
import {
  d2pInstances, runs, iterations, verdicts, findings, standards, proposals,
} from '../../src/hub/db/schema.js';
import { runRulePass } from '../../src/hub/learner/runner.js';

describe('runner.runRulePass', () => {
  let handle: ReturnType<typeof openDb>;
  beforeEach(() => {
    const p = join(mkdtempSync(join(tmpdir(), 'rn-')), 'h.db');
    handle = openDb(p);
    migrate(handle.sqlite);
    const instId = randomUUID();
    handle.db.insert(d2pInstances).values({ id: instId, name: 'i', tokenHash: 'x' }).run();
    handle.db.insert(standards).values({
      id: randomUUID(), archetype: 'fastapi-api', version: 1,
      bodyMd: '- known_check', isCurrent: true, source: 'manual',
    }).run();
    for (let i = 0; i < 7; i++) {
      const runId = randomUUID();
      handle.db.insert(runs).values({
        id: runId, instanceId: instId, projectPath: '/p',
        detectedArchetype: 'fastapi-api',
        startedAt: new Date(Date.now() - i * 60_000).toISOString(),
      }).run();
      const itId = randomUUID();
      handle.db.insert(iterations).values({
        id: itId, runId, iterN: 1, startedAt: new Date().toISOString(),
      }).run();
      const vdId = randomUUID();
      handle.db.insert(verdicts).values({
        id: vdId, iterationId: itId, verdict: 'needs_repair',
      }).run();
      handle.db.insert(findings).values({
        id: randomUUID(), verdictId: vdId, category: 'cors_missing',
        severity: 'high', isNew: true,
      }).run();
    }
  });

  it('produces proposals into table', async () => {
    const created = await runRulePass(handle, { disabledRules: new Set() });
    expect(created).toBeGreaterThanOrEqual(1);
    const ps = handle.db.select().from(proposals).all();
    expect(ps.some((p) => p.bodyMd.includes('cors_missing'))).toBe(true);
  });

  it('skips disabled rules', async () => {
    const created = await runRulePass(handle, { disabledRules: new Set(['R1']) });
    const ps = handle.db.select().from(proposals).all();
    expect(ps.some((p) => p.bodyMd.includes('cors_missing'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/hub/learner.runner.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement runner**

Create `src/hub/learner/runner.ts`:
```typescript
import type { DbHandle } from '../db/client.js';
import { r1PersistentFinding } from './rules/r1_persistent_finding.js';
import { r2CheckNeverFires } from './rules/r2_check_never_fires.js';
import { r3SeverityDrift } from './rules/r3_severity_drift.js';
import { r4ArchetypeDrift } from './rules/r4_archetype_drift.js';
import { r5RepeatedResidual } from './rules/r5_repeated_residual.js';
import { upsertCandidate } from './dedup.js';
import type { ProposalCandidate } from './types.js';

const RULES: Array<[string, (h: DbHandle) => Promise<ProposalCandidate[]>]> = [
  ['R1', r1PersistentFinding],
  ['R2', r2CheckNeverFires],
  ['R3', r3SeverityDrift],
  ['R4', r4ArchetypeDrift],
  ['R5', r5RepeatedResidual],
];

export interface RunOpts { disabledRules: Set<string> }

export async function runRulePass(handle: DbHandle, opts: RunOpts): Promise<number> {
  let created = 0;
  for (const [id, rule] of RULES) {
    if (opts.disabledRules.has(id)) continue;
    try {
      const cands = await rule(handle);
      for (const c of cands) {
        const newId = upsertCandidate(handle, c);
        if (newId) created++;
      }
    } catch (e) {
      process.stderr.write(`rule ${id} failed: ${e instanceof Error ? e.message : String(e)}\n`);
    }
  }
  return created;
}

let scheduledTimer: NodeJS.Timeout | null = null;
let pendingTrigger = false;
const DEBOUNCE_MS = 60_000;

export function debouncedRulePass(handle: DbHandle, opts: RunOpts): void {
  pendingTrigger = true;
  if (scheduledTimer) return;
  scheduledTimer = setTimeout(async () => {
    scheduledTimer = null;
    if (pendingTrigger) {
      pendingTrigger = false;
      await runRulePass(handle, opts);
    }
  }, DEBOUNCE_MS);
}
```

- [ ] **Step 4: Run test**

Run: `pnpm exec vitest run tests/hub/learner.runner.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

Run: `git add src/hub/learner/runner.ts tests/hub/learner.runner.test.ts && git commit -m "hub: learner runner (invoke R1..R5, dedup, debounce)"`

---

### Task 4.6: Wire debounced rule pass into events route + admin trigger

**Files:**
- Modify: `src/hub/routes/events.ts`
- Create: `src/hub/routes/admin.ts`
- Modify: `src/hub/server.ts`
- Create: `tests/hub/routes.admin.test.ts`

- [ ] **Step 1: Write the failing test for admin trigger**

Create `tests/hub/routes.admin.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, migrate } from '../../src/hub/db/client.js';
import { buildApp } from '../../src/hub/server.js';

describe('POST /admin/learner/trigger', () => {
  let handle: ReturnType<typeof openDb>;
  let app: ReturnType<typeof buildApp>;
  beforeEach(() => {
    const p = join(mkdtempSync(join(tmpdir(), 'ad-')), 'h.db');
    handle = openDb(p);
    migrate(handle.sqlite);
    app = buildApp(handle, { adminToken: 'sec' });
  });

  it('403 without admin token', async () => {
    const r = await app.request('/admin/learner/trigger', { method: 'POST' });
    expect(r.status).toBe(403);
  });

  it('200 returns proposals_created count', async () => {
    const r = await app.request('/admin/learner/trigger', {
      method: 'POST',
      headers: { Authorization: 'Bearer sec' },
    });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(typeof j.proposals_created).toBe('number');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/hub/routes.admin.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement admin route**

Create `src/hub/routes/admin.ts`:
```typescript
import { Hono } from 'hono';
import type { DbHandle } from '../db/client.js';
import { adminAuth } from '../auth.js';
import { runRulePass } from '../learner/runner.js';

export function adminRoute(handle: DbHandle, adminToken: string | null) {
  const r = new Hono();
  r.post('/admin/learner/trigger', adminAuth(adminToken), async (c) => {
    const created = await runRulePass(handle, { disabledRules: new Set() });
    return c.json({ proposals_created: created });
  });
  return r;
}
```

- [ ] **Step 4: Mount admin + wire debounce after every successful event ingest**

Modify `src/hub/server.ts`:
```typescript
import { adminRoute } from './routes/admin.js';
// inside buildApp:
app.route('/', adminRoute(handle, opts.adminToken));
```

Modify `src/hub/routes/events.ts` — at the bottom of the success branch (after `dispatchIngest`):
```typescript
import { debouncedRulePass } from '../learner/runner.js';
// ... after dispatchIngest call:
debouncedRulePass(handle, { disabledRules: new Set() });
```

(Note: the debounce timer should not fire in test envs; vitest tests already pass without waiting. The 60s timer is fine since tests do not wait for it.)

- [ ] **Step 5: Run test**

Run: `pnpm exec vitest run tests/hub/routes.admin.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

Run: `git add src/hub/routes/admin.ts src/hub/server.ts src/hub/routes/events.ts tests/hub/routes.admin.test.ts && git commit -m "hub: admin trigger + debounced rule pass on every ingested event"`

---

### Task 4.7: LLM summariser (Opus, weekly, mockable)

**Files:**
- Create: `src/hub/learner/llm_summariser.ts`
- Create: `tests/hub/learner.llm.test.ts`
- Add dep: `@anthropic-ai/sdk`

- [ ] **Step 1: Install SDK**

Run: `pnpm add @anthropic-ai/sdk`

- [ ] **Step 2: Write the failing test (with mock client)**

Create `tests/hub/learner.llm.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDb, migrate } from '../../src/hub/db/client.js';
import {
  d2pInstances, runs, iterations, verdicts, findings, standards, proposals,
} from '../../src/hub/db/schema.js';
import { runLlmSummariser } from '../../src/hub/learner/llm_summariser.js';

describe('LLM summariser', () => {
  let handle: ReturnType<typeof openDb>;
  beforeEach(() => {
    const p = join(mkdtempSync(join(tmpdir(), 'llm-')), 'h.db');
    handle = openDb(p);
    migrate(handle.sqlite);
    const instId = randomUUID();
    handle.db.insert(d2pInstances).values({ id: instId, name: 'i', tokenHash: 'x' }).run();
    handle.db.insert(standards).values({
      id: randomUUID(), archetype: 'fastapi-api', version: 1,
      bodyMd: '- baseline', isCurrent: true, source: 'manual',
    }).run();
    const runId = randomUUID();
    handle.db.insert(runs).values({
      id: runId, instanceId: instId, projectPath: '/p',
      detectedArchetype: 'fastapi-api',
      startedAt: new Date().toISOString(),
    }).run();
    const itId = randomUUID();
    handle.db.insert(iterations).values({
      id: itId, runId, iterN: 1, startedAt: new Date().toISOString(),
    }).run();
    const vdId = randomUUID();
    handle.db.insert(verdicts).values({
      id: vdId, iterationId: itId, verdict: 'needs_repair',
    }).run();
    handle.db.insert(findings).values({
      id: randomUUID(), verdictId: vdId, category: 'wonky',
      severity: 'high', isNew: true,
    }).run();
  });

  it('inserts proposals based on mock LLM response', async () => {
    const mockClient = {
      messages: {
        create: async (_args: any) => ({
          content: [{
            type: 'text',
            text: JSON.stringify([
              {
                archetype: 'fastapi-api',
                proposal_type: 'reword',
                body_md: 'rephrase the baseline to be more specific',
                rationale_md: 'mock rationale',
                evidence_finding_ids: [],
              },
            ]),
          }],
        }),
      },
    };
    const n = await runLlmSummariser(handle, mockClient as any);
    expect(n).toBe(1);
    const ps = handle.db.select().from(proposals).all();
    expect(ps).toHaveLength(1);
    expect(ps[0].source).toBe('llm');
  });

  it('safely returns 0 when LLM returns unparseable response', async () => {
    const mockClient = {
      messages: {
        create: async () => ({ content: [{ type: 'text', text: 'not json' }] }),
      },
    };
    const n = await runLlmSummariser(handle, mockClient as any);
    expect(n).toBe(0);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm exec vitest run tests/hub/learner.llm.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement summariser**

Create `src/hub/learner/llm_summariser.ts`:
```typescript
import type { DbHandle } from '../db/client.js';
import { upsertCandidate } from './dedup.js';
import type { ProposalCandidate } from './types.js';

const WINDOW_DAYS = 7;
const MAX_INPUT_FINDINGS = 500;

interface ClaudeLike {
  messages: { create: (args: any) => Promise<{ content: Array<{ type: string; text: string }> }> };
}

const SYSTEM_PROMPT = `You review d2p's recent run data and propose standards changes.
Rules R1-R5 already cover: persistent findings, dead checks, severity drift,
archetype drift, repeated residuals. **Do NOT duplicate those patterns.**
Focus on semantic issues: vague wording, missing examples, archetype boundary
errors. Output JSON array of { archetype, proposal_type ('add_check' |
'adjust_weight' | 'remove_check' | 'reword'), body_md, rationale_md,
evidence_finding_ids: string[] }. If you have nothing to propose, return [].`;

export async function runLlmSummariser(handle: DbHandle, client: ClaudeLike): Promise<number> {
  const since = new Date(Date.now() - WINDOW_DAYS * 86400_000).toISOString();
  const rows = handle.sqlite.prepare(`
    SELECT r.detected_archetype AS archetype, f.id AS finding_id,
           f.category, f.severity, f.message, v.verdict
    FROM findings f
    JOIN verdicts v ON v.id = f.verdict_id
    JOIN iterations i ON i.id = v.iteration_id
    JOIN runs r ON r.id = i.run_id
    WHERE r.started_at > ?
    ORDER BY r.started_at DESC
    LIMIT ?
  `).all(since, MAX_INPUT_FINDINGS) as Array<{
    archetype: string; finding_id: string; category: string;
    severity: string; message: string | null; verdict: string;
  }>;

  if (rows.length === 0) return 0;

  const grouped: Record<string, typeof rows> = {};
  for (const r of rows) {
    (grouped[r.archetype] ??= [] as any).push(r);
  }
  const userPrompt = `Past ${WINDOW_DAYS} days, grouped by archetype:\n` +
    Object.entries(grouped).map(([arch, items]) =>
      `## ${arch}\n` + items.slice(0, 50).map((it) =>
        `- [${it.severity}] ${it.category}: ${it.message ?? ''}`,
      ).join('\n')
    ).join('\n\n');

  let resp: { content: Array<{ type: string; text: string }> };
  try {
    resp = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });
  } catch (e) {
    process.stderr.write(`LLM summariser call failed: ${e instanceof Error ? e.message : String(e)}\n`);
    return 0;
  }

  const text = resp.content.find((p) => p.type === 'text')?.text ?? '';
  let parsed: any[];
  try {
    const match = /\[[\s\S]*\]/m.exec(text);
    parsed = JSON.parse(match ? match[0] : text);
    if (!Array.isArray(parsed)) return 0;
  } catch {
    return 0;
  }

  let inserted = 0;
  for (const p of parsed) {
    const cand: ProposalCandidate = {
      archetype: String(p.archetype ?? ''),
      proposalType: p.proposal_type,
      bodyMd: String(p.body_md ?? ''),
      rationaleMd: String(p.rationale_md ?? ''),
      source: 'llm',
      evidenceFindingIds: Array.isArray(p.evidence_finding_ids)
        ? p.evidence_finding_ids.map(String) : [],
    };
    if (!cand.archetype || !cand.bodyMd) continue;
    const newId = upsertCandidate(handle, cand);
    if (newId) inserted++;
  }
  return inserted;
}
```

- [ ] **Step 5: Run test**

Run: `pnpm exec vitest run tests/hub/learner.llm.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 6: Wire weekly cron in `src/hub/index.ts`**

Add to `src/hub/index.ts` after `serve(...)`:
```typescript
import Anthropic from '@anthropic-ai/sdk';
import { runLlmSummariser } from './learner/llm_summariser.js';
import { runRulePass } from './learner/runner.js';

if (cfg.llmLearnerEnabled && cfg.anthropicApiKey) {
  const client = new Anthropic({ apiKey: cfg.anthropicApiKey });
  const WEEK_MS = 7 * 86400_000;
  setInterval(async () => {
    try {
      const n = await runLlmSummariser(handle, client as any);
      process.stderr.write(`LLM summariser produced ${n} proposals\n`);
    } catch (e) {
      process.stderr.write(`LLM summariser failed: ${e}\n`);
    }
  }, WEEK_MS);
}
```

(Daily backup hook can go in the same file later; out of scope for this task.)

- [ ] **Step 7: Commit**

Run: `git add src/hub/learner/llm_summariser.ts src/hub/index.ts tests/hub/learner.llm.test.ts package.json pnpm-lock.yaml && git commit -m "hub: weekly LLM summariser (Opus) with safe parse + cron wiring"`

---

End of Phase 4. Hub is functionally complete on the backend. Phase 5 builds the Vue UI on top.

---

## Phase 5 — Vue UI

### Task 5.1: Install Vue ecosystem in site/

**Files:**
- Modify: `site/package.json`

- [ ] **Step 1: Add deps**

Run: `cd site && pnpm add vue-router pinia && pnpm add -D tailwindcss postcss autoprefixer && cd ..`

- [ ] **Step 2: Initialize Tailwind**

Create `site/tailwind.config.js`:
```javascript
export default {
  content: ['./index.html', './src/**/*.{vue,js,ts}'],
  theme: { extend: {} },
  plugins: [],
};
```

Create `site/postcss.config.js`:
```javascript
export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
```

- [ ] **Step 3: Replace site/src/style.css with Tailwind directives**

Overwrite `site/src/style.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  font-family: ui-sans-serif, system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
}
```

- [ ] **Step 4: Verify dev server**

Run: `cd site && pnpm dev`
Open browser to http://localhost:5173
Expected: Vue app loads with Tailwind (basic styling applies). Then stop the dev server.

- [ ] **Step 5: Commit**

Run: `git add site/package.json site/pnpm-lock.yaml site/tailwind.config.js site/postcss.config.js site/src/style.css && git commit -m "site: install vue-router + pinia + tailwind for hub UI"`

---

### Task 5.2: humanize.ts + api.ts client helpers

**Files:**
- Create: `site/src/humanize.ts`
- Create: `site/src/api.ts`

- [ ] **Step 1: Implement humanize maps**

Create `site/src/humanize.ts`:
```typescript
const ARCHETYPES: Record<string, string> = {
  'fastapi-api': 'Python 后端 API',
  'node-server': 'Node 后端',
  'python-library': 'Python 库',
  'python-cli': 'Python 命令行',
  'unknown': '未识别项目',
};
const STATES: Record<string, string> = {
  'RUNNING': '正在跑',
  'CLEAN': '完美交付',
  'WITH_RESIDUALS': '基本可用,有问题没修完',
  'ESCALATED': '需要人介入',
  'TIMEOUT': '试到上限还没收敛',
};
const STATE_ICONS: Record<string, string> = {
  'RUNNING': '🟢', 'CLEAN': '✅', 'WITH_RESIDUALS': '⚠️',
  'ESCALATED': '❌', 'TIMEOUT': '⏱',
};
const SEVERITIES: Record<string, string> = {
  'blocker': '严重', 'high': '比较严重',
  'medium': '一般', 'low': '轻微',
};
const PROPOSAL_TYPES: Record<string, string> = {
  'add_check': '想新加一条规则',
  'remove_check': '想删一条没用的规则',
  'adjust_weight': '想改一条规则的严重程度',
  'reword': '想改一条规则的措辞',
};
const PROPOSAL_ICONS: Record<string, string> = {
  'add_check': '💡', 'remove_check': '🗑',
  'adjust_weight': '⚖️', 'reword': '✎',
};
const FINDING_CATEGORIES: Record<string, string> = {
  'missing_api_error_envelope': '接口出错时没返回标准格式',
  'readme_cmd_mismatch': 'README 写的命令跟代码对不上',
  'missing_env_example': '缺 .env.example 模板',
  'unpinned_production_deps': '生产依赖未固定版本',
  'dockerfile_uses_dev_server': 'Dockerfile 用的是开发服务器',
  'tests_run_and_pass': '测试要真能跑起来',
  'error_envelope_present': '接口要有标准错误格式',
  'cors_policy_missing': '缺少 CORS 配置',
  'cors_policy_explicit': '跨域要明确配置',
};

export const humanize = {
  archetype: (id: string | null | undefined): string =>
    id ? (ARCHETYPES[id] ?? id) : '未识别项目',
  state: (s: string | null | undefined): string => s ? (STATES[s] ?? s) : '未知',
  stateIcon: (s: string | null | undefined): string => s ? (STATE_ICONS[s] ?? '·') : '·',
  severity: (s: string): string => SEVERITIES[s] ?? s,
  proposalType: (t: string): string => PROPOSAL_TYPES[t] ?? t,
  proposalIcon: (t: string): string => PROPOSAL_ICONS[t] ?? '·',
  findingCategory: (c: string): string => FINDING_CATEGORIES[c] ?? c,
  hasFindingTranslation: (c: string): boolean => c in FINDING_CATEGORIES,
};
```

- [ ] **Step 2: Implement api client**

Create `site/src/api.ts`:
```typescript
const BASE = '/api';

async function get<T>(path: string): Promise<T> {
  const r = await fetch(BASE + path);
  if (!r.ok) throw new Error(`GET ${path} failed: ${r.status}`);
  return r.json();
}
async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`POST ${path} failed: ${r.status}`);
  return r.json();
}

export const api = {
  listRuns: (params?: { archetype?: string; state?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.archetype) q.set('archetype', params.archetype);
    if (params?.state) q.set('state', params.state);
    if (params?.limit) q.set('limit', String(params.limit));
    const qs = q.toString();
    return get<{ items: any[] }>('/runs' + (qs ? '?' + qs : ''));
  },
  getRun: (id: string) => get<any>(`/runs/${id}`),
  addRunNote: (id: string, body_md: string) =>
    post<{ note: any }>(`/runs/${id}/notes`, { body_md, author: 'human' }),
  listStandards: () => get<{ items: any[] }>('/standards'),
  getStandardsHistory: (archetype: string) =>
    get<any>(`/standards/${encodeURIComponent(archetype)}/history`),
  listProposals: (status: 'pending' | 'approved' | 'rejected' | 'superseded' = 'pending') =>
    get<{ items: any[] }>(`/proposals?status=${status}`),
  getProposal: (id: string) => get<any>(`/proposals/${id}`),
  decideProposal: (id: string, decision: 'approve' | 'reject',
                   opts?: { note?: string; edited_body_md?: string }) =>
    post<{ new_standard_version_id: string | null }>(`/proposals/${id}/decision`,
      { decision, ...opts }),
};
```

- [ ] **Step 3: Commit**

Run: `git add site/src/humanize.ts site/src/api.ts && git commit -m "site: humanize maps + api client wrappers"`

---

### Task 5.3: Router + Pinia + shell components

**Files:**
- Modify: `site/src/main.js` → rename `site/src/main.ts`
- Create: `site/src/router.ts`
- Create: `site/src/components/NavBar.vue`
- Create: `site/src/components/StatusBadge.vue`
- Create: `site/src/components/HumanLabel.vue`
- Modify: `site/src/App.vue`

- [ ] **Step 1: Rename and update entry**

Run: `git mv site/src/main.js site/src/main.ts`

Replace contents of `site/src/main.ts`:
```typescript
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './router';
import './style.css';

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.mount('#app');
```

- [ ] **Step 2: Create router**

Create `site/src/router.ts`:
```typescript
import { createRouter, createWebHistory } from 'vue-router';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'runs', component: () => import('./views/Runs.vue') },
    { path: '/runs/:id', name: 'run-detail', component: () => import('./views/RunDetail.vue') },
    { path: '/standards', name: 'standards', component: () => import('./views/Standards.vue') },
    { path: '/standards/:archetype', name: 'standard-detail',
      component: () => import('./views/StandardDetail.vue') },
    { path: '/mentor', name: 'mentor', component: () => import('./views/Mentor.vue') },
    { path: '/proposals/:id', name: 'proposal-detail',
      component: () => import('./views/ProposalDetail.vue') },
  ],
});
```

- [ ] **Step 3: StatusBadge component**

Create `site/src/components/StatusBadge.vue`:
```vue
<script setup lang="ts">
import { humanize } from '../humanize';

const props = defineProps<{ state: string | null }>();
</script>

<template>
  <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-sm">
    <span>{{ humanize.stateIcon(props.state) }}</span>
    <span>{{ humanize.state(props.state) }}</span>
  </span>
</template>
```

- [ ] **Step 4: HumanLabel component**

Create `site/src/components/HumanLabel.vue`:
```vue
<script setup lang="ts">
import { humanize } from '../humanize';
const props = defineProps<{ kind: 'archetype' | 'severity' | 'finding' | 'proposalType'; id: string | null }>();
function display() {
  if (!props.id) return '—';
  switch (props.kind) {
    case 'archetype': return humanize.archetype(props.id);
    case 'severity': return humanize.severity(props.id);
    case 'finding': return humanize.findingCategory(props.id);
    case 'proposalType': return humanize.proposalType(props.id);
  }
}
function untranslated() {
  if (props.kind === 'finding' && props.id) return !humanize.hasFindingTranslation(props.id);
  return false;
}
</script>

<template>
  <span>
    {{ display() }}
    <span v-if="untranslated()" class="ml-1 text-xs text-gray-400">[待翻译]</span>
  </span>
</template>
```

- [ ] **Step 5: NavBar with mentor count badge**

Create `site/src/components/NavBar.vue`:
```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api';

const router = useRouter();
const pendingCount = ref(0);

async function refresh() {
  try {
    const r = await api.listProposals('pending');
    pendingCount.value = r.items.length;
  } catch { /* offline */ }
}
onMounted(() => { refresh(); setInterval(refresh, 30_000); });
</script>

<template>
  <nav class="border-b bg-white px-4 py-3 flex gap-6 items-center sticky top-0 z-10">
    <span class="font-bold text-lg">MatrixOmnix Hub</span>
    <router-link to="/" class="hover:underline">运行</router-link>
    <router-link to="/standards" class="hover:underline">规则</router-link>
    <router-link to="/mentor" class="hover:underline flex items-center gap-1">
      <span>待办</span>
      <span v-if="pendingCount > 0"
            class="inline-block px-2 py-0.5 text-xs rounded-full bg-amber-200 text-amber-900">
        {{ pendingCount }}
      </span>
    </router-link>
  </nav>
</template>
```

- [ ] **Step 6: Update App.vue**

Replace `site/src/App.vue`:
```vue
<script setup lang="ts">
import NavBar from './components/NavBar.vue';
</script>

<template>
  <div class="min-h-screen bg-gray-50 text-gray-900">
    <NavBar />
    <main class="max-w-5xl mx-auto px-4 py-6">
      <router-view />
    </main>
  </div>
</template>
```

- [ ] **Step 7: Update index.html if needed**

Read `site/index.html`. Ensure the `<script>` tag references `/src/main.ts` (not `main.js`).

- [ ] **Step 8: Commit**

Run: `git add site/src/main.ts site/src/router.ts site/src/components/NavBar.vue site/src/components/StatusBadge.vue site/src/components/HumanLabel.vue site/src/App.vue site/index.html && git commit -m "site: router + pinia + shell (NavBar / StatusBadge / HumanLabel)"`

---

### Task 5.4: View A — Runs.vue (default landing)

**Files:**
- Create: `site/src/views/Runs.vue`
- Create: `site/src/stores/runs.ts`

- [ ] **Step 1: Create Pinia store**

Create `site/src/stores/runs.ts`:
```typescript
import { defineStore } from 'pinia';
import { api } from '../api';

export const useRunsStore = defineStore('runs', {
  state: () => ({ runs: [] as any[], loading: false, error: null as string | null }),
  actions: {
    async refresh(params?: { archetype?: string; state?: string }) {
      this.loading = true; this.error = null;
      try { this.runs = (await api.listRuns(params)).items; }
      catch (e: any) { this.error = e.message ?? String(e); }
      finally { this.loading = false; }
    },
  },
  getters: {
    active: (s) => s.runs.filter((r) => r.terminal_state === 'RUNNING'),
    recent: (s) => s.runs.filter((r) => r.terminal_state !== 'RUNNING').slice(0, 20),
  },
});
```

- [ ] **Step 2: Create Runs.vue**

Create `site/src/views/Runs.vue`:
```vue
<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue';
import { useRouter } from 'vue-router';
import { useRunsStore } from '../stores/runs';
import StatusBadge from '../components/StatusBadge.vue';
import HumanLabel from '../components/HumanLabel.vue';

const router = useRouter();
const store = useRunsStore();
let timer: number | null = null;
function fmtTime(s: string) {
  return new Date(s).toLocaleString('zh-CN', { hour12: false });
}
function oneLineOutcome(r: any) {
  if (r.terminal_state === 'CLEAN') return `完美交付,${r.total_iterations} 轮搞定`;
  if (r.terminal_state === 'WITH_RESIDUALS') return `基本可用,有问题没修完`;
  if (r.terminal_state === 'ESCALATED') return `遇到 d2p 修不动的硬骨头,等你介入`;
  if (r.terminal_state === 'TIMEOUT') return `试到上限还没收敛`;
  return '';
}
onMounted(() => { store.refresh(); timer = window.setInterval(() => store.refresh(), 30_000); });
onBeforeUnmount(() => { if (timer) clearInterval(timer); });
</script>

<template>
  <div class="space-y-6">
    <section v-if="store.active.length > 0">
      <h2 class="text-base font-semibold mb-2">正在跑</h2>
      <div class="space-y-2">
        <div v-for="r in store.active" :key="r.id"
             @click="router.push(`/runs/${r.id}`)"
             class="bg-white border rounded-lg p-4 cursor-pointer hover:bg-gray-50">
          <div class="flex items-center gap-3 mb-1">
            <StatusBadge :state="r.terminal_state" />
            <span class="font-medium">{{ r.project_path.split('/').pop() }}</span>
            <span class="text-xs text-gray-500 ml-auto">开始于 {{ fmtTime(r.started_at) }}</span>
          </div>
          <div class="text-sm text-gray-600">
            <HumanLabel kind="archetype" :id="r.detected_archetype" /> ·
            第 {{ r.total_iterations || '?' }} 轮 · 已花 ¥{{ ((r.total_cost_usd || 0) * 7).toFixed(2) }}
          </div>
        </div>
      </div>
    </section>

    <section>
      <h2 class="text-base font-semibold mb-2">最近 7 天</h2>
      <div v-if="store.recent.length === 0" class="text-sm text-gray-500">没有最近的运行。</div>
      <div v-else class="space-y-2">
        <div v-for="r in store.recent" :key="r.id"
             @click="router.push(`/runs/${r.id}`)"
             class="bg-white border rounded-lg p-4 cursor-pointer hover:bg-gray-50">
          <div class="flex items-center gap-3 mb-1">
            <StatusBadge :state="r.terminal_state" />
            <span class="font-medium">{{ r.project_path.split('/').pop() }}</span>
            <span class="ml-auto text-sm text-gray-600">{{ fmtTime(r.terminated_at || r.started_at) }}</span>
          </div>
          <div class="text-sm text-gray-700">{{ oneLineOutcome(r) }}</div>
        </div>
      </div>
    </section>

    <div v-if="store.error" class="text-red-600 text-sm">{{ store.error }}</div>
  </div>
</template>
```

- [ ] **Step 3: Visual smoke test**

Run: `pnpm site:dev` (or `cd site && pnpm dev`)
Open http://localhost:5173. The Runs page should render. With no hub running it shows the error toast; that's OK for now.

- [ ] **Step 4: Commit**

Run: `git add site/src/views/Runs.vue site/src/stores/runs.ts && git commit -m "site: Runs.vue (default landing) — active + recent runs with humanized state"`

---

### Task 5.5: View RunDetail.vue (drill-down)

**Files:**
- Create: `site/src/views/RunDetail.vue`

- [ ] **Step 1: Create view**

Create `site/src/views/RunDetail.vue`:
```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api';
import StatusBadge from '../components/StatusBadge.vue';
import HumanLabel from '../components/HumanLabel.vue';

const route = useRoute();
const router = useRouter();
const data = ref<any>(null);
const newNote = ref('');
const submitting = ref(false);

async function load() { data.value = await api.getRun(route.params.id as string); }
async function addNote() {
  if (!newNote.value.trim()) return;
  submitting.value = true;
  try { await api.addRunNote(route.params.id as string, newNote.value); newNote.value = ''; await load(); }
  finally { submitting.value = false; }
}
onMounted(load);
function fmt(s?: string | null) { return s ? new Date(s).toLocaleString('zh-CN') : '—'; }
function iterVerdicts(itId: string) {
  return (data.value?.verdicts ?? []).filter((v: any) => v.iteration_id === itId);
}
function verdictFindings(vId: string) {
  return (data.value?.findings ?? []).filter((f: any) => f.verdict_id === vId);
}
</script>

<template>
  <div v-if="data" class="space-y-6">
    <button @click="router.back()" class="text-sm text-gray-500 hover:underline">← 返回</button>

    <header class="bg-white border rounded-lg p-4 space-y-2">
      <div class="flex items-center gap-3">
        <StatusBadge :state="data.run.terminal_state" />
        <span class="font-bold text-lg">{{ data.run.project_path.split('/').pop() }}</span>
      </div>
      <div class="text-sm text-gray-600">
        <HumanLabel kind="archetype" :id="data.run.detected_archetype" /> ·
        {{ data.run.total_iterations }} 轮 · 用了 ¥{{ ((data.run.total_cost_usd || 0) * 7).toFixed(2) }}
        · {{ fmt(data.run.started_at) }} → {{ fmt(data.run.terminated_at) }}
      </div>
    </header>

    <section class="bg-white border rounded-lg p-4">
      <h3 class="font-semibold mb-2">d2p 这次都做了什么</h3>
      <div v-for="it in data.iterations" :key="it.id" class="border-l-2 border-gray-200 pl-3 mb-3">
        <div class="text-sm font-medium">第 {{ it.iter_n }} 轮</div>
        <div v-if="it.analyzer_summary" class="text-xs text-gray-600">
          分析: {{ it.analyzer_summary }}
        </div>
        <div v-if="it.planner_summary" class="text-xs text-gray-600">
          计划: {{ it.planner_summary }}
        </div>
        <div v-if="it.executor_summary" class="text-xs text-gray-600">
          执行: {{ it.executor_summary }}
        </div>
        <div v-for="v in iterVerdicts(it.id)" :key="v.id">
          <div class="text-sm mt-1">检查: {{ v.verdict }}<span v-if="v.confidence"> (置信度 {{ v.confidence.toFixed(2) }})</span></div>
          <ul class="ml-4 text-sm space-y-1 mt-1">
            <li v-for="f in verdictFindings(v.id)" :key="f.id">
              · <HumanLabel kind="finding" :id="f.category" />
              <span class="text-gray-500">
                (<HumanLabel kind="severity" :id="f.severity" />)
              </span>
              <div v-if="f.evidence" class="text-xs text-gray-500 ml-4">{{ f.evidence }}</div>
            </li>
          </ul>
        </div>
      </div>
    </section>

    <section class="bg-white border rounded-lg p-4">
      <h3 class="font-semibold mb-2">备注</h3>
      <ul class="space-y-1 mb-2 text-sm">
        <li v-for="n in data.notes" :key="n.id">
          <span class="text-gray-500">[{{ n.author === 'human' ? '你' : '自动' }} · {{ fmt(n.created_at) }}]</span>
          {{ n.body_md }}
        </li>
      </ul>
      <textarea v-model="newNote" rows="2"
                class="w-full border rounded p-2 text-sm"
                placeholder="加一条备注…"></textarea>
      <button @click="addNote" :disabled="submitting"
              class="mt-1 px-3 py-1 bg-blue-600 text-white rounded text-sm">
        加备注
      </button>
    </section>
  </div>
  <div v-else class="text-sm text-gray-500">加载中…</div>
</template>
```

- [ ] **Step 2: Commit**

Run: `git add site/src/views/RunDetail.vue && git commit -m "site: RunDetail.vue — humanized iteration timeline + notes"`

---

### Task 5.6: Views B — Standards.vue + StandardDetail.vue

**Files:**
- Create: `site/src/views/Standards.vue`
- Create: `site/src/views/StandardDetail.vue`

- [ ] **Step 1: List view**

Create `site/src/views/Standards.vue`:
```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api';
import HumanLabel from '../components/HumanLabel.vue';

const router = useRouter();
const items = ref<any[]>([]);
onMounted(async () => { items.value = (await api.listStandards()).items; });
</script>

<template>
  <div>
    <p class="text-sm text-gray-600 mb-3">
      d2p 在判断"项目算不算 productize 完了"时,按这些规则来。
    </p>
    <div class="space-y-2">
      <div v-for="s in items" :key="s.archetype"
           @click="router.push(`/standards/${s.archetype}`)"
           class="bg-white border rounded-lg p-4 cursor-pointer hover:bg-gray-50">
        <div class="font-medium">
          <HumanLabel kind="archetype" :id="s.archetype" />
        </div>
        <div class="text-sm text-gray-600">
          当前 v{{ s.current_version }} · {{ s.version_count }} 个版本
        </div>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Detail view**

Create `site/src/views/StandardDetail.vue`:
```vue
<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api';
import HumanLabel from '../components/HumanLabel.vue';

const route = useRoute();
const router = useRouter();
const data = ref<any>(null);
const tab = ref<'current' | 'history' | 'pending'>('current');
const archetype = computed(() => route.params.archetype as string);
async function load() { data.value = await api.getStandardsHistory(archetype.value); }
onMounted(load);
function fmt(s?: string | null) { return s ? new Date(s).toLocaleDateString('zh-CN') : '—'; }
const currentBody = computed(() => data.value?.versions?.[0]?.body_md ?? '');
</script>

<template>
  <div v-if="data" class="space-y-4">
    <button @click="router.back()" class="text-sm text-gray-500 hover:underline">← 返回</button>
    <h2 class="text-lg font-bold">
      <HumanLabel kind="archetype" :id="archetype" /> 的规则
    </h2>

    <div class="border-b flex gap-4 text-sm">
      <button @click="tab='current'" :class="tab==='current' ? 'font-bold border-b-2 border-blue-600 pb-1' : 'text-gray-500 pb-1'">现在用的</button>
      <button @click="tab='history'" :class="tab==='history' ? 'font-bold border-b-2 border-blue-600 pb-1' : 'text-gray-500 pb-1'">
        改动历史 ({{ data.versions.length }})
      </button>
      <button @click="tab='pending'" :class="tab==='pending' ? 'font-bold border-b-2 border-blue-600 pb-1' : 'text-gray-500 pb-1'">
        待决定 ({{ data.proposals.length }})
      </button>
    </div>

    <pre v-if="tab==='current'" class="bg-white border rounded p-4 text-sm whitespace-pre-wrap">{{ currentBody }}</pre>

    <ul v-else-if="tab==='history'" class="space-y-3">
      <li v-for="v in data.versions" :key="v.id" class="bg-white border rounded p-3">
        <div class="text-sm">
          <span class="font-medium">v{{ v.version }}</span> · {{ fmt(v.created_at) }}
        </div>
        <pre v-if="v.diff_from_prev_md" class="text-xs text-gray-700 mt-1 whitespace-pre-wrap">{{ v.diff_from_prev_md }}</pre>
      </li>
    </ul>

    <ul v-else class="space-y-2">
      <li v-for="p in data.proposals" :key="p.id"
          @click="router.push(`/proposals/${p.id}`)"
          class="bg-white border rounded p-3 cursor-pointer hover:bg-gray-50">
        <div class="text-sm">{{ p.proposal_type }}</div>
        <div class="text-xs text-gray-600 mt-1">{{ p.body_md.slice(0, 120) }}</div>
      </li>
    </ul>
  </div>
</template>
```

- [ ] **Step 3: Commit**

Run: `git add site/src/views/Standards.vue site/src/views/StandardDetail.vue && git commit -m "site: B page — Standards list + per-archetype detail (tabs)"`

---

### Task 5.7: View C — Mentor.vue + ProposalDetail.vue

**Files:**
- Create: `site/src/views/Mentor.vue`
- Create: `site/src/views/ProposalDetail.vue`

- [ ] **Step 1: Mentor inbox**

Create `site/src/views/Mentor.vue`:
```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api';
import HumanLabel from '../components/HumanLabel.vue';
import { humanize } from '../humanize';

const router = useRouter();
const tab = ref<'pending' | 'decided'>('pending');
const items = ref<any[]>([]);
const loading = ref(false);
async function load() {
  loading.value = true;
  try {
    if (tab.value === 'pending') items.value = (await api.listProposals('pending')).items;
    else items.value = (await api.listProposals('approved')).items
      .concat((await api.listProposals('rejected')).items);
  } finally { loading.value = false; }
}
onMounted(load);
</script>

<template>
  <div>
    <p class="text-sm text-gray-600 mb-3">
      系统观察了最近的项目,建议你做这些决定。
    </p>
    <div class="border-b flex gap-4 text-sm mb-3">
      <button @click="tab='pending'; load()" :class="tab==='pending' ? 'font-bold border-b-2 border-blue-600 pb-1' : 'text-gray-500 pb-1'">
        等你决定
      </button>
      <button @click="tab='decided'; load()" :class="tab==='decided' ? 'font-bold border-b-2 border-blue-600 pb-1' : 'text-gray-500 pb-1'">
        最近决定的
      </button>
    </div>
    <div v-if="loading" class="text-sm text-gray-500">加载中…</div>
    <div v-else-if="items.length === 0" class="text-sm text-gray-500">
      {{ tab === 'pending' ? '当前没有待办,d2p 自己跑得不错。' : '没有已决定的项。' }}
    </div>
    <div v-else class="space-y-3">
      <div v-for="p in items" :key="p.id"
           @click="router.push(`/proposals/${p.id}`)"
           class="bg-white border rounded-lg p-4 cursor-pointer hover:bg-gray-50">
        <div class="flex items-center gap-2 text-sm">
          <span class="text-lg">{{ humanize.proposalIcon(p.proposal_type) }}</span>
          <HumanLabel kind="archetype" :id="p.archetype" />
          <span class="text-gray-400">·</span>
          <span>{{ humanize.proposalType(p.proposal_type) }}</span>
          <span v-if="p.status !== 'pending'" class="ml-auto text-xs text-gray-500">{{ p.status }}</span>
        </div>
        <div class="text-sm mt-1">{{ p.body_md.slice(0, 200) }}</div>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Proposal detail with decision buttons**

Create `site/src/views/ProposalDetail.vue`:
```vue
<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api';
import HumanLabel from '../components/HumanLabel.vue';
import { humanize } from '../humanize';

const route = useRoute();
const router = useRouter();
const data = ref<any>(null);
const editing = ref(false);
const editedBody = ref('');
async function load() {
  data.value = await api.getProposal(route.params.id as string);
  editedBody.value = data.value.proposal.body_md;
}
onMounted(load);
async function approve() {
  await api.decideProposal(route.params.id as string, 'approve',
    editing.value ? { edited_body_md: editedBody.value } : undefined);
  router.push('/mentor');
}
async function reject() {
  await api.decideProposal(route.params.id as string, 'reject');
  router.push('/mentor');
}
const isPending = computed(() => data.value?.proposal?.status === 'pending');
</script>

<template>
  <div v-if="data" class="space-y-4">
    <button @click="router.back()" class="text-sm text-gray-500 hover:underline">← 返回</button>
    <header class="flex items-center gap-2">
      <span class="text-2xl">{{ humanize.proposalIcon(data.proposal.proposal_type) }}</span>
      <HumanLabel kind="archetype" :id="data.proposal.archetype" />
      <span class="text-gray-400">·</span>
      <span class="font-medium">{{ humanize.proposalType(data.proposal.proposal_type) }}</span>
    </header>

    <section class="bg-white border rounded-lg p-4">
      <div v-if="!editing" class="text-sm whitespace-pre-wrap">{{ data.proposal.body_md }}</div>
      <textarea v-else v-model="editedBody" rows="8" class="w-full border rounded p-2 text-sm"></textarea>
    </section>

    <section class="bg-white border rounded-lg p-4">
      <div class="text-sm font-medium mb-2">为什么提:</div>
      <p class="text-sm text-gray-700 whitespace-pre-wrap">{{ data.proposal.rationale_md }}</p>
    </section>

    <section v-if="data.evidence.length > 0" class="bg-white border rounded-lg p-4">
      <div class="text-sm font-medium mb-2">涉及的例子 ({{ data.evidence.length }}):</div>
      <ul class="text-sm space-y-1">
        <li v-for="e in data.evidence.slice(0, 10)" :key="e.id">
          · <HumanLabel kind="finding" :id="e.category" />
          <span class="text-gray-500">(<HumanLabel kind="severity" :id="e.severity" />)</span>
        </li>
      </ul>
    </section>

    <div v-if="isPending" class="flex gap-2">
      <button @click="approve" class="px-4 py-2 bg-green-600 text-white rounded">
        {{ editing ? '✓ 改完接受' : '✓ 接受' }}
      </button>
      <button @click="reject" class="px-4 py-2 bg-gray-500 text-white rounded">✗ 不要</button>
      <button v-if="!editing" @click="editing = true" class="px-4 py-2 border rounded">✎ 改下措辞</button>
    </div>
    <div v-else class="text-sm text-gray-500">
      已决定: {{ data.proposal.status }} 于 {{ data.proposal.decided_at }}
    </div>
  </div>
</template>
```

- [ ] **Step 3: Commit**

Run: `git add site/src/views/Mentor.vue site/src/views/ProposalDetail.vue && git commit -m "site: C page — Mentor inbox + proposal detail with approve/reject/edit"`

---

### Task 5.8: Hub serves Vue static + dev proxy

**Files:**
- Modify: `src/hub/server.ts`
- Modify: `src/hub/index.ts`
- Modify: `site/vite.config.js` (rename to .ts if needed)

- [ ] **Step 1: Add static-serving in production**

Modify `src/hub/server.ts` — at the bottom, before `return app`:
```typescript
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Mount API under /api and static UI under /
// Currently routes are mounted at root; remount everything below under /api.
```

Actually restructure: change every `app.route('/', xRoute(...))` to `app.route('/api', xRoute(...))`. Then add at bottom:
```typescript
const sitePath = join(process.cwd(), 'site', 'dist');
if (existsSync(sitePath)) {
  app.use('/*', serveStatic({ root: './site/dist' }));
}
```

- [ ] **Step 2: Update tests that hit /events, /runs, etc. to use /api/events etc.**

Run: `grep -rn "/events\|/runs\|/standards\|/proposals\|/admin" tests/hub`
For each test file, prefix the path with `/api` (except `/admin/*` which stays under `/admin` for clarity, or also prefix — your call. Pick consistency: prefix all backend routes with `/api`).

Suggested approach: keep `/admin` un-prefixed (admin lives at root) but all d2p-facing + UI-facing routes go under `/api`. Mount accordingly:
```typescript
app.route('/api', eventsRoute(handle, lookup));
app.route('/api', standardsRoute(handle));
app.route('/api', runsRoute(handle));
app.route('/api', proposalsRoute(handle));
app.route('/', adminRoute(handle, opts.adminToken));
```

Update all tests in `tests/hub/routes.*.test.ts` to use `/api/...` prefixes for non-admin endpoints.

- [ ] **Step 3: Add Vite proxy for dev**

Modify `site/vite.config.js` (or rename to `.ts`):
```javascript
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: { '/api': 'http://localhost:3030' },
  },
});
```

- [ ] **Step 4: Run full test suite**

Run: `pnpm exec vitest run tests/hub`
Expected: all hub tests pass.

- [ ] **Step 5: Build site + start hub + visual smoke**

Run: `cd site && pnpm build && cd ..`
Then: `HUB_ADMIN_TOKEN=t HUB_DB_PATH=/tmp/h.db pnpm exec tsx src/hub/index.ts`
Open http://127.0.0.1:3030 in browser. Expected: Vue app loads. Runs page shows empty state.

- [ ] **Step 6: Commit**

Run: `git add src/hub/server.ts src/hub/index.ts site/vite.config.* tests/hub && git commit -m "hub: mount API under /api, serve Vue static under /, vite proxy for dev"`

---

End of Phase 5. The Vue UI works end-to-end against a live hub. Phase 6 adds the Python HubClient and modifies d2p.

---

## Phase 6 — d2p HubClient (Python, in ../d2p)

> **All Phase 6 work happens in `../d2p` (parent folder). Make sure to `cd ../d2p` before each task and commit in that repo.**

### Task 6.1: Create branch in d2p repo

**Files:** (none — git op in `../d2p`)

- [ ] **Step 1: Switch to d2p**

Run: `cd ../d2p && git status -s`
Expected: clean working tree (or only your own scratch).

- [ ] **Step 2: Create branch**

Run: `git switch -c hub-integration`

---

### Task 6.2: Add httpx + create hub_client.py with TDD

**Files (all in `../d2p`):**
- Modify: `requirements.txt`
- Create: `d2p/hub_client.py`
- Create: `tests/test_hub_client.py`

- [ ] **Step 1: Add httpx + respx for mocking**

Add to `requirements.txt`:
```
httpx>=0.27
respx>=0.21
```

Then run: `pip install -r requirements.txt`

- [ ] **Step 2: Write the failing test for pull_standards**

Create `tests/test_hub_client.py`:
```python
import json
import os
import tempfile
import pathlib
import pytest
import httpx
import respx
from d2p.hub_client import HubClient, BAKED_STANDARDS_FALLBACK


def make_client(tmp_path: pathlib.Path) -> HubClient:
    return HubClient(base_url="http://hub.local",
                     token="tok", cache_dir=tmp_path)


@respx.mock
def test_pull_standards_fetches_and_caches(tmp_path):
    respx.get("http://hub.local/api/standards/fastapi-api").mock(
        return_value=httpx.Response(200, json={
            "version": 3, "body_md": "- live body", "etag": "3",
        }, headers={"etag": "3"}),
    )
    c = make_client(tmp_path)
    out = c.pull_standards("fastapi-api")
    assert "live body" in out
    cached = (tmp_path / "hub_cache" / "fastapi-api.md").read_text()
    assert "live body" in cached


@respx.mock
def test_pull_standards_304_uses_cache(tmp_path):
    cache_dir = tmp_path / "hub_cache"
    cache_dir.mkdir()
    (cache_dir / "fastapi-api.md").write_text("- cached body")
    (cache_dir / "fastapi-api.etag").write_text("2")
    respx.get("http://hub.local/api/standards/fastapi-api").mock(
        return_value=httpx.Response(304),
    )
    c = make_client(tmp_path)
    out = c.pull_standards("fastapi-api")
    assert "cached body" in out


@respx.mock
def test_pull_standards_falls_back_to_cache_on_network_error(tmp_path):
    cache_dir = tmp_path / "hub_cache"
    cache_dir.mkdir()
    (cache_dir / "fastapi-api.md").write_text("- cached fallback")
    respx.get("http://hub.local/api/standards/fastapi-api").mock(
        side_effect=httpx.ConnectError("no network"),
    )
    c = make_client(tmp_path)
    out = c.pull_standards("fastapi-api")
    assert "cached fallback" in out


@respx.mock
def test_pull_standards_falls_back_to_baked_when_no_cache(tmp_path):
    respx.get("http://hub.local/api/standards/some-arche").mock(
        side_effect=httpx.ConnectError("no network"),
    )
    c = make_client(tmp_path)
    out = c.pull_standards("some-arche")
    assert out == BAKED_STANDARDS_FALLBACK


@respx.mock
def test_push_event_success(tmp_path):
    route = respx.post("http://hub.local/api/events").mock(
        return_value=httpx.Response(200, json={"event_id": "e1"}),
    )
    c = make_client(tmp_path)
    c.push_event("run_started", "r1", {"foo": "bar"})
    assert route.called


@respx.mock
def test_push_event_queues_to_pending_on_failure(tmp_path):
    respx.post("http://hub.local/api/events").mock(
        side_effect=httpx.ConnectError("down"),
    )
    c = make_client(tmp_path)
    c.push_event("run_started", "r1", {"foo": "bar"})
    pending = tmp_path / "hub_cache" / "pending_events.jsonl"
    assert pending.exists()
    lines = pending.read_text().strip().splitlines()
    assert len(lines) == 1
    assert json.loads(lines[0])["type"] == "run_started"


@respx.mock
def test_push_event_flushes_pending_after_recovery(tmp_path):
    pending = tmp_path / "hub_cache"
    pending.mkdir()
    (pending / "pending_events.jsonl").write_text(
        json.dumps({"type": "run_started", "run_id": "r0", "payload": {}}) + "\n"
    )
    route = respx.post("http://hub.local/api/events").mock(
        return_value=httpx.Response(200, json={"event_id": "x"}),
    )
    c = make_client(tmp_path)
    c.push_event("iteration_complete", "r1", {"iter": 1})
    assert route.call_count == 2
    assert not (pending / "pending_events.jsonl").exists() or \
           (pending / "pending_events.jsonl").read_text().strip() == ""
```

- [ ] **Step 3: Run tests to verify failure**

Run: `pytest tests/test_hub_client.py -v`
Expected: collection FAIL or all 7 tests FAIL (`hub_client` does not exist).

- [ ] **Step 4: Implement HubClient**

Create `d2p/hub_client.py`:
```python
"""HubClient — minimal, fail-safe client for MatrixOmnix Hub.

d2p calls into this from verifier (pull standards) and orchestrator
(push events). All operations degrade gracefully: hub-down never
blocks d2p.
"""
from __future__ import annotations
import json
import pathlib
import typing as t
import httpx

BAKED_STANDARDS_FALLBACK = """# baked fallback
- tests_run_and_pass
- error_envelope_present
- readme_cmd_matches_manifest
- missing_env_example
"""


class HubClient:
    def __init__(self, base_url: str, token: str, cache_dir: pathlib.Path):
        self.base = base_url.rstrip("/")
        self.token = token
        self.cache = pathlib.Path(cache_dir) / "hub_cache"
        self.cache.mkdir(parents=True, exist_ok=True)

    # ---- standards pull -----------------------------------------------

    def pull_standards(self, archetype: str) -> str:
        body_file = self.cache / f"{archetype}.md"
        etag_file = self.cache / f"{archetype}.etag"
        etag = etag_file.read_text().strip() if etag_file.exists() else None
        headers = {"Authorization": f"Bearer {self.token}"}
        if etag:
            headers["If-None-Match"] = etag
        try:
            with httpx.Client(timeout=5.0) as client:
                resp = client.get(f"{self.base}/api/standards/{archetype}",
                                  headers=headers)
            if resp.status_code == 304:
                if body_file.exists():
                    return body_file.read_text()
                return BAKED_STANDARDS_FALLBACK
            if resp.status_code == 200:
                data = resp.json()
                body = data.get("body_md", "")
                body_file.write_text(body)
                if "etag" in data:
                    etag_file.write_text(str(data["etag"]))
                return body
            return self._fallback(body_file)
        except (httpx.HTTPError, OSError):
            return self._fallback(body_file)

    def _fallback(self, body_file: pathlib.Path) -> str:
        if body_file.exists():
            return body_file.read_text()
        return BAKED_STANDARDS_FALLBACK

    # ---- event push ---------------------------------------------------

    def push_event(self, event_type: str, run_id: str,
                   payload: dict[str, t.Any]) -> None:
        pending_file = self.cache / "pending_events.jsonl"
        events_to_send: list[dict[str, t.Any]] = []

        if pending_file.exists():
            for line in pending_file.read_text().splitlines():
                line = line.strip()
                if not line:
                    continue
                try:
                    events_to_send.append(json.loads(line))
                except json.JSONDecodeError:
                    continue

        events_to_send.append({
            "type": event_type, "run_id": run_id, "payload": payload,
        })

        unsent: list[dict[str, t.Any]] = []
        try:
            with httpx.Client(timeout=5.0) as client:
                for evt in events_to_send:
                    try:
                        resp = client.post(
                            f"{self.base}/api/events",
                            headers={"Authorization": f"Bearer {self.token}"},
                            json=evt,
                        )
                        if resp.status_code not in (200, 202):
                            unsent.append(evt)
                    except httpx.HTTPError:
                        unsent.append(evt)
        except httpx.HTTPError:
            unsent.extend(events_to_send)

        if unsent:
            with pending_file.open("w") as f:
                for evt in unsent:
                    f.write(json.dumps(evt) + "\n")
        else:
            if pending_file.exists():
                pending_file.unlink()
```

- [ ] **Step 5: Run tests**

Run: `pytest tests/test_hub_client.py -v`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit (in `../d2p`)**

Run: `git add d2p/hub_client.py tests/test_hub_client.py requirements.txt && git commit -m "feat: HubClient with 3-tier standards fallback + pending-events queue"`

---

### Task 6.3: Wire HubClient into Verifier (placeholder — verifier may not exist yet)

**Files (in `../d2p`):**
- Modify: `d2p/agents/verifier.py` IF it exists; otherwise create stub

- [ ] **Step 1: Check if verifier exists**

Run: `ls d2p/agents/verifier.py`
If it exists, skip to Step 2.
If it does not exist (verifier from `2026-05-22-d2p-verify-agent-design.md` not yet implemented):
- Create a minimal placeholder so this plan's wiring is complete:
  ```python
  # d2p/agents/verifier.py — placeholder until full implementation
  from __future__ import annotations
  import typing as t
  from dataclasses import dataclass

  BAKED_SYSTEM_PROMPT_TEMPLATE = "You verify projects.\n\nStandards:\n{standards}\n"

  @dataclass
  class VerifyResult:
      verdict: str
      raw_response: str

  class Verifier:
      def __init__(self, llm_client, system_root, hub_client=None):
          self.llm = llm_client
          self.system_root = system_root
          self.hub = hub_client

      def verify(self, project_path, claim, pre_evidence,
                 previous_results=None, archetype=None) -> VerifyResult:
          arch = archetype or "unknown"
          standards = (self.hub.pull_standards(arch)
                       if self.hub else "- baseline")
          system_prompt = BAKED_SYSTEM_PROMPT_TEMPLATE.format(standards=standards)
          # The real call will be filled in when the full spec is implemented.
          raise NotImplementedError("Verifier body not yet implemented")
  ```

- [ ] **Step 2: If verifier already exists, modify its `__init__` and verify methods**

Read `d2p/agents/verifier.py`. Add `hub_client=None` to `__init__`. Inside `verify`, before building system prompt, add:
```python
arch = ... # however archetype is determined
standards = (self.hub.pull_standards(arch)
             if self.hub else BAKED_STANDARDS)
# Then format SYSTEM_PROMPT with {standards}, replacing the hardcoded block.
```

The exact integration depends on the verifier's current shape — keep the change minimal: just inject `standards` into the existing prompt template.

- [ ] **Step 3: Commit**

Run: `git add d2p/agents/verifier.py && git commit -m "feat: verifier accepts optional HubClient for standards pull"`

---

### Task 6.4: Wire HubClient into orchestrator

**Files (in `../d2p`):**
- Modify: `d2p/orchestrator.py`

- [ ] **Step 1: Read current orchestrator to find the iteration loop**

Run: `grep -n "def run\|for iter\|iteration" d2p/orchestrator.py | head -20`

- [ ] **Step 2: Add hub_client param + push_event hooks**

Find the `Orchestrator.__init__` (or equivalent) and add `hub_client=None` param. Find the run method (likely `def run(self, ...)` or similar) and add at:
- start of run: `if self.hub: self.hub.push_event("run_started", run_id, {"project_path": str(project_path), "started_at": ...})`
- end of each iter: `if self.hub: self.hub.push_event("iteration_complete", run_id, {"iter_n": iter_n, ...})`
- terminate: `if self.hub: self.hub.push_event("run_terminated", run_id, {"terminal_state": state, ...})`

Exact lines depend on the orchestrator's current shape. Keep the changes additive (`if self.hub: ...` guards everywhere) and use `try: ... except Exception: pass` around each push to ensure hub failures don't crash d2p.

- [ ] **Step 3: Commit**

Run: `git add d2p/orchestrator.py && git commit -m "feat: orchestrator pushes run lifecycle events to hub (best-effort)"`

---

### Task 6.5: Wire hub config + entry in d2p

**Files (in `../d2p`):**
- Modify: `d2p/config.py`
- Modify: `run.py`

- [ ] **Step 1: Add hub config**

Modify `d2p/config.py`. Add at the top of `load_config()` or equivalent:
```python
hub_url = os.environ.get("HUB_URL")
hub_token = os.environ.get("HUB_TOKEN")
```
Expose these on the returned config object.

- [ ] **Step 2: Instantiate HubClient in entry point**

Modify `run.py`. Where Orchestrator/Verifier are constructed, add:
```python
from d2p.hub_client import HubClient
import pathlib

hub_client = None
if cfg.hub_url and cfg.hub_token:
    hub_client = HubClient(
        base_url=cfg.hub_url,
        token=cfg.hub_token,
        cache_dir=pathlib.Path.home() / ".d2p",
    )

orch = Orchestrator(..., hub_client=hub_client)
verifier = Verifier(..., hub_client=hub_client)
```

- [ ] **Step 3: Run d2p test suite**

Run: `pytest -q`
Expected: existing tests still pass; HubClient tests pass; total ~ existing + 7 new.

- [ ] **Step 4: Commit**

Run: `git add d2p/config.py run.py && git commit -m "feat: wire HUB_URL/HUB_TOKEN env vars into orchestrator + verifier"`

---

End of Phase 6. d2p now reports to hub when `HUB_URL` is set and runs unchanged otherwise. Return to the hub repo for Phase 7.

---

## Phase 7 — End-to-end smoke + asset cleanup + merge

### Task 7.1: End-to-end smoke script

**Files (in this repo, `demo2project`):**
- Create: `scripts/hub-smoke.sh`

- [ ] **Step 1: Go back to hub repo**

Run: `cd /Users/mack/Desktop/Hosico/Works/Work/demo2project && git status -s`

- [ ] **Step 2: Write smoke script**

Create `scripts/hub-smoke.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail

SMOKE_DB="/tmp/hub-smoke-$$.db"
ADMIN_TOKEN="smoke-admin"
HUB_PORT=3131

cleanup() {
  if [ -n "${HUB_PID:-}" ]; then
    kill "$HUB_PID" 2>/dev/null || true
  fi
  rm -f "$SMOKE_DB" "$SMOKE_DB-wal" "$SMOKE_DB-shm"
}
trap cleanup EXIT

# Seed
HUB_DB_PATH="$SMOKE_DB" pnpm hub:seed > /tmp/seed.out
HUB_TOKEN=$(grep "^HUB_TOKEN=" /tmp/seed.out | cut -d= -f2)
echo "got HUB_TOKEN: ${HUB_TOKEN:0:8}…"

# Start hub
HUB_ADMIN_TOKEN="$ADMIN_TOKEN" \
HUB_DB_PATH="$SMOKE_DB" \
HUB_PORT="$HUB_PORT" \
pnpm exec tsx src/hub/index.ts > /tmp/hub.log 2>&1 &
HUB_PID=$!
sleep 2

# Probe health
echo "== health =="
curl -sf -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://127.0.0.1:$HUB_PORT/admin/health"
echo

# Simulate d2p run via /api/events
RUN_ID=$(uuidgen)
echo "== run_started =="
curl -sf -X POST -H "content-type: application/json" \
  -H "Authorization: Bearer $HUB_TOKEN" \
  -d "{\"type\":\"run_started\",\"run_id\":\"$RUN_ID\",\"payload\":{\"project_path\":\"/tmp/smoke\",\"detected_archetype\":\"fastapi-api\",\"started_at\":\"$(date -u +%FT%TZ)\"}}" \
  "http://127.0.0.1:$HUB_PORT/api/events"
echo

echo "== finding =="
curl -sf -X POST -H "content-type: application/json" \
  -H "Authorization: Bearer $HUB_TOKEN" \
  -d "{\"type\":\"finding_recorded\",\"run_id\":\"$RUN_ID\",\"payload\":{\"iter_n\":1,\"category\":\"missing_env_example\",\"severity\":\"low\",\"is_new\":true}}" \
  "http://127.0.0.1:$HUB_PORT/api/events"
echo

# Verify in DB
echo "== runs in DB =="
sqlite3 "$SMOKE_DB" "SELECT id, project_path, detected_archetype, terminal_state FROM runs;"
echo

echo "== findings in DB =="
sqlite3 "$SMOKE_DB" "SELECT category, severity FROM findings;"
echo

echo "smoke OK"
```

- [ ] **Step 3: Make executable + run**

Run: `chmod +x scripts/hub-smoke.sh && bash scripts/hub-smoke.sh`
Expected: prints health JSON, two empty responses from events POST, then `runs` row + `findings` row from sqlite3 query, ending with `smoke OK`.

- [ ] **Step 4: Commit**

Run: `git add scripts/hub-smoke.sh && git commit -m "scripts: end-to-end hub smoke test"`

---

### Task 7.2: Delete deprecated verifier-pivot code

**Files to delete (in this repo):**
- `src/agents/VerifierAgent.ts`
- `src/mcp/server.ts`
- `src/mcp/tools.ts`
- (Optionally) `src/cli/commands/*` except `analyze`, `gap`, `archetype`, `doctor`, `init`, `_shared`

- [ ] **Step 1: Find references to verifier/MCP**

Run: `grep -rln "VerifierAgent\|src/mcp" src tests`

- [ ] **Step 2: Delete verifier + MCP**

Run: `rm -f src/agents/VerifierAgent.ts src/mcp/server.ts src/mcp/tools.ts`
Then run: `rmdir src/mcp 2>/dev/null || true`

For each test that referenced these (from step 1), delete those test files.

- [ ] **Step 3: Remove `d2p-verify` bin from package.json**

Modify `package.json`. Update `bin`:
```json
"bin": {
  "matrixomnix": "./dist/cli/index.js",
  "demo2project": "./dist/cli/index.js",
  "matrixomnix-hub": "./dist/hub/index.js"
}
```

Update `scripts`. Remove `d2p-verify` entry. Add:
```json
"hub:dev": "tsx watch src/hub/index.ts",
"hub:start": "node dist/hub/index.js",
"hub:build": "tsc -p tsconfig.json && node scripts/copy-assets.mjs && pnpm site:build"
```

- [ ] **Step 4: Build to verify nothing broken**

Run: `pnpm build`
Expected: clean. If any TS error references deleted files, scrub the imports.

- [ ] **Step 5: Run full test suite**

Run: `pnpm exec vitest run 2>&1 | tail -10`
Expected: all remaining tests pass.

- [ ] **Step 6: Commit**

Run: `git add -A && git commit -m "delete: verifier-pivot artifacts (VerifierAgent, MCP server); update package.json bin/scripts"`

---

### Task 7.3: Update README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace tagline**

Open `README.md`. Replace the first 10 lines with:
```markdown
# MatrixOmnix Hub

**The PM + mentor cockpit for d2p productization runs.** d2p instances push events here; this hub aggregates them, learns standards drift over time (rule-based + weekly LLM), and surfaces decisions to a human via a Vue dashboard. d2p verifier pulls its current standards from here.

MatrixOmnix Hub does not run iterations and does not modify projects. It is read-only relative to project code; it is read-write relative to standards (with human approval gates).
```

- [ ] **Step 2: Replace Quickstart section**

Replace the quickstart with:
```markdown
## Quickstart

```bash
pnpm install
pnpm hub:build

# Initialize DB and create the first d2p instance token (one-time)
HUB_DB_PATH=~/.matrixomnix/hub.db pnpm hub:seed

# Start the hub
HUB_ADMIN_TOKEN=$(openssl rand -hex 16) pnpm hub:start

# Open the UI
open http://127.0.0.1:3030
```

Then on each d2p machine:

```bash
export HUB_URL=http://hub-host:3030
export HUB_TOKEN=<the token printed by hub:seed>
python run.py    # d2p auto-reports to hub
```
```

- [ ] **Step 3: Remove obsolete sections**

Strip references to: `d2p-verify` MCP server, the verifier-pivot framing, the deleted CLI commands.

- [ ] **Step 4: Commit**

Run: `git add README.md && git commit -m "readme: reframe as MatrixOmnix Hub (PM + mentor cockpit for d2p)"`

---

### Task 7.4: Final test + merge to main

**Files:** (none — git ops)

- [ ] **Step 1: Final test sweep**

Run: `pnpm build && pnpm exec vitest run 2>&1 | tail -10`
Expected: build clean; all tests pass.

- [ ] **Step 2: Smoke test once more**

Run: `bash scripts/hub-smoke.sh`
Expected: ends with `smoke OK`.

- [ ] **Step 3: Squash-commit or merge to main**

Run: `git switch main && git merge --no-ff hub-implementation -m "Hub: MatrixOmnix becomes a PM + mentor cockpit for d2p"`

- [ ] **Step 4: Tag**

Run: `git tag v0.1.0-hub HEAD`

- [ ] **Step 5: Done — final summary printout**

Run: `git log --oneline -20`
Confirm: hub branch merged, tag v0.1.0-hub created.

---

## Acceptance criteria (verify at end of all phases)

- [ ] `pnpm build` clean in this repo
- [ ] `pnpm exec vitest run` 100% pass (estimate ~30-50 new tests added)
- [ ] `bash scripts/hub-smoke.sh` completes with `smoke OK`
- [ ] `HUB_DB_PATH=~/.matrixomnix/hub.db pnpm hub:start` serves Vue at http://127.0.0.1:3030
- [ ] In d2p (`../d2p`): `pytest -q` passes including 7 new HubClient tests
- [ ] When `HUB_URL` + `HUB_TOKEN` env vars are set in d2p, a d2p run produces `runs`/`iterations`/`verdicts`/`findings` rows in `~/.matrixomnix/hub.db`
- [ ] When hub is unreachable, d2p run still completes (uses cached standards or BAKED_STANDARDS_FALLBACK)
- [ ] Hub UI shows runs in 中文 with humanized status (`完美交付` etc.) and finding category translations
- [ ] Pending proposals show in Mentor inbox; Approve creates new `standard_versions` row + flips `standards.is_current`; next d2p verifier pull gets the new version
- [ ] README header reads "MatrixOmnix Hub" and quickstart instructions match the actual commands
- [ ] `git tag` shows `v0.1.0-hub` on main

