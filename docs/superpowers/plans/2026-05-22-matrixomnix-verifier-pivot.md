# MatrixOmnix Verifier-Pivot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert MatrixOmnix from a full demo-to-product harness into a verify-only MCP stdio server (`d2p-verify`) plus a trimmed back-compat CLI. Read-only on projects under verification. d2p repository never touched.

**Architecture:** New `src/mcp/server.ts` registers two MCP tools (`verify_project`, `detect_archetype`) backed by the existing `detectArchetype` / `AnalyzerAgent` / `gapAnalyzer` / scorer pipeline. The do-layer (RuleBasedExecutor, MiniMaxProvider, Supervisor/Planner/Executor, longHorizon Phase-6 stack, executor security guards, ~50 do-side CLI commands) is deleted. Tagline + site copy reframed as "verifier for demo-to-product pipelines."

**Tech Stack:** TypeScript, `@modelcontextprotocol/sdk`, pnpm, vitest. MCP transport = stdio.

---

## Phase 1 — Setup + MCP scaffold (additive, no deletion)

### Task 1: Create verifier-pivot branch

**Files:** (none — branch op)

- [ ] **Step 1: Confirm clean main + create branch**

Run:
```bash
git status -s
git switch -c verifier-pivot
git log --oneline -3
```
Expected: status shows only untracked bench reports; new branch created from `3819111` or later.

---

### Task 2: Install MCP SDK

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add dependency**

Run:
```bash
pnpm add @modelcontextprotocol/sdk
```
Expected: `package.json` gains `"@modelcontextprotocol/sdk": "^x.y.z"` under `dependencies`; lockfile updates.

- [ ] **Step 2: Verify version + typings**

Run:
```bash
node -e "console.log(require('@modelcontextprotocol/sdk/package.json').version)"
```
Expected: prints a version like `1.x.y`.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "deps: add @modelcontextprotocol/sdk for verifier MCP server"
```

---

### Task 3: Create MCP server skeleton

**Files:**
- Create: `src/mcp/server.ts`
- Create: `src/mcp/tools.ts`
- Modify: `package.json` (add `bin.d2p-verify`)

- [ ] **Step 1: Create `src/mcp/tools.ts` with tool schemas**

```typescript
import { z } from 'zod';

export const VerifyProjectInput = z.object({
  path: z.string().describe('Absolute path to the project directory to verify.'),
  archetype_hint: z.string().optional().describe('Optional archetype id to bias detection.'),
});

export const DetectArchetypeInput = z.object({
  path: z.string().describe('Absolute path to the project directory.'),
});

export interface VerifyProjectOutput {
  archetype: { id: string; confidence: number };
  score: number;
  verdict: 'pass' | 'needs_repair' | 'fail';
  findings: Array<{
    category: string;
    severity: string;
    message: string;
    suggested_fix?: string;
    evidence?: string;
  }>;
  evidence: {
    tests_run?: { passed: number; failed: number; output_excerpt: string };
    build_status?: 'pass' | 'fail' | 'not_run';
    type_check_status?: 'pass' | 'fail' | 'not_run';
  };
  qa_preflight: {
    active_cases: Array<{ fingerprint: string; frequency: number; last_seen: string }>;
  };
}

export interface DetectArchetypeOutput {
  primary: {
    id: string;
    confidence: number;
    detected_signals: string[];
    missing_signals: string[];
    recommended_standard: string;
    risk_profile: 'low' | 'medium' | 'high';
  };
  alternatives: Array<{ id: string; confidence: number }>;
}
```

- [ ] **Step 2: Create `src/mcp/server.ts` skeleton (handlers stubbed)**

```typescript
#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { DetectArchetypeInput, VerifyProjectInput } from './tools.js';

const server = new Server(
  { name: 'd2p-verify', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'verify_project',
      description: 'Run the full verifier on a project directory. Returns archetype, score, verdict, findings, evidence and QA preflight.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path to the project directory.' },
          archetype_hint: { type: 'string', description: 'Optional archetype id to bias detection.' },
        },
        required: ['path'],
      },
    },
    {
      name: 'detect_archetype',
      description: 'Detect the project archetype only. Returns primary archetype + top alternatives.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path to the project directory.' },
        },
        required: ['path'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: rawArgs } = request.params;
  if (name === 'verify_project') {
    const args = VerifyProjectInput.parse(rawArgs);
    const result = await runVerify(args.path, args.archetype_hint);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
  if (name === 'detect_archetype') {
    const args = DetectArchetypeInput.parse(rawArgs);
    const result = await runDetectArchetype(args.path);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
  throw new Error(`Unknown tool: ${name}`);
});

