# MatrixOmnix → verifier pivot · design

**Date:** 2026-05-22
**Author:** brainstormed with Claude (Opus 4.7 1M context)
**Status:** approved by user, ready for plan

## Hard constraints

1. **d2p repository is not touched.** This pivot refactors MatrixOmnix only. Whether d2p (or any other MCP client) chooses to integrate is downstream and out of scope.
2. **Verifier never writes to the project under verification.** Read-only contract. This is the bright line that separates "do" from "verify".
3. **Same npm package, no rename.** Repo stays at `Hosico02/demo2project`, project name stays `MatrixOmnix`. Only the MCP server binary is named `d2p-verify` to match the ecosystem it slots into.

## Why pivot

MatrixOmnix today (~41k LOC TypeScript) couples three things:
- A **verifier** (gap analyzer, archetype detector, evidence-weighted scorer, QA case store, trust check)
- A **do layer** (RuleBasedExecutor, MiniMaxProvider, iterate command, advisory agents)
- A **long-horizon autonomy** subsystem (Phase 6 self-improvement, quality monitor, drift detector, regression bisector, replay system, scenario stress tester, etc.)

The "do" and "long-horizon" code competes with d2p on a battle MatrixOmnix can't win — d2p is ~8k Python LOC with no hardcoded detectors and a strict LLM-quality ceiling that compounds upward. MatrixOmnix's competitive moat is the **verifier**: archetype detection, declarative archetypes, 80+ engineered gap detectors, evidence-weighted scoring, QA fingerprinting. Cutting away the "do" half and exposing the "verify" half as an MCP server lets MatrixOmnix become the cross-tool verifier any agent-driven productization pipeline (d2p, Claude Code, Cursor, manual users) can call.

## Architecture

```
┌─────────────────────────────────┐         ┌──────────────────────────────┐
│  Any MCP client                 │         │  MatrixOmnix repo            │
│   · d2p (future, not in scope)  │  MCP    │                              │
│   · Claude Code                 │◄───────►│  d2p-verify MCP server       │
│   · Cursor                      │  stdio  │   (Node, stdio transport)    │
│   · manual via MCP Inspector    │         │                              │
└─────────────────────────────────┘         │   ┌──────────────────────┐   │
                                            │   │ verifier core (~13k) │   │
                                            │   │  · archetype detect  │   │
                                            │   │  · gap analyzer      │   │
                                            │   │  · evidence-weighted │   │
                                            │   │    scorer            │   │
                                            │   │  · QA case store     │   │
                                            │   │  · trust checker     │   │
                                            │   └──────────────────────┘   │
                                            │                              │
                                            │  CLI (back-compat alias):    │
                                            │   pnpm matrixomnix verify    │
                                            │   pnpm matrixomnix gap       │
                                            │   pnpm matrixomnix archetype │
                                            └──────────────────────────────┘
```

- Single npm package `@matrixomnix/core` (project keeps current package.json name).
- Two entry points: `bin.d2p-verify` (MCP stdio) and `bin.matrixomnix` (back-compat CLI).
- MCP transport = stdio. No HTTP, no SSE, no auth. Single-tenant local process.
- Read-only on the project under verification.

## Phase A — MVP (this pivot)

### MCP tools exposed

```ts
// 1. Comprehensive verify in a single call
verify_project(args: {
  path: string;
  archetype_hint?: string;  // optional override if caller already knows
}): {
  archetype: { id: string; confidence: number };
  score: number;            // 0..100, evidence-weighted
  verdict: 'pass' | 'needs_repair' | 'fail';
  findings: Array<{
    category: string;
    severity: 'blocker' | 'high' | 'medium' | 'low';
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

// 2. Archetype-only fast path
detect_archetype(args: { path: string }): {
  primary: {
    id: string;
    confidence: number;
    detected_signals: string[];
    missing_signals: string[];
    recommended_standard: string;
    risk_profile: 'low' | 'medium' | 'high';
  };
  alternatives: Array<{ id: string; confidence: number }>;  // top 3
}
```

### Code surface

