import path from 'node:path';
import type { ProjectSnapshot } from './types.js';
import { readTextSafe, listFiles } from '../utils/fs.js';
import { readJsonSafe } from '../utils/json.js';
import { takeSnapshot } from './projectSnapshot.js';
import {
  loadDeclarativeArchetypes,
  buildProbeContext,
  evaluateDeclarativeProbe,
  type DeclarativeArchetype,
} from './archetypes/declarativeLoader.js';

/**
 * ProjectArchetypeDetector (Phase 5) — identifies what kind of project this
 * is, deterministically and explainably.
 *
 * No machine learning, no embeddings — pure signal scanning. Returns a
 * primary archetype with confidence + the runners-up + the per-archetype
 * signal scores. Callers can use this to:
 *   - pick the right ProjectStandard
 *   - filter applicable QA cases
 *   - decide which executor / verification commands make sense
 */

export type ArchetypeId =
  | 'node-cli'
  | 'typescript-library'
  | 'react-app'
  | 'nextjs-app'
  | 'vue-app'
  | 'python-cli'
  | 'python-package'
  | 'fastapi-api'
  | 'flask-web-app'
  | 'monorepo'
  | 'docs-only-project'
  | 'agent-framework'
  | 'unknown';

export interface ProjectArchetype {
  id: ArchetypeId;
  name: string;
  confidence: number;          // 0..1
  detected_signals: string[];
  missing_signals: string[];
  recommended_standard: string;
  applicable_qa_patterns: string[]; // category names
  risk_profile: 'low' | 'medium' | 'high';
}

export interface ArchetypeReport {
  primary: ProjectArchetype;
  alternatives: ProjectArchetype[];
}

interface SignalContext {
  files: Set<string>;
  has: (rel: string) => boolean;
  pkg: { name?: string; scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string>; bin?: unknown; main?: string; module?: string; types?: string; exports?: unknown; workspaces?: unknown };
  pyproject: string;
  snapshot: ProjectSnapshot;
}

type Probe = (ctx: SignalContext) => { hit: boolean; weight: number; signal: string }[];

