#!/usr/bin/env node
/**
 * Real-project generalization benchmark.
 *
 * Clones a curated set of public GitHub demo / library repos and runs
 * `matrixomnix analyze` + `gap --fast` on each. Captures detected
 * language / frameworks, finding counts by severity, and whether the
 * project triggered any specialized productization gates or fell into
 * the generic `unknown` archetype path.
 *
 * Output: reports/generalization-bench/<timestamp>.md + .json
 *
 * Usage: node scripts/generalization-bench.mjs [--repos=path/to/list]
 *
 * Why this exists: the 15 internal stress fixtures cover ~5 base
 * archetypes. Internal claims like "15/15 product-ready" do NOT measure
 * how the detector handles a project it has never seen. This script
 * runs the analyzer on unfamiliar code and reports honest hit/miss
 * numbers.
 */
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';

const execFileAsync = promisify(execFile);

// Curated repo list — small/medium public demos and libraries spanning
// known archetypes AND deliberate edge cases (Rust, Go, ML, hybrid).
// Each entry: { slug, why, expectedArchetype | null, sparse? }
const REPOS = [
  // --- expected to land in a known archetype ---
  { slug: 'pallets/flask', why: 'canonical Flask library + examples (Python web)', expectedArchetype: 'flask-web-app' },
  { slug: 'tiangolo/fastapi', why: 'canonical FastAPI library + tutorial (Python API)', expectedArchetype: 'fastapi-api' },
  { slug: 'expressjs/express', why: 'canonical Express library + examples (Node web)', expectedArchetype: 'node-cli-or-web' },
  { slug: 'tj/commander.js', why: 'canonical Node CLI helper (Node CLI)', expectedArchetype: 'node-cli' },
  { slug: 'vuejs/core', why: 'Vue 3 source (JS framework)', expectedArchetype: 'vue-app-or-monorepo' },
  // --- specialized surfaces ---
  { slug: 'microsoft/vscode-extension-samples', why: 'browser/IDE extension monorepo', expectedArchetype: 'browser-extension-or-monorepo' },
  { slug: 'gradio-app/gradio', why: 'Python+JS hybrid ML UI framework', expectedArchetype: 'fastapi-api-or-hybrid' },
  // --- edge cases (should fail to a known archetype) ---
  { slug: 'tokio-rs/axum', why: 'Rust web framework — system has no Rust archetype', expectedArchetype: null },
  { slug: 'gin-gonic/gin', why: 'Go web framework — system has no Go archetype', expectedArchetype: null },
  { slug: 'rails/rails', why: 'Ruby/Rails — system has no Rails archetype', expectedArchetype: null, sparse: true },
  { slug: 'spring-projects/spring-petclinic', why: 'Java/Spring demo — system has no JVM archetype', expectedArchetype: null },
  // --- ML / atypical ---
  { slug: 'karpathy/nanoGPT', why: 'Python ML training script — closer to research code than demo', expectedArchetype: 'python-package-or-unknown' },
  { slug: 'lucidrains/vit-pytorch', why: 'Python ML library', expectedArchetype: 'python-package' },
  // --- static / docs ---
  { slug: 'rust-lang/book', why: 'Markdown docs site (mdbook source)', expectedArchetype: 'docs-only' },
  // --- LLM chat demo ---
  { slug: 'a16z-infra/ai-chatbot', why: 'Next.js + LLM chat demo', expectedArchetype: 'nextjs-app-llm-chat' },
];

const TIMEOUT_MS = 90_000;
const CLONE_TIMEOUT_MS = 180_000;

function log(msg) {
  process.stderr.write(`[bench] ${msg}\n`);
}

async function shallowClone(slug, dest) {
  const url = `https://github.com/${slug}.git`;
  await execFileAsync('git', ['clone', '--depth', '1', '--filter=blob:none', url, dest], {
    timeout: CLONE_TIMEOUT_MS,
    maxBuffer: 16 * 1024 * 1024,
  });
}

