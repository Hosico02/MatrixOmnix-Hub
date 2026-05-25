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
