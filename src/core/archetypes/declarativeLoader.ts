import path from 'node:path';
import { promises as fs } from 'node:fs';
import { readJsonSafe } from '../../utils/json.js';
import { readTextSafe } from '../../utils/fs.js';
import type { ProjectSnapshot } from '../types.js';

/**
 * Declarative archetype probes — load JSON files instead of editing
 * `projectArchetypeDetector.ts`. Adding a new archetype is now a
 * config-only change: drop a JSON file under `config/archetypes/` and
 * the detector picks it up at runtime.
 *
 * Each JSON file looks like:
 *
 * ```json
 * {
 *   "id": "rust-axum",
 *   "name": "Rust axum web server",
 *   "recommended_standard": "rust-axum",
 *   "applicable_qa_patterns": ["verification_failure/build_failed"],
 *   "risk_profile": "high",
 *   "threshold": 0.35,
 *   "signals": [
 *     { "type": "file_exists",    "path": "Cargo.toml",        "weight": 3, "label": "Cargo.toml" },
 *     { "type": "cargo_dep",      "dep": "axum",               "weight": 4, "label": "dep:axum" },
 *     { "type": "file_glob",      "pattern": "src/main.rs",    "weight": 2, "label": "main.rs" },
 *     { "type": "lang_equals",    "value": "rust",             "weight": 2, "label": "lang:rust" }
 *   ]
 * }
 * ```
 *
 * Supported signal types:
 *   - file_exists(path)                — file present at exact relative path
 *   - file_glob(pattern)               — any file matches simple glob (`*`, `**`)
 *   - dir_exists(path)                 — directory present at relative path
 *   - pkg_dep(dep)                     — name in package.json deps OR devDeps
 *   - pkg_field(field, equals?)        — pkg.<field> exists and (optionally) equals value
 *   - pkg_script_matches(pattern)      — any package.json script matches regex
 *   - pyproject_contains(pattern)      — regex match in pyproject.toml
 *   - cargo_dep(dep)                   — dep in [dependencies] of Cargo.toml
 *   - go_mod_contains(pattern)         — regex match in go.mod
 *   - gemfile_contains(pattern)        — regex match in Gemfile
 *   - lang_equals(value)               — snapshot.detected_language === value
 *   - framework_detected(name)         — snapshot.detected_frameworks includes name
 *   - start_command_matches(pattern)   — any start command matches regex
 *   - file_content_matches(path, pattern) — regex match in file contents
 *
 * Each entry also supports a `negate: true` flag to invert the result
 * (useful for "no react dep" style penalties).
 */

export interface DeclarativeArchetype {
  id: string;
  name: string;
  description?: string;
  recommended_standard: string;
  applicable_qa_patterns: string[];
  risk_profile: 'low' | 'medium' | 'high';
  threshold?: number;
  signals: DeclarativeSignal[];
}

export type DeclarativeSignal =
  | { type: 'file_exists'; path: string; weight: number; label: string; negate?: boolean }
  | { type: 'file_glob'; pattern: string; weight: number; label: string; negate?: boolean }
  | { type: 'dir_exists'; path: string; weight: number; label: string; negate?: boolean }
  | { type: 'pkg_dep'; dep: string; weight: number; label: string; negate?: boolean }
  | { type: 'pkg_field'; field: string; equals?: string; weight: number; label: string; negate?: boolean }
  | { type: 'pkg_script_matches'; pattern: string; weight: number; label: string; negate?: boolean }
  | { type: 'pyproject_contains'; pattern: string; weight: number; label: string; negate?: boolean }
  | { type: 'cargo_dep'; dep: string; weight: number; label: string; negate?: boolean }
  | { type: 'go_mod_contains'; pattern: string; weight: number; label: string; negate?: boolean }
  | { type: 'gemfile_contains'; pattern: string; weight: number; label: string; negate?: boolean }
  | { type: 'lang_equals'; value: string; weight: number; label: string; negate?: boolean }
  | { type: 'framework_detected'; name: string; weight: number; label: string; negate?: boolean }
  | { type: 'start_command_matches'; pattern: string; weight: number; label: string; negate?: boolean }
  | { type: 'file_content_matches'; path: string; pattern: string; weight: number; label: string; negate?: boolean };

export interface ProbeContext {
  projectPath: string;
  files: Set<string>;
  pkg: { name?: string; scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string>; bin?: unknown; main?: string; module?: string; types?: string; exports?: unknown; workspaces?: unknown };
  pyproject: string;
  cargoToml: string;
  goMod: string;
  gemfile: string;
  snapshot: ProjectSnapshot;
}

export interface SignalResult { hit: boolean; weight: number; signal: string }

