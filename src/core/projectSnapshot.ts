import path from 'node:path';
import type { ProjectSnapshot } from './types.js';
import { listFiles, readTextSafe, fileExists } from '../utils/fs.js';
import { readJsonSafe } from '../utils/json.js';
import { nowIso } from '../utils/time.js';

interface PackageJson {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  type?: string;
  main?: string;
  bin?: unknown;
}

/**
 * Scan a project directory and produce a ProjectSnapshot.
 *
 * Deliberately lightweight — it reads obvious config (package.json,
 * pyproject.toml, requirements.txt), then walks the filesystem with
 * heavy-dir exclusions. No network, no parsing source code.
 */
export async function takeSnapshot(projectPath: string): Promise<ProjectSnapshot> {
  const abs = path.resolve(projectPath);
  const files = await listFiles(abs);
  const fileSet = new Set(files);

  const has = (rel: string): boolean => fileSet.has(rel);
  const hasAny = (rels: string[]): boolean => rels.some(has);

  const pkg = await readJsonSafe<PackageJson>(path.join(abs, 'package.json'));
  const pyproject = await readTextSafe(path.join(abs, 'pyproject.toml'));
  const requirements = await readTextSafe(path.join(abs, 'requirements.txt'));
  const pyFiles = files.filter((f) => f.endsWith('.py'));
  const pythonBlob = `${pyproject ?? ''}\n${requirements ?? ''}`;
  const pkgDeps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  // Tooling deps that a Python project may add for adjunct Node tooling
  // (Playwright/Vite for UI verification scripts). Their presence alone does
  // NOT make the project a JS app — without these the dep list would be
  // empty.
  const PERIPHERAL_NODE_DEPS = new Set([
    '@playwright/test', 'playwright', 'vite', '@vitejs/plugin-vue',
    '@vitejs/plugin-react', 'esbuild', 'typescript', 'tsx', 'tsc-watch',
  ]);
  const nonPeripheralDeps = Object.keys(pkgDeps).filter((d) =>
    !PERIPHERAL_NODE_DEPS.has(d) && !/^@types\//.test(d),
  );
  const packageLooksLikeJsApp =
    nonPeripheralDeps.length > 0 ||
    typeof pkg?.main === 'string' ||
    pkg?.bin !== undefined;
  const strongPythonSignal =
    !!pyproject ||
    !!requirements ||
    hasAny(['app.py', 'main.py', 'cli.py']) ||
    pyFiles.length >= 2;

  let language = 'unknown';
  const frameworks: string[] = [];

  if (strongPythonSignal && (!pkg || !packageLooksLikeJsApp)) {
    language = 'python';
    for (const f of ['fastapi', 'flask', 'django', 'pytest', 'starlette', 'pydantic']) {
      if (new RegExp(`\\b${f}\\b`, 'i').test(pythonBlob)) frameworks.push(f);
    }
  } else if (pkg) {
    language = 'typescript-or-javascript';
    const deps = pkgDeps;
    if ('typescript' in deps || (has('tsconfig.json') && !strongPythonSignal)) language = 'typescript';
    else if (Object.keys(pkg).length > 0) language = 'javascript';
    for (const f of ['react', 'next', 'vue', 'svelte', 'express', 'fastify', 'nestjs', 'vitest', 'jest', 'mocha']) {
      if (f in deps) frameworks.push(f);
    }
  } else if (pyproject || requirements || pyFiles.length > 0) {
    language = 'python';
    for (const f of ['fastapi', 'flask', 'django', 'pytest', 'starlette', 'pydantic']) {
      if (new RegExp(`\\b${f}\\b`, 'i').test(pythonBlob)) frameworks.push(f);
    }
  } else if (files.some((f) => f.endsWith('.go'))) {
    language = 'go';
  } else if (files.some((f) => f.endsWith('.rs'))) {
    language = 'rust';
  }

  let pm: ProjectSnapshot['package_manager'] = 'unknown';
  if (language === 'python' && has('poetry.lock')) pm = 'poetry';
  else if (language === 'python' && /\[tool\.poetry\]/.test(pyproject ?? '')) pm = 'poetry';
  else if (language === 'python' && requirements) pm = 'pip';
  else if (language === 'python' && pyproject) pm = 'pip';
  else if (has('pnpm-lock.yaml')) pm = 'pnpm';
  else if (has('yarn.lock')) pm = 'yarn';
  else if (has('bun.lockb') || has('bun.lock')) pm = 'bun';
  else if (has('package-lock.json')) pm = 'npm';
  else if (pkg && language !== 'python') pm = 'npm';
  else if (pyproject) pm = /\[tool\.poetry\]/.test(pyproject) || has('poetry.lock') ? 'poetry' : 'pip';
  else if (requirements) pm = 'pip';

  const scripts = pkg?.scripts ?? {};
  const testCommands: string[] = [];
  const buildCommands: string[] = [];
  const startCommands: string[] = [];

  if (pkg && language !== 'python') {
    const runner = pm === 'yarn' ? 'yarn' : pm === 'pnpm' ? 'pnpm' : pm === 'bun' ? 'bun run' : 'npm run';
    if (scripts.test) testCommands.push(`${runner} test`);
    if (scripts.build) buildCommands.push(`${runner} build`);
    if (scripts.start) startCommands.push(`${runner} start`);
    if (scripts.dev && startCommands.length === 0) startCommands.push(`${runner} dev`);
    if (scripts.typecheck) buildCommands.push(`${runner} typecheck`);
  }
  if (language === 'python') {
    if (files.some((f) => /(^|\/)tests?\//.test(f) || f.startsWith('test_') || f.endsWith('_test.py'))) {
      testCommands.push('python3 -m pytest -q');
    }
    const compileTargets = pyFiles.filter((f) => !/(^|\/)tests?\//.test(f)).slice(0, 12);
    if (compileTargets.length > 0) {
      buildCommands.push(pythonSyntaxCheckCommand(compileTargets));
    }
    if (files.includes('app.py')) startCommands.push('python3 app.py');
    else if (files.includes('main.py')) startCommands.push('python3 main.py');
  }

  // Important + missing files (heuristic)
  const importantCandidates = [
    'README.md',
    'package.json',
    'tsconfig.json',
    'pyproject.toml',
    'requirements.txt',
    'app.py',
    'main.py',
    'cli.py',
    'bin',
    'Dockerfile',
    '.github/workflows',
    'src',
    'tests',
    '.env.example',
    '.gitignore',
  ];
  const importantFiles = importantCandidates.filter((f) =>
    has(f) || files.some((entry) => entry.startsWith(f + '/')),
  );

  const baselineExpected = ['README.md', '.gitignore'];
  if (pkg) baselineExpected.push('package.json', 'tsconfig.json');
  const missingFiles = baselineExpected.filter((f) => !importantFiles.includes(f));

  return {
    project_path: abs,
    detected_language: language,
    detected_frameworks: frameworks,
    package_manager: pm,
    test_commands: testCommands,
    build_commands: buildCommands,
    start_commands: startCommands,
    important_files: importantFiles,
    missing_files: missingFiles,
    dependency_summary: {
      runtime: pkg?.dependencies ? Object.keys(pkg.dependencies).length : 0,
      dev: pkg?.devDependencies ? Object.keys(pkg.devDependencies).length : 0,
      has_lockfile:
        has('pnpm-lock.yaml') ||
        has('yarn.lock') ||
        has('package-lock.json') ||
        has('bun.lockb') ||
        has('poetry.lock') ||
        has('constraints.txt'),
    },
    timestamp: nowIso(),
  };
}

function pythonSyntaxCheckCommand(files: string[]): string {
  const list = files.map((f) => JSON.stringify(f)).join(', ');
  return `python3 -c 'import ast,pathlib; [ast.parse(pathlib.Path(p).read_text(), filename=p) for p in [${list}] if pathlib.Path(p).exists()]'`;
}

/** Lookup helper used by other modules. */
export async function hasFile(projectPath: string, relative: string): Promise<boolean> {
  return fileExists(path.join(projectPath, relative));
}