const PROBES: Record<ArchetypeId, Probe> = {
  'nextjs-app': (c) => {
    const out: { hit: boolean; weight: number; signal: string }[] = [];
    const deps = { ...(c.pkg.dependencies ?? {}), ...(c.pkg.devDependencies ?? {}) };
    out.push({ hit: 'next' in deps, weight: 4, signal: 'dep:next' });
    out.push({ hit: c.has('next.config.js') || c.has('next.config.mjs') || c.has('next.config.ts'), weight: 3, signal: 'next.config.*' });
    out.push({ hit: c.has('app/') || c.has('pages/') || [...c.files].some((f) => f.startsWith('app/') || f.startsWith('pages/')), weight: 3, signal: 'app/ or pages/' });
    out.push({ hit: !!(c.pkg.scripts && /\bnext\s+(dev|build|start)/.test(Object.values(c.pkg.scripts).join(' '))), weight: 2, signal: 'next scripts' });
    return out;
  },
  'react-app': (c) => {
    const out: { hit: boolean; weight: number; signal: string }[] = [];
    const deps = { ...(c.pkg.dependencies ?? {}), ...(c.pkg.devDependencies ?? {}) };
    out.push({ hit: 'react' in deps, weight: 3, signal: 'dep:react' });
    out.push({ hit: 'react-dom' in deps, weight: 2, signal: 'dep:react-dom' });
    out.push({ hit: 'vite' in deps || 'react-scripts' in deps || 'webpack' in deps, weight: 2, signal: 'dep:bundler' });
    out.push({ hit: c.has('index.html') || [...c.files].some((f) => f.endsWith('/index.html')), weight: 2, signal: 'index.html' });
    out.push({ hit: [...c.files].some((f) => /(^|\/)App\.(tsx|jsx)$/.test(f)), weight: 2, signal: 'App.[t|j]sx' });
    out.push({ hit: 'next' in deps, weight: -5, signal: 'NOT next (penalty)' });
    return out;
  },
  'vue-app': (c) => {
    const out: { hit: boolean; weight: number; signal: string }[] = [];
    const deps = { ...(c.pkg.dependencies ?? {}), ...(c.pkg.devDependencies ?? {}) };
    out.push({ hit: 'vue' in deps, weight: 4, signal: 'dep:vue' });
    out.push({ hit: '@vitejs/plugin-vue' in deps || 'vite' in deps, weight: 2, signal: 'dep:vue bundler' });
    out.push({ hit: [...c.files].some((f) => /(^|\/)App\.vue$/.test(f)), weight: 3, signal: 'App.vue' });
    out.push({ hit: c.has('index.html') || [...c.files].some((f) => f.endsWith('/index.html')), weight: 1, signal: 'index.html' });
    out.push({ hit: !('react' in deps) && !('next' in deps), weight: 1, signal: 'not react/next' });
    return out;
  },
  'node-cli': (c) => {
    const out: { hit: boolean; weight: number; signal: string }[] = [];
    out.push({ hit: !!c.pkg.bin, weight: 4, signal: 'package.json bin' });
    out.push({ hit: c.has('bin/') || [...c.files].some((f) => f.startsWith('bin/')), weight: 2, signal: 'bin/ dir' });
    const deps = { ...(c.pkg.dependencies ?? {}), ...(c.pkg.devDependencies ?? {}) };
    out.push({ hit: 'commander' in deps || 'yargs' in deps || 'cac' in deps || 'clipanion' in deps, weight: 2, signal: 'cli framework dep' });
    out.push({ hit: !!(c.pkg.scripts?.start ?? c.pkg.bin), weight: 1, signal: 'start script or bin' });
    out.push({ hit: !('react' in deps), weight: 1, signal: 'no react' });
    out.push({ hit: !('next' in deps), weight: 1, signal: 'no next' });
    return out;
  },
  'typescript-library': (c) => {
    const out: { hit: boolean; weight: number; signal: string }[] = [];
    out.push({ hit: c.has('tsconfig.json'), weight: 3, signal: 'tsconfig.json' });
    out.push({ hit: !!c.pkg.types || !!c.pkg.exports, weight: 3, signal: 'pkg.types/exports' });
    out.push({ hit: !!c.pkg.main || !!c.pkg.module, weight: 1, signal: 'pkg.main/module' });
    out.push({ hit: !c.pkg.bin, weight: 1, signal: 'no bin' });
    const deps = { ...(c.pkg.dependencies ?? {}), ...(c.pkg.devDependencies ?? {}) };
    out.push({ hit: 'typescript' in deps, weight: 2, signal: 'dep:typescript' });
    out.push({ hit: !('react' in deps) && !('next' in deps), weight: 1, signal: 'no app framework' });
    return out;
  },
  'python-cli': (c) => {
    const out: { hit: boolean; weight: number; signal: string }[] = [];
    out.push({ hit: c.has('pyproject.toml') || c.has('setup.py'), weight: 3, signal: 'pyproject/setup.py' });
    out.push({ hit: /\bconsole_scripts\b/.test(c.pyproject), weight: 3, signal: 'console_scripts' });
    out.push({ hit: /\b(typer|click|argparse|fire)\b/.test(c.pyproject), weight: 2, signal: 'cli dep' });
    out.push({ hit: c.snapshot.detected_language === 'python', weight: 2, signal: 'detected_language:python' });
    out.push({ hit: !/\bfastapi\b/.test(c.pyproject), weight: 1, signal: 'no fastapi' });
    return out;
  },
  'python-package': (c) => {
    const out: { hit: boolean; weight: number; signal: string }[] = [];
    out.push({ hit: c.has('pyproject.toml') || c.has('setup.py') || c.has('setup.cfg'), weight: 3, signal: 'packaging metadata' });
    out.push({ hit: c.snapshot.detected_language === 'python', weight: 2, signal: 'python lang' });
    out.push({ hit: [...c.files].some((f) => f.startsWith('src/') && f.endsWith('.py')), weight: 2, signal: 'src/*.py layout' });
    out.push({ hit: !/\bconsole_scripts\b/.test(c.pyproject), weight: 1, signal: 'no console_scripts' });
    out.push({ hit: !/\bfastapi\b/.test(c.pyproject), weight: 1, signal: 'no fastapi' });
    return out;
  },
  'fastapi-api': (c) => {
    const out: { hit: boolean; weight: number; signal: string }[] = [];
    out.push({ hit: /\bfastapi\b/.test(c.pyproject) || c.snapshot.detected_frameworks.includes('fastapi'), weight: 4, signal: 'fastapi dep/detection' });
    out.push({ hit: [...c.files].some((f) => /(^|\/)main\.py$/.test(f) || /(^|\/)app\/main\.py$/.test(f)), weight: 2, signal: 'main.py' });
    out.push({ hit: /\buvicorn\b/.test(c.pyproject), weight: 1, signal: 'uvicorn' });
    return out;
  },
  'flask-web-app': (c) => {
    const out: { hit: boolean; weight: number; signal: string }[] = [];
    out.push({ hit: c.snapshot.detected_frameworks.includes('flask'), weight: 4, signal: 'flask framework detection' });
    out.push({ hit: [...c.files].some((f) => /(^|\/)(app|wsgi)\.py$/.test(f)), weight: 2, signal: 'app.py or wsgi.py' });
    out.push({ hit: c.has('templates/') || [...c.files].some((f) => f.startsWith('templates/')), weight: 1, signal: 'templates/' });
    out.push({ hit: [...c.files].some((f) => /(^|\/)tests?\/test_(app|routes|api)\.py$/.test(f)), weight: 2, signal: 'route/API tests' });
    out.push({ hit: c.snapshot.start_commands.some((cmd) => /\b(flask|gunicorn|python3?\s+app\.py)\b/.test(cmd)), weight: 2, signal: 'flask start command' });
    out.push({ hit: !c.snapshot.detected_frameworks.includes('fastapi'), weight: 1, signal: 'not fastapi' });
    return out;
  },
  monorepo: (c) => {
    const out: { hit: boolean; weight: number; signal: string }[] = [];
    out.push({ hit: c.has('pnpm-workspace.yaml'), weight: 3, signal: 'pnpm-workspace.yaml' });
    out.push({ hit: !!c.pkg.workspaces, weight: 3, signal: 'pkg.workspaces' });
    out.push({ hit: c.has('turbo.json') || c.has('nx.json') || c.has('lerna.json'), weight: 3, signal: 'turbo/nx/lerna' });
    out.push({ hit: [...c.files].some((f) => f.startsWith('packages/') || f.startsWith('apps/')), weight: 2, signal: 'packages/ or apps/' });
    out.push({ hit: [...c.files].filter((f) => f.endsWith('/package.json')).length > 1, weight: 2, signal: 'multiple package.json' });
    return out;
  },
  'docs-only-project': (c) => {
    const out: { hit: boolean; weight: number; signal: string }[] = [];
    const docCount = [...c.files].filter((f) => /\.(md|mdx)$/.test(f)).length;
    const codeCount = [...c.files].filter((f) => /\.(ts|tsx|js|jsx|py|go|rs)$/.test(f)).length;
    out.push({ hit: docCount >= 5 && codeCount === 0, weight: 5, signal: '5+ md, 0 source' });
    out.push({ hit: c.has('mkdocs.yml') || c.has('docusaurus.config.js'), weight: 3, signal: 'docs site config' });
    out.push({ hit: docCount > codeCount && docCount > 3, weight: 2, signal: 'docs > code' });
    return out;
  },
  'agent-framework': (c) => {
    const out: { hit: boolean; weight: number; signal: string }[] = [];
    out.push({ hit: [...c.files].some((f) => f.startsWith('src/agents/') || f === 'agents/'), weight: 3, signal: 'agents/ dir' });
    out.push({ hit: [...c.files].some((f) => /provider/i.test(f) && f.endsWith('.ts')), weight: 2, signal: 'provider files' });
    out.push({ hit: [...c.files].some((f) => /workflow|planner|orchestrator/.test(f)), weight: 1, signal: 'workflow/planner naming' });
    out.push({ hit: [...c.files].some((f) => f.startsWith('src/qa/') || f.startsWith('qa/')), weight: 2, signal: 'qa/ dir' });
    out.push({ hit: [...c.files].some((f) => /verification|verifier/i.test(f)), weight: 2, signal: 'verifier files' });
    return out;
  },
  unknown: () => [],
};