async function runVerify(_path: string, _hint?: string) {
  // Wired in Task 5.
  throw new Error('verify_project not yet wired');
}

async function runDetectArchetype(_path: string) {
  // Wired in Task 4.
  throw new Error('detect_archetype not yet wired');
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`d2p-verify fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
```

- [ ] **Step 3: Wire bin entry in `package.json`**

Add to `package.json`:
```json
"bin": {
  "d2p-verify": "dist/mcp/server.js",
  "matrixomnix": "dist/cli/index.js",
  "demo2project": "dist/cli/index.js"
}
```
(Preserve existing keys if any.)

- [ ] **Step 4: Build and smoke-test**

Run:
```bash
pnpm build
node dist/mcp/server.js < /dev/null
```
Expected: process starts, waits on stdin, exits cleanly when stdin closes.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/server.ts src/mcp/tools.ts package.json
git commit -m "mcp: scaffold d2p-verify server with stub handlers"
```

---

### Task 4: Wire detect_archetype

**Files:**
- Modify: `src/mcp/server.ts:runDetectArchetype`

- [ ] **Step 1: Write the failing test**

Create `tests/mcpServer.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

describe('d2p-verify MCP server', () => {
  it('detect_archetype returns python-library for a pyproject + __init__.py fixture', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'mcp-arche-py-'));
    await fs.writeFile(path.join(dir, 'pyproject.toml'),
      '[build-system]\nrequires=["setuptools"]\nbuild-backend="setuptools.build_meta"\n\n[project]\nname="x"\nclassifiers=["License :: OSI Approved"]\n');
    await fs.mkdir(path.join(dir, 'src', 'x'), { recursive: true });
    await fs.writeFile(path.join(dir, 'src', 'x', '__init__.py'), '');
    const { runDetectArchetypeImpl } = await import('../src/mcp/server.js') as any;
    const result = await runDetectArchetypeImpl(dir);
    expect(result.primary.id).toBe('python-library');
    expect(result.primary.confidence).toBeGreaterThan(0.4);
    expect(Array.isArray(result.alternatives)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/mcpServer.test.ts`
Expected: FAIL — "runDetectArchetypeImpl is not a function" or similar.

- [ ] **Step 3: Implement runDetectArchetype + export impl**

Replace the stub in `src/mcp/server.ts`:
```typescript
import { detectArchetype } from '../core/projectArchetypeDetector.js';

export async function runDetectArchetypeImpl(projectPath: string) {
  const report = await detectArchetype(projectPath);
  return {
    primary: {
      id: report.primary.id,
      confidence: report.primary.confidence,
      detected_signals: report.primary.detected_signals,
      missing_signals: report.primary.missing_signals,
      recommended_standard: report.primary.recommended_standard,
      risk_profile: report.primary.risk_profile,
    },
    alternatives: report.alternatives.map((a) => ({ id: a.id, confidence: a.confidence })),
  };
}

async function runDetectArchetype(p: string) {
  return runDetectArchetypeImpl(p);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm build && pnpm exec vitest run tests/mcpServer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/server.ts tests/mcpServer.test.ts
git commit -m "mcp: wire detect_archetype to ProjectArchetypeDetector"
```

---

### Task 5: Wire verify_project

**Files:**
- Modify: `src/mcp/server.ts:runVerify`
- Modify: `tests/mcpServer.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/mcpServer.test.ts`:
```typescript
  it('verify_project returns archetype + score + verdict + findings for a minimal flask app', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'mcp-verify-flask-'));
    await fs.writeFile(path.join(dir, 'requirements.txt'), 'flask\n');
    await fs.writeFile(path.join(dir, 'app.py'),
      'from flask import Flask, jsonify\napp = Flask(__name__)\n@app.get("/health")\ndef h(): return jsonify({"ok": True})\n');
    await fs.writeFile(path.join(dir, 'README.md'), '# x\n\n' + 'x'.repeat(220));
    const { runVerifyImpl } = await import('../src/mcp/server.js') as any;
    const result = await runVerifyImpl(dir);
    expect(typeof result.archetype.id).toBe('string');
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(['pass', 'needs_repair', 'fail']).toContain(result.verdict);
    expect(Array.isArray(result.findings)).toBe(true);
    expect(result.evidence).toBeDefined();
    expect(result.qa_preflight).toBeDefined();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/mcpServer.test.ts`
Expected: the new `verify_project` test FAILs ("runVerifyImpl is not a function" or stub error).

- [ ] **Step 3: Implement runVerify**

Replace `runVerify` in `src/mcp/server.ts`:
```typescript
import { AnalyzerAgent } from '../agents/AnalyzerAgent.js';
import { QAAgent } from '../qa/QAAgent.js';

export async function runVerifyImpl(projectPath: string, _hint?: string) {
  const analyzer = new AnalyzerAgent();
  const { gap, snapshot, score } = await analyzer.fullAnalyze(projectPath);
  const archetype = gap.project_snapshot.detected_archetype ?? null;

  const findings = (gap.findings ?? []).map((f: any) => ({
    category: f.category,
    severity: f.severity,
    message: f.message ?? f.title ?? f.category,
    suggested_fix: f.suggested_fix,
    evidence: f.evidence,
  }));

  const blockerCount = findings.filter((f) => f.severity === 'blocker').length;
  const highCount = findings.filter((f) => f.severity === 'high').length;
  const verdict: 'pass' | 'needs_repair' | 'fail' = blockerCount > 0 ? 'fail'
    : highCount > 0 ? 'needs_repair' : 'pass';

  let qaActive: Array<{ fingerprint: string; frequency: number; last_seen: string }> = [];
  try {
    const qa = new QAAgent();
    const preflight = await qa.preflight(projectPath);
    qaActive = (preflight.active_cases ?? []).map((c: any) => ({
      fingerprint: c.fingerprint,
      frequency: c.frequency ?? 1,
      last_seen: c.last_seen ?? '',
    }));
  } catch {
    qaActive = [];
  }

  return {
    archetype: archetype
      ? { id: archetype.id, confidence: archetype.confidence }
      : { id: 'unknown', confidence: 0 },
    score: typeof score === 'number' ? Math.round(score) : (score?.total ?? 0),
    verdict,
    findings,
    evidence: {
      tests_run: snapshot?.evidence?.tests,
      build_status: snapshot?.evidence?.build_status ?? 'not_run',
      type_check_status: snapshot?.evidence?.type_check_status ?? 'not_run',
    },
    qa_preflight: { active_cases: qaActive },
  };
}

async function runVerify(p: string, hint?: string) {
  return runVerifyImpl(p, hint);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm build && pnpm exec vitest run tests/mcpServer.test.ts`
Expected: PASS for both tests.

- [ ] **Step 5: Verify via MCP inspector (smoke)**

Run:
```bash
npx --yes @modelcontextprotocol/inspector --cli node dist/mcp/server.js --method tools/list 2>&1 | head -20 || true
```
Expected: lists `verify_project` and `detect_archetype` (the inspector CLI may differ — exit OK).

- [ ] **Step 6: Run full test suite**

Run: `pnpm exec vitest run`
Expected: all previously-passing tests still pass + 2 new MCP tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/mcp/server.ts tests/mcpServer.test.ts
git commit -m "mcp: wire verify_project to AnalyzerAgent + gap + QA preflight"
```

---

## Phase 2 — Deletion list

### Task 6: Write the concrete deletion list

**Files:**
- Create: `docs/superpowers/specs/2026-05-22-verifier-pivot-deletion-list.md`

- [ ] **Step 1: Generate file inventory**

Run:
```bash
ls src/agents/providers/ src/agents/advisory/ src/longHorizon/ src/governance/ 2>/dev/null
ls src/cli/commands/
```

- [ ] **Step 2: Author the deletion list**

Create `docs/superpowers/specs/2026-05-22-verifier-pivot-deletion-list.md` with these sections, each enumerating exact file paths. (Implementer fills concrete paths by listing the dirs above; verify each file's responsibility before listing.)

```markdown
# Verifier pivot · concrete deletion list

## Providers (do-layer executors)
- `src/agents/providers/RuleBasedExecutor.ts` (~6k LOC)
- `src/agents/providers/MiniMaxProvider.ts`
- `src/agents/providers/ClaudeCodeProvider.ts`
- `src/agents/providers/FutureProvider.ts`
- `src/agents/providers/NaiveBaselineProvider.ts`
- KEEP: `src/agents/providers/AgentProvider.ts` (the interface — still used by Verifier)
- KEEP: `src/agents/providers/LocalCommandProvider.ts` (used by verifier to run tests)
- KEEP: `src/agents/providers/MockAgentProvider.ts` (used by tests)

## Advisory agents
- `src/agents/advisory/` (entire directory)

## Supervisor / Planner / Executor
- `src/agents/Supervisor.ts`
- `src/agents/Planner.ts`
- `src/agents/Executor.ts`
- KEEP: `src/agents/Verifier.ts`
- KEEP: `src/agents/Reviewer.ts`
- KEEP: `src/agents/AnalyzerAgent.ts`

## Long-horizon (Phase-6)
- `src/longHorizon/` (entire directory)

## Governance + executor-side security guards
- `src/governance/approval/`
- `src/governance/audit/`
- `src/governance/enterprise/`
- `src/governance/incidents/`
- `src/security/capabilities/`
- `src/security/guards/`
- KEEP: `src/security/secrets/`
- KEEP: `src/security/prompt-injection/`
- KEEP: `src/security/policy/` (policy engine still relevant for verifier audit)
- KEEP: `src/privacy/`

## CLI commands (do-layer + autonomy + reporting we won't ship)
- `src/cli/commands/iterate.ts` → REPLACE with redirect stub
- `src/cli/commands/longRun.ts`
- `src/cli/commands/scenario.ts`
- `src/cli/commands/autonomy.ts`
- `src/cli/commands/autonomyRun.ts`
- `src/cli/commands/replay.ts`
- `src/cli/commands/regressionBisector.ts`
- `src/cli/commands/rollback.ts`
- `src/cli/commands/handoff.ts`
- `src/cli/commands/governance.ts`
- `src/cli/commands/governanceEnterprise.ts`
- `src/cli/commands/incident.ts`
- `src/cli/commands/permissions.ts`
- `src/cli/commands/approvals.ts`
- `src/cli/commands/approvalNew.ts`
- `src/cli/commands/learningGovernance.ts`
- `src/cli/commands/plannerCalibration.ts`
- `src/cli/commands/executorReliability.ts`
- `src/cli/commands/selfImprove.ts`
- `src/cli/commands/selfIterate.ts`
- `src/cli/commands/selfIterateSandbox.ts`
- `src/cli/commands/drift.ts`
- `src/cli/commands/compareExecutors.ts`
- `src/cli/commands/providerTest.ts`
- `src/cli/commands/cost.ts`
- `src/cli/commands/modelCatalog.ts`
- `src/cli/commands/research.ts`
- `src/cli/commands/learn.ts`
- `src/cli/commands/standardsFeedback.ts`
- `src/cli/commands/corpus.ts`
- `src/cli/commands/similar.ts`
- `src/cli/commands/generalize.ts`
- `src/cli/commands/evaluate.ts`
- `src/cli/commands/benchmark.ts`
- `src/cli/commands/workspaceReport.ts`
- `src/cli/commands/plan.ts`
- `src/cli/commands/next.ts`
- `src/cli/commands/supplyChain.ts`
- `src/cli/commands/guard.ts`
- `src/cli/commands/audit.ts`
- `src/cli/commands/secrets.ts`
- `src/cli/commands/security.ts`
- `src/cli/commands/promptInjection.ts`
- `src/cli/commands/privacy.ts`
- `src/cli/commands/redactTest.ts`
- `src/cli/commands/integrations.ts`
- `src/cli/commands/githubCli.ts`
- `src/cli/commands/claudeInstallHooks.ts`
- `src/cli/commands/claudeSecurityHooks.ts`
- `src/cli/commands/claudeProductCli.ts`
- `src/cli/commands/extensionsCli.ts`
- `src/cli/commands/recipesCli.ts`
- `src/cli/commands/examplesCli.ts`
- `src/cli/commands/setupCli.ts`
- `src/cli/commands/configCli.ts`
- `src/cli/commands/reportsCli.ts`
- `src/cli/commands/releaseCli.ts`
- `src/cli/commands/qaAudit.ts`
- `src/cli/commands/qaHealth.ts`
- `src/cli/commands/qaLearn.ts`
- `src/cli/commands/qaTransfer.ts`
- `src/cli/commands/taxonomy.ts`
- `src/cli/commands/compatibilityCli.ts`
- `src/cli/commands/diagnostics.ts`
- `src/cli/commands/standards.ts` (KEEP — verifier uses standards)

## Keep (verifier core CLI)
- `src/cli/commands/_shared.ts`
- `src/cli/commands/analyze.ts`
- `src/cli/commands/gap.ts`
- `src/cli/commands/archetype.ts`
- `src/cli/commands/trust.ts`
- `src/cli/commands/docsTruth.ts`
- `src/cli/commands/qaPreflight.ts`
- `src/cli/commands/qaRegression.ts`
- `src/cli/commands/doctor.ts`
- `src/cli/commands/quickstart.ts`
- `src/cli/commands/selfCheck.ts`
- `src/cli/commands/docs.ts`
- `src/cli/commands/init.ts`
- `src/cli/commands/standards.ts`
- `src/cli/commands/evidence.ts` (read-only evidence view OK)

## Demo + stress fixtures
- `demo/` (entire directory — stress fixtures exercise the do chain)
- `package.json:scripts.demo:*` (all demo:* entries)

## Tests targeting deleted code
- Any `tests/*.test.ts` whose only imports point at deleted source. Discover via:
  `for f in tests/*.test.ts; do node -e "..."; done` (or simply tsc and let
  the compiler flag the dead test files).
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-05-22-verifier-pivot-deletion-list.md
git commit -m "spec: concrete deletion list for verifier pivot"
```

---

## Phase 3 — Batched deletions

> **Quality gate after every task in this phase:** `pnpm build` clean AND `pnpm exec vitest run` for remaining tests green. If either fails, fix or revert before next task.

### Task 7: Delete provider executors (do-layer)

**Files:**
- Delete: `src/agents/providers/RuleBasedExecutor.ts`
- Delete: `src/agents/providers/MiniMaxProvider.ts`
- Delete: `src/agents/providers/ClaudeCodeProvider.ts`
- Delete: `src/agents/providers/FutureProvider.ts`
- Delete: `src/agents/providers/NaiveBaselineProvider.ts`
- Delete: their corresponding `tests/*.test.ts` (run `grep -l` to find)

- [ ] **Step 1: Find tests that reference deleted providers**

Run:
```bash
grep -l "RuleBasedExecutor\|MiniMaxProvider\|ClaudeCodeProvider\|FutureProvider\|NaiveBaselineProvider" tests/*.ts 2>/dev/null
```

- [ ] **Step 2: Find non-test source files that import deleted providers**

Run:
```bash
grep -l "RuleBasedExecutor\|MiniMaxProvider\|ClaudeCodeProvider\|FutureProvider\|NaiveBaselineProvider" src/**/*.ts 2>/dev/null | grep -v "src/agents/providers/"
```
For each file in the result, either delete it too (if it's a downstream do-layer file) or scrub the import (if it's a verifier-relevant file that needs trimming). Use judgement.

- [ ] **Step 3: Move the BFS taint-detection helpers off of RuleBasedExecutor**

`RuleBasedExecutor.ts` exports `aggregatePythonImportExternalSurface`, `aggregatePythonImportSurfaceDetailed`, `aggregateNodeImportSurfaceDetailed`, `detectPythonApiRuntimeLayout`, `detectNodeApiRuntimeLayout` — these are used by tests AND potentially by the verifier gap analyzer. Before deletion, extract them into `src/agents/importSurface.ts`:

```typescript
// src/agents/importSurface.ts
// Cross-module import surface analysis for the route-taint propagation
// feature. Previously lived inside RuleBasedExecutor; extracted so the
// verifier can keep this functionality after the do-layer is removed.
export { /* whatever is needed */ } from '...'
```
Move the relevant function bodies + their dependencies (regexes, type aliases) into the new file. Update any test that imports them to point at the new module.

Run:
```bash
grep -n "aggregatePythonImportExternalSurface\|aggregatePythonImportSurfaceDetailed\|aggregateNodeImportSurfaceDetailed\|detectPythonApiRuntimeLayout\|detectNodeApiRuntimeLayout" tests/*.ts src/**/*.ts
```
Update each import line.

- [ ] **Step 4: Delete provider files**

```bash
rm src/agents/providers/RuleBasedExecutor.ts
rm src/agents/providers/MiniMaxProvider.ts
rm src/agents/providers/ClaudeCodeProvider.ts
rm src/agents/providers/FutureProvider.ts
rm src/agents/providers/NaiveBaselineProvider.ts
```
Plus delete the tests identified in step 1 that test ONLY deleted providers (keep tests that hit functions moved to `importSurface.ts`).

- [ ] **Step 5: Quality gate**

```bash
pnpm build 2>&1 | tail -20
pnpm exec vitest run 2>&1 | tail -8
```
Expected: build clean. Vitest may show test count drop (expected) but every remaining test passes.

If build fails: the most common cause is a downstream `import` that referenced a deleted symbol. Fix by either (a) scrubbing the importing file's reference, or (b) deleting the importing file if it's pure do-layer.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "delete: do-layer providers (RuleBasedExecutor, MiniMaxProvider, ClaudeCodeProvider, FutureProvider, NaiveBaselineProvider)"
```

---

### Task 8: Delete advisory agents

**Files:**
- Delete: `src/agents/advisory/` (entire dir)
- Delete: corresponding tests

- [ ] **Step 1: Find references**

Run: `grep -rln "agents/advisory\|MiniMaxAdvisoryProvider" src tests`

- [ ] **Step 2: Delete + scrub**

```bash
rm -rf src/agents/advisory
```
Remove any imports of advisory types from remaining source. Delete advisory tests.

- [ ] **Step 3: Quality gate**

```bash
pnpm build && pnpm exec vitest run 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "delete: advisory agent layer"
```

---

### Task 9: Delete Supervisor / Planner / Executor

**Files:**
- Delete: `src/agents/Supervisor.ts`
- Delete: `src/agents/Planner.ts`
- Delete: `src/agents/Executor.ts`
- Delete: their tests

- [ ] **Step 1: Find references in remaining source**

```bash
grep -rln "agents/Supervisor\|agents/Planner\b\|agents/Executor" src tests
```

- [ ] **Step 2: Verify Verifier + Reviewer don't depend on them**

```bash
grep -n "Supervisor\|Planner\|Executor" src/agents/Verifier.ts src/agents/Reviewer.ts src/agents/AnalyzerAgent.ts
```
Expected: no hits, or hits only on the `Executor` SUFFIX (like `RuleBasedExecutor`, already deleted).

- [ ] **Step 3: Delete**

```bash
rm src/agents/Supervisor.ts src/agents/Planner.ts src/agents/Executor.ts
```
Delete corresponding tests. Scrub any imports left in CLI commands you're about to delete anyway (don't fight it — those commands go in Task 11).

- [ ] **Step 4: Quality gate**

```bash
pnpm build 2>&1 | tail -20 && pnpm exec vitest run 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "delete: Supervisor / Planner / Executor (orchestration owned downstream)"
```

---

### Task 10: Delete longHorizon

**Files:**
- Delete: `src/longHorizon/` (entire dir)
- Delete: governance / approval / audit / enterprise / incidents subdirs of `src/governance/`
- Delete: `src/security/capabilities/`, `src/security/guards/`
- Delete: tests

- [ ] **Step 1: Find references**

```bash
grep -rln "longHorizon\|governance/approval\|governance/audit\|governance/enterprise\|governance/incidents\|security/capabilities\|security/guards" src tests
```

- [ ] **Step 2: Delete directories**

```bash
rm -rf src/longHorizon
rm -rf src/governance/approval src/governance/audit src/governance/enterprise src/governance/incidents
rm -rf src/security/capabilities src/security/guards
```
Delete tests that target these. If `src/governance/` is empty after, `rmdir src/governance` (or leave it).

- [ ] **Step 3: Quality gate**

```bash
pnpm build && pnpm exec vitest run 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "delete: longHorizon (Phase 6) + executor-side governance + capability guards"
```

---

### Task 11: Delete do-layer CLI commands

**Files:** As enumerated in deletion list step 2.

- [ ] **Step 1: Find the CLI dispatcher**

```bash
grep -n "iterate\|longRun\|scenario\|autonomy\|replay\|regressionBisector" src/cli/index.ts | head -30
```
The dispatcher routes a `command` arg to an imported function. Note the import lines.

- [ ] **Step 2: Delete commands files**

```bash
cd src/cli/commands && rm iterate.ts longRun.ts scenario.ts autonomy.ts autonomyRun.ts replay.ts regressionBisector.ts rollback.ts handoff.ts governance.ts governanceEnterprise.ts incident.ts permissions.ts approvals.ts approvalNew.ts learningGovernance.ts plannerCalibration.ts executorReliability.ts selfImprove.ts selfIterate.ts selfIterateSandbox.ts drift.ts compareExecutors.ts providerTest.ts cost.ts modelCatalog.ts research.ts learn.ts standardsFeedback.ts corpus.ts similar.ts generalize.ts evaluate.ts benchmark.ts workspaceReport.ts plan.ts next.ts supplyChain.ts guard.ts audit.ts secrets.ts security.ts promptInjection.ts privacy.ts redactTest.ts integrations.ts githubCli.ts claudeInstallHooks.ts claudeSecurityHooks.ts claudeProductCli.ts extensionsCli.ts recipesCli.ts examplesCli.ts setupCli.ts configCli.ts reportsCli.ts releaseCli.ts qaAudit.ts qaHealth.ts qaLearn.ts qaTransfer.ts taxonomy.ts compatibilityCli.ts diagnostics.ts && cd -
```

- [ ] **Step 3: Replace `iterate.ts` with redirect stub**

Create `src/cli/commands/iterate.ts`:
```typescript
export async function iterate(_flags: Record<string, string | boolean>): Promise<number> {
  process.stderr.write(
    'matrixomnix iterate has been removed.\n' +
    'MatrixOmnix is now a read-only verifier; use d2p (https://github.com/Hosico02/d2p)\n' +
    'or another do-layer to produce changes, then re-run matrixomnix verify.\n',
  );
  return 2;
}
```

- [ ] **Step 4: Scrub dispatcher in `src/cli/index.ts`**

Open `src/cli/index.ts`. For every command file just deleted, remove its `import` line and its case in the dispatch switch/map. Keep entries for: analyze, gap, archetype, trust, docsTruth, qaPreflight, qaRegression, doctor, quickstart, selfCheck, docs, init, standards, evidence, iterate (the stub).

- [ ] **Step 5: Quality gate**

```bash
pnpm build 2>&1 | tail -20 && pnpm exec vitest run 2>&1 | tail -5
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "delete: do-layer + autonomy + governance CLI commands; iterate is now a redirect stub"
```

---

### Task 12: Delete demo/ + scrub package.json scripts

**Files:**
- Delete: `demo/` (entire dir)
- Modify: `package.json` (remove `demo:*` scripts)

- [ ] **Step 1: Inspect demo scripts**

```bash
grep -E "demo:" package.json
```

- [ ] **Step 2: Delete demo dir**

```bash
rm -rf demo
```

- [ ] **Step 3: Edit package.json**

Remove these script keys: `demo:stress`, `demo:stress:product-ready`, `demo:stress:plan` (whatever is present).

- [ ] **Step 4: Quality gate**

```bash
pnpm build && pnpm exec vitest run 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "delete: demo/ stress fixtures + scripts (exercised the do chain)"
```

---

### Task 13: Final src/ tree sanity check

**Files:** (none — verification)

- [ ] **Step 1: Tree inventory**

```bash
find src -name "*.ts" | wc -l
find src -name "*.ts" -exec wc -l {} + | tail -1
```
Expected: ~13k total LOC, around 80-150 .ts files.

- [ ] **Step 2: Full test run**

```bash
pnpm exec vitest run 2>&1 | tail -5
```
Expected: test count somewhere around 250-400 (depends on which tests survive); all passing.

- [ ] **Step 3: Manual smoke**

```bash
node dist/cli/index.js iterate
echo "exit:$?"
node dist/cli/index.js archetype --project /tmp/d2p-debug/express 2>&1 | tail -3
node dist/cli/index.js gap --project /tmp/d2p-debug/express 2>&1 | tail -5
```
Expected: iterate exits 2 with redirect message; archetype + gap still work.

- [ ] **Step 4: MCP server smoke**

```bash
node dist/mcp/server.js < /dev/null
```
Expected: starts, exits when stdin closes.

- [ ] **Step 5: Commit if anything changed (otherwise skip)**

---

## Phase 4 — Reframe README + site

### Task 14: Update README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace tagline + summary**

Open `README.md`. Replace the first 6 lines with:
```markdown
# MatrixOmnix

**MatrixOmnix is the verifier for demo-to-product pipelines.** A read-only MCP server (`d2p-verify`) + thin CLI that any agent-driven productization loop (d2p, Claude Code, Cursor, custom) can call to get an honest archetype detection, gap report, evidence-weighted score and QA preflight on a project directory.

MatrixOmnix never writes to the project under verification. It only inspects, scores and reports.
```

- [ ] **Step 2: Reframe d2p sibling section**

Replace the "Sibling project: d2p" section to describe d2p as **the recommended do-layer to pair with MatrixOmnix**, not an alternative. Drop the comparison table (it no longer makes sense — they're not competing).

```markdown
## Pair MatrixOmnix with a do-layer

MatrixOmnix is read-only. You'll typically pair it with a do-layer that *can* mutate the project. Recommended: [`Hosico02/d2p`](https://github.com/Hosico02/d2p) — an LLM-driven Python orchestrator (Analyzer → Planner → parallel Executors → QA) that produces changes, then hands off to MatrixOmnix for an independent verdict.

Any MCP-aware client can call MatrixOmnix:

- d2p (post-iteration hook)
- Claude Code, Cursor, or any MCP client
- Manual invocation via `npx @modelcontextprotocol/inspector node dist/mcp/server.js`
```

- [ ] **Step 3: Update Quickstart**

Replace the quickstart with verifier-flavored commands. Remove all `iterate` / `research` / `models:refresh` examples. Replace with:

```markdown
## Quickstart

```bash
pnpm install && pnpm build

# Start the MCP server (stdio)
node dist/mcp/server.js
# Or use it via npx:
# npx d2p-verify

# Or use the back-compat CLI directly
pnpm matrixomnix archetype --project /path/to/your/repo
pnpm matrixomnix gap --project /path/to/your/repo
pnpm matrixomnix self-check
```

For MCP integration with Claude Code, add to `.mcp.json`:

```json
{
  "mcpServers": {
    "d2p-verify": {
      "command": "node",
      "args": ["./dist/mcp/server.js"]
    }
  }
}
```

```

- [ ] **Step 4: Strip everything below "Provider design"**

Delete the "Provider design", "Current limits" mentioning iterate, and the long-tail content that references removed CLI commands. Keep: harness coverage (read-only sense), archetype detection table, multi-agent roles (trimmed to verifier-relevant agents), license.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "readme: reframe MatrixOmnix as the verifier for demo-to-product pipelines"
```

---

### Task 15: Update site/src/App.vue

**Files:**
- Modify: `site/src/App.vue`

- [ ] **Step 1: Update Hero subcopy**

Replace the home subcopy:
```html
<p class="subcopy">
  MatrixOmnix is the verifier for demo-to-product pipelines: a read-only MCP server (<code>d2p-verify</code>) plus CLI that gives any agent-driven productization loop an honest archetype detection, gap report, evidence-weighted score and QA preflight on a project directory. Pair it with d2p or any MCP-aware do-layer.
</p>
```

- [ ] **Step 2: Update About > Current state paragraph**

Replace the "What it is today" content to reflect: read-only verifier, MCP-first, two tools (verify_project + detect_archetype), declarative archetypes, route-taint propagation, etc. Drop iterate / advisory / autonomy mentions.

(Use judgement on exact wording — keep the existing voice. Aim for 2-3 paragraphs.)

- [ ] **Step 3: Reframe d2p sibling card**

Change the d2p sibling card heading from "Sibling project" to "Recommended do-layer". Update the body to describe d2p as the change-producing partner that calls back into MatrixOmnix for verification, not as an alternative implementation.

- [ ] **Step 4: Site build + check**

```bash
pnpm run site:build
pnpm run site:check
```
Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add site/src/App.vue
git commit -m "site: reframe as 'verifier for demo-to-product pipelines'; demote d2p card to 'recommended do-layer'"
```

---

## Phase 5 — Tag + merge

### Task 16: Tag pre-pivot main and merge

**Files:** (none — git ops)

- [ ] **Step 1: Identify pre-pivot main commit**

```bash
git log main --oneline -5
```
The most recent main commit (likely `0923a93` or the spec commit `3819111`).

- [ ] **Step 2: Tag it**

```bash
git tag v0.0.6-final 3819111   # or whichever commit is the last on main
git push origin v0.0.6-final
```

- [ ] **Step 3: Run full quality gate one more time**

```bash
pnpm build && pnpm exec vitest run 2>&1 | tail -8
```
Expected: clean.

- [ ] **Step 4: Switch to main and merge**

```bash
git switch main
git merge --no-ff verifier-pivot -m "Pivot: MatrixOmnix is now a verifier-only MCP server

BREAKING CHANGE: The do-layer (iterate, RuleBasedExecutor, MiniMaxProvider,
Supervisor/Planner/Executor, longHorizon Phase-6 subsystems, advisory agents)
is removed. MatrixOmnix is now a read-only verifier exposed via the d2p-verify
MCP stdio server. Pair with d2p or any MCP-aware do-layer to produce changes,
then call verify_project for an independent verdict.

Pre-pivot state preserved at tag v0.0.6-final.

The two MCP tools shipped in this pivot:
- verify_project(path, archetype_hint?) → archetype + score + verdict + findings + evidence + qa_preflight
- detect_archetype(path) → primary archetype + alternatives

Codebase shrinks from ~41k → ~13k LOC; vitest from 752 → ~250-300 tests."
```

- [ ] **Step 5: Push**

```bash
git push origin main
```

- [ ] **Step 6: Final smoke on main**

```bash
pnpm install && pnpm build && pnpm exec vitest run 2>&1 | tail -5
node dist/mcp/server.js < /dev/null
node dist/cli/index.js iterate; echo "exit:$?"
```
Expected: build + tests green; MCP server starts/exits OK; iterate exits 2.

---

## Acceptance criteria (verify at end)

- [ ] `npx @modelcontextprotocol/inspector node dist/mcp/server.js` (or `--cli --method tools/list`) lists `verify_project` + `detect_archetype`
- [ ] `pnpm matrixomnix iterate` exits 2 with the redirect message
- [ ] `pnpm matrixomnix archetype --project ./tmp/d2p-debug/express` returns `node-library`
- [ ] `pnpm matrixomnix gap --project ./tmp/d2p-debug/express` still works
- [ ] `pnpm build` clean
- [ ] `pnpm exec vitest run` 100% of remaining tests pass
- [ ] README header reads "the verifier for demo-to-product pipelines"
- [ ] `git tag` shows `v0.0.6-final`
- [ ] `main` branch carries the pivot, pushed to origin