**Kept** (verifier core, ~12-15k LOC):
- `src/core/projectArchetypeDetector.ts`
- `src/core/archetypes/declarativeLoader.ts`
- `config/archetypes/*.json` (all current + future declarative archetypes)
- `src/agents/AnalyzerAgent.ts` — snapshot + gap path only (drop fullAnalyzeWithIteration if present)
- `src/agents/gapAnalyzer.ts` — all 80+ finding rules
- `src/scoring/` — evidence-weighted scorer
- `src/qa/QAAgent.ts` — preflight + case store + fingerprinting (drop case-emission-from-iteration)
- `src/standards/` — archetype-specific standards
- `src/utils/` — including the BFS `listFiles`
- CLI back-compat subset: `analyze`, `gap`, `archetype`, `trust:check`, `report:project`, `self-check`
- `src/mcp/server.ts` **(new)** — MCP server entry, registers the 2 tools
- `benchmarks/hidden/` — used as verifier self-test corpus
- `scripts/generalization-bench.mjs` — real-project archetype hit rate measurement

**Deleted** (do-layer + long-horizon, ~25-28k LOC):
- `src/agents/providers/*` — RuleBasedExecutor, MiniMaxProvider, MiniMaxAdvisoryProvider, ClaudeCodeProvider, FutureProvider, NaiveBaselineProvider
- `src/agents/Supervisor.ts`, `Planner.ts`, `Executor.ts` (keep Verifier, Reviewer, QAAgent)
- `src/cli/commands/iterate.ts`, `long-run.ts`, `self-iterate*.ts`, `scenario*.ts`, `autonomy*.ts`, `replay*.ts`, `regression:bisect.ts`, `governance:log.ts`, `handoff*.ts`, `planner:calibrate.ts`, `executor:reliability.ts`, `research.ts`, `models:refresh.ts`, `approvals*.ts`, `evidence:*.ts` (where it writes)
- `src/longHorizon/` — entire Phase 6 self-improvement / quality monitor / drift detector / regression bisector / replay / scenario stress / governance log / handoff
- `src/security/CapabilityManager.ts`, `FileAccessGuard.ts`, `GuardedCommandRunner.ts`, `ApprovalWorkflow.ts`, `IncidentManager.ts`, `EmergencyStop.ts`, `SupplyChainGuard.ts` — all the executor-side guards
- `demo/run-stress.mjs` and `demo/fixtures/` — stress fixtures exercise the do-chain
- All `tests/*` files that exercise iterate, providers, self-improvement, scenario, replay

**Kept but trimmed**:
- `src/security/SecretScanner.ts`, `PromptInjectionScanner.ts`, `PrivacyMode.ts`, `AuditLog.ts` — verifier-relevant
- `src/agents/Verifier.ts`, `Reviewer.ts` — used internally by the verify path
- `tests/` — keep gap/archetype/scoring/QA tests; drop iterate/provider/long-horizon tests

**New CLI behavior**:
- `pnpm matrixomnix iterate ...` → exits 2 with a message pointing at d2p or any other do-layer
- `pnpm matrixomnix verify --project ./x` → thin CLI wrapper around `verify_project` MCP tool
- `pnpm matrixomnix gap --project ./x` → unchanged
- `pnpm matrixomnix archetype --project ./x` → unchanged

### Expected size after pivot

| Metric | Before | After |
|---|---:|---:|
| LOC (src/) | ~41k | ~13k |
| vitest tests | 752 | ~250-300 |
| CLI commands | ~30 | ~8 |
| MCP tools | 0 | 2 |
| Top-level `src/` dirs | ~15 | ~8 |

## Phase B — parking lot

Not in this pivot. Each candidate has a graduation criterion; we don't pre-build.

| Tool | What it does | Graduates when |
|---|---|---|
| `trust_check(path)` | Checks README commands vs `package.json` / Dockerfile / CI for consistency | A real-world failure mode where verify_project passes but README lies appears ≥ 2 times |
| `qa_regression_replay(path)` | Replays prior failure fingerprints against current state | Cross-project QA case fingerprint reuse occurs ≥ 1 time |
| `report_project(path, format)` | Renders full markdown/JSON report | A consumer explicitly says verify_project JSON is not enough |
| `compare_runs(before_path, after_path)` | Diffs two iterations | A downstream orchestrator wants verifier to drive its termination signal |
| `qa_preflight(path)` standalone | (already a field on verify_project) | A consumer says "I want preflight only, not full verify" |