const RECOMMENDED_STANDARD: Record<ArchetypeId, string> = {
  'node-cli': 'node-cli',
  'typescript-library': 'typescript-library',
  'react-app': 'react-app',
  'nextjs-app': 'nextjs-app',
  'vue-app': 'vue-app',
  'python-cli': 'python-cli',
  'python-package': 'python-package',
  'fastapi-api': 'fastapi-api',
  'flask-web-app': 'flask-web-app',
  monorepo: 'monorepo',
  'docs-only-project': 'docs-only-project',
  'agent-framework': 'agent-framework',
  unknown: 'generic-project',
};

const APPLICABLE_PATTERNS: Record<ArchetypeId, string[]> = {
  'node-cli': ['docs_failure/readme_command_missing', 'process_failure/missing_validation_after_code_change', 'test_quality_failure/empty_test'],
  'typescript-library': ['verification_failure/typecheck_failed', 'verification_failure/build_failed', 'test_quality_failure/empty_test'],
  'react-app': ['verification_failure/build_failed', 'project_structure_failure/missing_env_example'],
  'nextjs-app': ['verification_failure/build_failed', 'safety_failure/secret_leak'],
  'vue-app': ['verification_failure/build_failed', 'project_structure_failure/missing_env_example'],
  'python-cli': ['docs_failure/readme_command_missing', 'project_structure_failure/missing_entrypoint'],
  'python-package': ['verification_failure/test_failed', 'project_structure_failure/missing_config'],
  'fastapi-api': ['safety_failure/insecure_default', 'safety_failure/secret_leak', 'verification_failure/smoke_test_failed'],
  'flask-web-app': ['safety_failure/insecure_default', 'safety_failure/secret_leak', 'verification_failure/smoke_test_failed'],
  monorepo: ['project_structure_failure/unclear_module_boundary', 'verification_failure/build_failed'],
  'docs-only-project': ['docs_failure/docs_claim_without_evidence', 'docs_failure/outdated_docs'],
  'agent-framework': ['process_failure/missing_validation_after_code_change', 'process_failure/supervisor_accepted_unverified_result', 'executor_failure/output_unparseable'],
  unknown: ['process_failure/missing_validation_after_code_change'],
};