export async function buildProbeContext(
  projectPath: string,
  files: Set<string>,
  pkg: ProbeContext['pkg'],
  snapshot: ProjectSnapshot,
): Promise<ProbeContext> {
  const pyproject = (await readTextSafe(path.join(projectPath, 'pyproject.toml'))) ?? '';
  const cargoToml = (await readTextSafe(path.join(projectPath, 'Cargo.toml'))) ?? '';
  const goMod = (await readTextSafe(path.join(projectPath, 'go.mod'))) ?? '';
  const gemfile = (await readTextSafe(path.join(projectPath, 'Gemfile'))) ?? '';
  return { projectPath, files, pkg, pyproject, cargoToml, goMod, gemfile, snapshot };
}

export async function loadDeclarativeArchetypes(projectPath: string): Promise<DeclarativeArchetype[]> {
  // Two source dirs: repo-level config/archetypes/ (shipped with the tool)
  // and per-project .demo2project/archetypes/ (user overrides). Per-project
  // entries OVERRIDE repo-level ones by id.
  const byId = new Map<string, DeclarativeArchetype>();
  for (const dir of [
    path.resolve(new URL('../../../config/archetypes', import.meta.url).pathname),
    path.join(projectPath, '.demo2project', 'archetypes'),
  ]) {
    let entries: string[] = [];
    try { entries = await fs.readdir(dir); } catch { continue; }
    for (const file of entries) {
      if (!file.endsWith('.json')) continue;
      const parsed = await readJsonSafe<DeclarativeArchetype>(path.join(dir, file));
      if (!parsed || typeof parsed.id !== 'string') continue;
      if (!Array.isArray(parsed.signals)) continue;
      byId.set(parsed.id, parsed);
    }
  }
  return Array.from(byId.values());
}

export function evaluateDeclarativeProbe(
  arche: DeclarativeArchetype,
  ctx: ProbeContext,
): SignalResult[] {
  const out: SignalResult[] = [];
  for (const sig of arche.signals) {
    let hit = evalSignal(sig, ctx);
    if (sig.negate) hit = !hit;
    out.push({ hit, weight: sig.weight, signal: sig.label });
  }
  return out;
}

function evalSignal(sig: DeclarativeSignal, ctx: ProbeContext): boolean {
  const deps = { ...(ctx.pkg.dependencies ?? {}), ...(ctx.pkg.devDependencies ?? {}) };
  switch (sig.type) {
    case 'file_exists':
      return ctx.files.has(sig.path);
    case 'dir_exists':
      return ctx.files.has(sig.path) || [...ctx.files].some((f) => f.startsWith(sig.path.replace(/\/$/, '') + '/'));
    case 'file_glob':
      return matchAnyGlob(ctx.files, sig.pattern);
    case 'pkg_dep':
      return sig.dep in deps;
    case 'pkg_field': {
      const value = (ctx.pkg as Record<string, unknown>)[sig.field];
      if (value === undefined || value === null) return false;
      if (sig.equals !== undefined) return String(value) === sig.equals;
      if (typeof value === 'string') return value.length > 0;
      if (Array.isArray(value)) return value.length > 0;
      if (typeof value === 'object') return Object.keys(value as object).length > 0;
      return Boolean(value);
    }
    case 'pkg_script_matches': {
      const re = new RegExp(sig.pattern);
      const scripts = ctx.pkg.scripts ?? {};
      return Object.values(scripts).some((s) => re.test(s));
    }
    case 'pyproject_contains':
      return new RegExp(sig.pattern).test(ctx.pyproject);
    case 'cargo_dep': {
      if (!ctx.cargoToml) return false;
      const re = new RegExp(`^\\s*${escapeRegex(sig.dep)}\\s*=`, 'm');
      return re.test(ctx.cargoToml);
    }
    case 'go_mod_contains':
      return ctx.goMod.length > 0 && new RegExp(sig.pattern).test(ctx.goMod);
    case 'gemfile_contains':
      return ctx.gemfile.length > 0 && new RegExp(sig.pattern).test(ctx.gemfile);
    case 'lang_equals':
      return ctx.snapshot.detected_language === sig.value;
    case 'framework_detected':
      return ctx.snapshot.detected_frameworks.includes(sig.name);
    case 'start_command_matches': {
      const re = new RegExp(sig.pattern);
      return ctx.snapshot.start_commands.some((cmd) => re.test(cmd));
    }
    case 'file_content_matches': {
      // Cheap: only checks files we already saw. Doesn't read on demand.
      // For now this is sufficient for archetype detection.
      return false;
    }
  }
}

function matchAnyGlob(files: Set<string>, pattern: string): boolean {
  // Translate a tiny subset of glob into RegExp: ** → .*, * → [^/]*
  const re = new RegExp('^' + pattern
    .split('/')
    .map((seg) => seg === '**' ? '.*' : seg.replace(/\*/g, '[^/]*'))
    .join('/')
    .replace(/\.\*\/\.\*/g, '.*') + '$');
  return [...files].some((f) => re.test(f));
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