**Explicitly out of scope, ever**:
- HTTP transport (caller wraps stdio themselves if they want HTTP)
- Multi-tenancy, auth, billing
- Writing files in the project under verification
- Hosted upload / managed workspaces

## Migration plan

### Branch strategy

Work on `verifier-pivot` branch. main stays untouched until merge. Before merging, tag the last main commit as `v0.0.6-final` so the pre-pivot state is recoverable.

### Six steps (in order)

| # | Step | Estimated time | Risk |
|---|---|---|---|
| 1 | Add `src/mcp/server.ts` with the 2 tools wired to existing detectArchetype + AnalyzerAgent + gapAnalyzer + scorer. Add `bin.d2p-verify` in package.json. Pure addition. Validate with `npx @modelcontextprotocol/inspector node dist/mcp/server.js` | 0.5 day | low |
| 2 | Write a deletion-list spec under `docs/superpowers/specs/` listing every file to delete. **User approves before step 3.** | 0.5 day | this is the control gate |
| 3 | Batch deletions, one commit per area (providers / longHorizon / iterate / supervisor-planner-executor / executor-security / iterate-tests). After each commit: `tsc --noEmit` clean + remaining vitest green. | 1-2 days | medium (hidden imports) |
| 4 | README tagline rewrite ("the verifier for demo-to-product pipelines"), site Hero/About copy refresh, d2p sibling card reframed as complementary downstream | 0.5 day | low |
| 5 | Tag `v0.0.6-final` on main, squash-merge `verifier-pivot` → main, commit message flags BREAKING change | 30 min | low |
| 6 | Optional: publish npm `0.1.0`. Skip if package was never published. | — | — |

### Risk mitigations

- **Hidden import discovered after deletion**: cherry-pick from `v0.0.6-final` tag.
- **MCP SDK friction**: fall back to raw JSON-RPC over stdio (~200 lines hand-written) if `@modelcontextprotocol/sdk` proves awkward.
- **Old `iterate` muscle memory**: command stays as a stub that prints "removed in verifier pivot — use d2p or another do-layer" and exits 2.

## Testing strategy

### What we test

- All retained gapAnalyzer, archetype, scoring, QA preflight tests
- New: `src/mcp/server.test.ts` — spawns the server, sends JSON-RPC for both tools, asserts schema + content
- New: `tests/mcp-integration.test.ts` — end-to-end on a fixture project, both tools

### What we delete

- `tests/iterate*.test.ts`, `tests/scenario*.test.ts`, `tests/longHorizon*.test.ts`
- All tests targeting deleted source files
- `demo/run-stress.mjs` and its fixtures

### Quality gates

- `pnpm build` clean
- `pnpm test` → 100% of retained tests pass
- `pnpm matrixomnix self-check` → green
- MCP server starts and serves both tools without error under MCP Inspector

## Open questions

None. All major architectural decisions resolved during brainstorming:
- Depth: surgical separation ✓
- Integration: MCP server over stdio ✓
- Protocol: MCP only (no HTTP, no dual-protocol overhead) ✓
- Brand: keep MatrixOmnix repo/package name, server binary is `d2p-verify` ✓
- d2p side: not touched, downstream concern ✓
- Read-only: verifier never writes to projects under verification ✓

## Acceptance criteria

This pivot is done when:

1. `npx @modelcontextprotocol/inspector node dist/mcp/server.js` connects, lists `verify_project` and `detect_archetype`, and both tools return correct JSON for a fixture project.
2. `pnpm matrixomnix iterate` exits 2 with a clear redirect message.
3. `pnpm matrixomnix gap --project ./examples/bad-demo` still works.
4. `pnpm build` clean. `pnpm test` 100% pass.
5. README header reads "MatrixOmnix — the verifier for demo-to-product pipelines" (or similar) and the d2p sibling card is reframed.
6. main branch carries the pivot. `v0.0.6-final` tag exists for archival rollback.