const RISK_PROFILE: Record<ArchetypeId, 'low' | 'medium' | 'high'> = {
  'node-cli': 'low',
  'typescript-library': 'low',
  'react-app': 'medium',
  'nextjs-app': 'medium',
  'vue-app': 'medium',
  'python-cli': 'low',
  'python-package': 'low',
  'fastapi-api': 'high',
  'flask-web-app': 'high',
  monorepo: 'medium',
  'docs-only-project': 'low',
  'agent-framework': 'high',
  unknown: 'medium',
};

export async function detectArchetype(projectPath: string): Promise<ArchetypeReport> {
  const snapshot = await takeSnapshot(projectPath);
  const files = new Set(await listFiles(projectPath));
  const has = (rel: string): boolean => files.has(rel) || [...files].some((f) => f.startsWith(rel + '/') || f === rel);
  const pkg = (await readJsonSafe<SignalContext['pkg']>(path.join(projectPath, 'package.json'))) ?? {};
  const pyproject = (await readTextSafe(path.join(projectPath, 'pyproject.toml'))) ?? '';

  const ctx: SignalContext = { files, has, pkg, pyproject, snapshot };
  const declarativeCtx = await buildProbeContext(projectPath, files, pkg, snapshot);
  const declarative: DeclarativeArchetype[] = await loadDeclarativeArchetypes(projectPath);
  const declarativeIds = new Set(declarative.map((d) => d.id));

  interface ScoreEntry {
    id: string;
    raw: number;
    max: number;
    signals: string[];
    missing: string[];
    recommended: string;
    patterns: string[];
    risk: 'low' | 'medium' | 'high';
    threshold: number;
  }
  const scores: ScoreEntry[] = [];
  for (const [id, probe] of Object.entries(PROBES) as [ArchetypeId, Probe][]) {
    if (id === 'unknown') continue;
    if (declarativeIds.has(id)) continue; // JSON override wins for built-in ids.
    const probes = probe(ctx);
    const max = probes.reduce((a, p) => a + Math.max(0, p.weight), 0);
    const raw = probes.reduce((a, p) => a + (p.hit ? p.weight : 0), 0);
    const signals = probes.filter((p) => p.hit && p.weight > 0).map((p) => p.signal);
    const missing = probes.filter((p) => !p.hit && p.weight > 0).map((p) => p.signal);
    scores.push({
      id,
      raw,
      max,
      signals,
      missing,
      recommended: RECOMMENDED_STANDARD[id],
      patterns: APPLICABLE_PATTERNS[id],
      risk: RISK_PROFILE[id],
      threshold: 0.35,
    });
  }
  for (const arche of declarative) {
    const probes = evaluateDeclarativeProbe(arche, declarativeCtx);
    const max = probes.reduce((a, p) => a + Math.max(0, p.weight), 0);
    const raw = probes.reduce((a, p) => a + (p.hit ? p.weight : 0), 0);
    const signals = probes.filter((p) => p.hit && p.weight > 0).map((p) => p.signal);
    const missing = probes.filter((p) => !p.hit && p.weight > 0).map((p) => p.signal);
    scores.push({
      id: arche.id,
      raw,
      max,
      signals,
      missing,
      recommended: arche.recommended_standard,
      patterns: arche.applicable_qa_patterns,
      risk: arche.risk_profile,
      threshold: arche.threshold ?? 0.35,
    });
  }
  scores.sort((a, b) => b.raw / Math.max(1, b.max) - a.raw / Math.max(1, a.max));

  const top = scores[0]!;
  const confidence = top.max === 0 ? 0 : Math.max(0, Math.min(1, top.raw / top.max));
  const isUnknown = confidence < top.threshold;

  const toArchetype = (s: ScoreEntry, conf?: number): ProjectArchetype => ({
    id: s.id as ArchetypeId,
    name: s.id,
    confidence: conf ?? Math.max(0, Math.min(1, s.raw / Math.max(1, s.max))),
    detected_signals: s.signals,
    missing_signals: s.missing,
    recommended_standard: s.recommended,
    applicable_qa_patterns: s.patterns,
    risk_profile: s.risk,
  });

  const primary: ProjectArchetype = isUnknown
    ? {
        id: 'unknown',
        name: 'unknown',
        confidence,
        detected_signals: top.signals,
        missing_signals: top.missing,
        recommended_standard: 'generic-project',
        applicable_qa_patterns: APPLICABLE_PATTERNS.unknown,
        risk_profile: 'medium',
      }
    : toArchetype(top);

  const alternatives = scores.slice(1, 4).filter((s) => s.raw > 0).map((s) => toArchetype(s));
  return { primary, alternatives };
}
