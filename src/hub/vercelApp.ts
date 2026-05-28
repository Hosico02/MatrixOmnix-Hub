// Serverless bootstrap for Vercel. Builds an ephemeral in-memory SQLite Hub
// on cold start (data is NOT persisted — this is a demo/preview surface),
// migrates the schema, seeds demo content, and returns the Hono app.
//
// Runner is force-disabled (no subprocesses on serverless) and the weekly
// LLM summariser interval is omitted (no long-lived process).
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import * as schema from './db/schema.js';
import type { DbHandle } from './db/client.js';
import { buildApp } from './server.js';
import {
  standards, d2pInstances, runs, iterations, verdicts, findings, proposals,
} from './db/schema.js';

// Migration .sql files are bundled via vercel.json `includeFiles` and read
// from the deployment root at runtime (process.cwd() === /var/task on Vercel),
// rather than relative to import.meta.url which the bundler rewrites.
function migrateFromCwd(sqlite: Database.Database): void {
  const dir = join(process.cwd(), 'src', 'hub', 'db', 'migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    const sqlText = readFileSync(join(dir, f), 'utf-8');
    const idempotent = sqlText
      .replace(/CREATE TABLE `/g, 'CREATE TABLE IF NOT EXISTS `')
      .replace(/CREATE UNIQUE INDEX `/g, 'CREATE UNIQUE INDEX IF NOT EXISTS `')
      .replace(/CREATE INDEX `/g, 'CREATE INDEX IF NOT EXISTS `');
    try {
      sqlite.exec(idempotent);
    } catch (e) {
      const msg = String((e as { message?: string })?.message ?? '');
      if (/duplicate column name/i.test(msg)) continue;
      throw e;
    }
  }
}

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

function isoDaysAgo(days: number, hour = 10): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

function seed(handle: DbHandle): void {
  const { db } = handle;

  for (const [arch, body] of Object.entries(ARCHETYPE_BASELINE)) {
    db.insert(standards).values({
      id: randomUUID(), archetype: arch, version: 1,
      bodyMd: body, isCurrent: true, source: 'manual', approvedBy: 'seed',
    }).run();
  }

  const instanceId = randomUUID();
  db.insert(d2pInstances).values({
    id: instanceId, name: 'default',
    tokenHash: bcrypt.hashSync('demo-instance-token', 8),
  }).run();

  // ── Demo runs so the dashboard isn't empty ──────────────────────────
  const run1 = randomUUID();
  const run2 = randomUUID();
  const run3 = randomUUID();
  db.insert(runs).values([
    {
      id: run1, instanceId, projectPath: '/projects/orders-api',
      detectedArchetype: 'fastapi-api',
      startedAt: isoDaysAgo(2, 9), terminatedAt: isoDaysAgo(2, 11),
      terminalState: 'converged', totalCostUsd: 1.42, totalIterations: 3,
      verifierCatchRate: 0.88, verifierFpRate: 0.04, verifierModel: 'opus-4',
      verifierCriteriaMet: true, verifierCalibratedAt: isoDaysAgo(5, 12),
    },
    {
      id: run2, instanceId, projectPath: '/projects/cli-toolkit',
      detectedArchetype: 'python-cli',
      startedAt: isoDaysAgo(1, 14), terminatedAt: isoDaysAgo(1, 15),
      terminalState: 'max_iterations', totalCostUsd: 2.07, totalIterations: 5,
    },
    {
      id: run3, instanceId, projectPath: '/projects/web-server',
      detectedArchetype: 'node-server',
      startedAt: isoDaysAgo(0, 8), terminatedAt: null,
      terminalState: null, totalCostUsd: 0.31, totalIterations: 1,
    },
  ]).run();

  const iter1 = randomUUID();
  const iter2 = randomUUID();
  db.insert(iterations).values([
    {
      id: iter1, runId: run1, iterN: 1, startedAt: isoDaysAgo(2, 9),
      endedAt: isoDaysAgo(2, 10),
      analyzerSummary: 'Detected FastAPI service; missing error envelope and .env.example.',
      plannerSummary: 'Add structured exception handler and env template.',
      executorSummary: 'Implemented global exception handler returning JSON envelope.',
      qaSummary: 'Tests pass (14/14). Error responses now structured.',
    },
    {
      id: iter2, runId: run1, iterN: 2, startedAt: isoDaysAgo(2, 10),
      endedAt: isoDaysAgo(2, 11),
      analyzerSummary: 'README commands drift from pyproject scripts.',
      plannerSummary: 'Sync README quickstart with manifest.',
      executorSummary: 'Updated README run commands.',
      qaSummary: 'All criteria met; run converged.',
    },
  ]).run();

  const verdict1 = randomUUID();
  const verdict2 = randomUUID();
  db.insert(verdicts).values([
    {
      id: verdict1, iterationId: iter1, verdict: 'iterate', confidence: 0.72,
      stabilitySignal: 'improving', suggestedNextFocus: 'documentation drift',
    },
    {
      id: verdict2, iterationId: iter2, verdict: 'converged', confidence: 0.94,
      stabilitySignal: 'stable', suggestedNextFocus: null,
    },
  ]).run();

  db.insert(findings).values([
    {
      id: randomUUID(), verdictId: verdict1, category: 'error_handling',
      severity: 'high', message: 'Unhandled exceptions return bare 500 HTML.',
      evidence: 'GET /orders/999 -> 500 text/html', isNew: true,
    },
    {
      id: randomUUID(), verdictId: verdict1, category: 'config',
      severity: 'medium', message: 'No .env.example committed.',
      evidence: 'repo root listing', isNew: true,
    },
  ]).run();

  db.insert(proposals).values({
    id: randomUUID(), archetype: 'fastapi-api', proposalType: 'add_criterion',
    bodyMd: '- require_request_id_header: every response echoes an X-Request-ID',
    rationaleMd: 'Three recent fastapi-api runs lacked request correlation, '
      + 'making log triage hard. Promote to a standing criterion.',
    source: 'llm', status: 'pending',
  }).run();
}

let cachedApp: Hono | null = null;

export function getApp(): Hono {
  if (cachedApp) return cachedApp;
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  const handle: DbHandle = { db, sqlite };
  migrateFromCwd(sqlite);
  seed(handle);
  cachedApp = buildApp(handle, {
    adminToken: process.env.HUB_ADMIN_TOKEN ?? null,
    anthropic: null,
    dataDir: '/tmp',
    runner: null,
    runnerCfg: null,
  });
  return cachedApp;
}