function runCli(args, cwd) {
  return new Promise((resolve) => {
    const child = spawn('node', ['dist/cli/index.js', ...args], {
      cwd,
      timeout: TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => { stdout += b.toString(); });
    child.stderr.on('data', (b) => { stderr += b.toString(); });
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
    child.on('error', (err) => resolve({ code: -1, stdout, stderr: stderr + '\n' + err.message }));
  });
}

function parseJsonPayload(stdout) {
  // CLI writes JSON then a summary line. Find the JSON object boundary.
  const trimmed = stdout.trim();
  const closeIdx = trimmed.lastIndexOf('}');
  if (closeIdx < 0) return null;
  const candidate = trimmed.slice(0, closeIdx + 1);
  try { return JSON.parse(candidate); } catch { return null; }
}

async function benchOne(repo, workspace) {
  const slug = repo.slug;
  const safe = slug.replace('/', '__');
  const cloneDir = path.join(workspace, safe);
  const start = Date.now();
  const result = {
    slug,
    why: repo.why,
    expectedArchetype: repo.expectedArchetype,
    cloneOk: false,
    cloneMs: 0,
    analyzeOk: false,
    analyzeMs: 0,
    gapOk: false,
    gapMs: 0,
    detectedLanguage: null,
    detectedFrameworks: [],
    archetype: null,
    archetypeConfidence: null,
    findingCount: 0,
    blockerCount: 0,
    highCount: 0,
    productMaturity: null,
    score: null,
    grade: null,
    topFindings: [],
    sourcePath: cwd(),
    error: null,
  };

  try {
    const cloneStart = Date.now();
    await shallowClone(slug, cloneDir);
    result.cloneOk = true;
    result.cloneMs = Date.now() - cloneStart;
    log(`${slug}: cloned in ${result.cloneMs}ms`);

    const aStart = Date.now();
    const analyzeOut = await runCli(['analyze', '--project', cloneDir], cwd());
    result.analyzeMs = Date.now() - aStart;
    if (analyzeOut.code === 0) {
      result.analyzeOk = true;
      const payload = parseJsonPayload(analyzeOut.stdout);
      if (payload?.snapshot) {
        result.detectedLanguage = payload.snapshot.detected_language ?? null;
        result.detectedFrameworks = payload.snapshot.detected_frameworks ?? [];
      }
      if (payload?.score) {
        result.score = payload.score.total ?? null;
        result.grade = payload.score.grade ?? null;
      }
    } else {
      result.error = `analyze exit ${analyzeOut.code}: ${analyzeOut.stderr.slice(0, 200)}`;
      log(`${slug}: analyze FAILED — ${result.error}`);
    }

    const gStart = Date.now();
    const gapOut = await runCli(['gap', '--project', cloneDir, '--fast'], cwd());
    result.gapMs = Date.now() - gStart;
    if (gapOut.code === 0) {
      result.gapOk = true;
      const gap = parseJsonPayload(gapOut.stdout);
      if (gap) {
        result.findingCount = (gap.findings ?? []).length;
        result.blockerCount = (gap.blockers ?? []).length;
        result.highCount = (gap.findings ?? []).filter((f) => f.severity === 'high').length;
        result.topFindings = (gap.findings ?? [])
          .slice(0, 5)
          .map((f) => `[${f.severity}] ${f.category}`);
        if (gap.product_maturity) {
          result.productMaturity = `${gap.product_maturity.level} (${gap.product_maturity.score}/100, ${gap.product_maturity.domain})`;
        }
        if (gap.project_snapshot?.detected_archetype) {
          result.archetype = gap.project_snapshot.detected_archetype.id ?? gap.project_snapshot.detected_archetype.name ?? null;
          result.archetypeConfidence = gap.project_snapshot.detected_archetype.confidence ?? null;
        }
      }
    } else {
      result.error = (result.error ? result.error + ' | ' : '') + `gap exit ${gapOut.code}: ${gapOut.stderr.slice(0, 200)}`;
      log(`${slug}: gap FAILED — ${result.error}`);
    }
  } catch (err) {
    result.error = err.message ?? String(err);
    log(`${slug}: ERROR ${result.error}`);
  } finally {
    try { rmSync(cloneDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  result.totalMs = Date.now() - start;
  return result;
}

function cwd() { return path.resolve('.'); }

function renderMarkdown(results) {
  const totals = {
    n: results.length,
    cloneOk: results.filter((r) => r.cloneOk).length,
    analyzeOk: results.filter((r) => r.analyzeOk).length,
    gapOk: results.filter((r) => r.gapOk).length,
    archetypeKnown: results.filter((r) => r.archetype && r.archetype !== 'unknown').length,
    unknown: results.filter((r) => !r.archetype || r.archetype === 'unknown').length,
  };
  const langs = {};
  for (const r of results) {
    const key = r.detectedLanguage ?? '(none)';
    langs[key] = (langs[key] ?? 0) + 1;
  }
  const lines = [];
  lines.push('# Real-project generalization benchmark');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Repos attempted: **${totals.n}**`);
  lines.push(`- Cloned ok: ${totals.cloneOk}/${totals.n}`);
  lines.push(`- Analyze ok: ${totals.analyzeOk}/${totals.n}`);
  lines.push(`- Gap ok: ${totals.gapOk}/${totals.n}`);
  lines.push(`- Archetype assigned (non-unknown): ${totals.archetypeKnown}/${totals.gapOk}`);
  lines.push(`- Unknown / generic fallback: ${totals.unknown}/${totals.gapOk}`);
  lines.push('');
  lines.push('### Language detection distribution');
  lines.push('');
  for (const [k, v] of Object.entries(langs).sort((a, b) => b[1] - a[1])) {
    lines.push(`- ${k}: ${v}`);
  }
  lines.push('');
  lines.push('## Per-repo results');
  lines.push('');
  lines.push('| Repo | Lang | Frameworks | Archetype | Findings (B/H/Total) | Maturity | Score | Notes |');
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    const fw = (r.detectedFrameworks ?? []).slice(0, 4).join(', ') || '—';
    const arche = r.archetype ?? '—';
    const findings = `${r.blockerCount}/${r.highCount}/${r.findingCount}`;
    const maturity = r.productMaturity ?? '—';
    const score = r.score != null ? `${r.score}/100 (${r.grade})` : '—';
    const notes = r.error ? `⚠️ ${r.error.slice(0, 80)}` : (r.expectedArchetype ? `expected: ${r.expectedArchetype}` : 'no archetype expected');
    lines.push(`| \`${r.slug}\` | ${r.detectedLanguage ?? '—'} | ${fw} | ${arche} | ${findings} | ${maturity} | ${score} | ${notes} |`);
  }
  lines.push('');
  lines.push('## Top findings per repo (first 5)');
  lines.push('');
  for (const r of results) {
    lines.push(`### \`${r.slug}\``);
    if (r.topFindings.length === 0) {
      lines.push('_no findings emitted_');
    } else {
      for (const f of r.topFindings) lines.push(`- ${f}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

async function main() {
  if (!existsSync('dist/cli/index.js')) {
    log('dist/cli/index.js missing — running pnpm build');
    await execFileAsync('pnpm', ['build'], { cwd: cwd() });
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportsDir = path.join(cwd(), 'reports', 'generalization-bench');
  mkdirSync(reportsDir, { recursive: true });
  const workspace = path.join(os.tmpdir(), `d2p-gen-bench-${stamp}`);
  mkdirSync(workspace, { recursive: true });

  const results = [];
  for (const repo of REPOS) {
    log(`-- ${repo.slug} --`);
    const r = await benchOne(repo, workspace);
    results.push(r);
    // Stream partial result so a hung run still leaves something on disk.
    writeFileSync(path.join(reportsDir, `${stamp}.partial.json`), JSON.stringify(results, null, 2));
  }
  try { rmSync(workspace, { recursive: true, force: true }); } catch { /* ignore */ }

  const md = renderMarkdown(results);
  writeFileSync(path.join(reportsDir, `${stamp}.md`), md);
  writeFileSync(path.join(reportsDir, `${stamp}.json`), JSON.stringify(results, null, 2));
  try { rmSync(path.join(reportsDir, `${stamp}.partial.json`), { force: true }); } catch { /* ignore */ }
  log(`wrote ${path.relative(cwd(), path.join(reportsDir, stamp + '.md'))}`);
  log(`wrote ${path.relative(cwd(), path.join(reportsDir, stamp + '.json'))}`);
}

main().catch((err) => {
  process.stderr.write(`[bench] fatal: ${err.stack ?? err.message}\n`);
  process.exit(1);
});
