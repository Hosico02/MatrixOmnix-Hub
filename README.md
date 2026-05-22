# MatrixOmnix · verify-layer

**This repo is the verify-layer of MatrixOmnix.** MatrixOmnix is the
umbrella product goal: turn a rough demo into a verified product. It is
currently implemented as two open-source repos that work together:

- **[`Hosico02/d2p`](https://github.com/Hosico02/d2p)** — the **do-layer**.
  An LLM-driven Python orchestrator (Analyzer → Planner → parallel Executors
  → QA) that produces the changes.
- **`Hosico02/demo2project`** (this repo) — the **verify-layer**. A read-only
  TypeScript MCP server (`d2p-verify`) plus thin CLI that returns an
  independent verdict (archetype, evidence-weighted score, gap findings,
  QA preflight) between iterations.

The two subsystems are deliberately split: the verify-layer must be able
to call the do-layer a liar, so they cannot share code. They communicate
over MCP stdio — no shared imports, no shared state.

The **endgame** is a single MatrixOmnix tool. If the verify-layer keeps
catching bugs that d2p's own QA misses, d2p will absorb the verifier
and ship one combined tool. If d2p's growing regression corpus covers
everything the verify-layer was catching, the verify-layer is retired
and d2p stands alone as MatrixOmnix. The decision will be data-driven
from real cross-project runs, not architectural taste.

`demo2project` remains as a backwards-compatible CLI alias for this repo.

## Calling the verify-layer

Any MCP-aware client can call this repo:

- d2p, via a post-iteration hook in the do-layer (not bundled here)
- Claude Code, Cursor or any MCP client (add to `.mcp.json`)
- Manual via `npx @modelcontextprotocol/inspector node dist/mcp/server.js`

## Quickstart

```bash
pnpm install && pnpm build

# Start the MCP server (stdio transport)
node dist/mcp/server.js
# or once installed globally:
# npx d2p-verify

# Or use the back-compat CLI directly
pnpm matrixomnix archetype --project /path/to/your/repo
pnpm matrixomnix gap --project /path/to/your/repo
pnpm matrixomnix self-check
```

For MCP integration with Claude Code or similar, add to `.mcp.json`:

```json
{
  "mcpServers": {
    "d2p-verify": {
      "command": "node",
      "args": ["/absolute/path/to/dist/mcp/server.js"]
    }
  }
}
```

## MCP tools

Phase A ships two tools.

### `verify_project(path, archetype_hint?)`

Runs the full verifier on a project directory. Returns a single JSON envelope:

```jsonc
{
  "archetype": { "id": "node-library", "confidence": 0.50 },
  "score": 64,
  "verdict": "needs_repair",            // pass | needs_repair | fail
  "findings": [
    {
      "category": "missing_required_file",
      "severity": "high",
      "message": "...",
      "suggested_fix": "..."
    }
  ],
  "evidence": { "build_status": "not_run", "type_check_status": "not_run" },
  "qa_preflight": { "active_cases": [/* known recurring failure fingerprints */] }
}
```

Verdict mapping:
- `fail` — at least one **blocker** finding
- `needs_repair` — at least one **high** severity finding, no blockers
- `pass` — neither

### `detect_archetype(path)`

Detects the project archetype only (cheaper than `verify_project`). Returns:

```jsonc
{
  "primary": {
    "id": "rust-library",
    "confidence": 0.73,
    "detected_signals": ["Cargo.toml", "lang:rust", "<member>/src/lib.rs"],
    "missing_signals": ["src/lib.rs (top-level lib)"],
    "recommended_standard": "generic-project",
    "risk_profile": "low"
  },
  "alternatives": [ /* top 3 */ ]
}
```

Real-project bench (sampled from public GitHub repos): 13/14 unfamiliar
projects classified into the intended archetype.

## What the verify-layer gates

Every project surface is gated across three honest tiers:

| Tier | What it asks |
|---|---|
| **1 · Structural contract** | Always-on. Does the source actually look like this surface? (route decorators parsed, manifest schema valid, ML model has the right magic bytes, expo.slug is URL-safe, etc.) |
| **2 · Behavioural runtime** | Exercises the surface end-to-end (test_client hits every route, NotebookClient executes cells, sharp resizes a 16×16 buffer and checks the PNG signature, InferenceSession loads the model and runs). Specialized surfaces honestly skip-with-diagnostic when the runtime lib is absent. |
| **3 · Productization surface** | Operational maturity above runtime: error envelope, prompt-eval harness, provider failure fallback, token budget, prompt template registry, streaming response, etc. |

Harness families include:

- **API contract/runtime** — Flask/FastAPI/Express/Fastify/Hono detection,
  route table verification, structured `{error, message, status}` JSON
  envelope on 404 + Exception paths
- **CLI executable contract** — installed/declared CLI entries expose a stable `--help` contract
- **Config contract** — environment-variable usage vs `.env.example` coverage
- **Data/migration contract** — ORM/schema/migration evidence
- **Worker contract** — queues, scheduled jobs and background workers
- **Specialized surfaces** — browser extensions, notebooks, mobile/desktop shells,
  games, 3D/WebGL scenes, ML model demos, media pipelines, each with executable harnesses
- **UI product verification** — browser harnesses, render smoke, accessibility, responsive layout
- **LLM chat productization suite** — prompt-eval harness with golden cases,
  mocked provider failure fallback returning structured 5xx, `MAX_MESSAGE_LENGTH`
  guard, `prompts/` template registry, SSE streaming endpoint
- **Agent-facing simulation products** — multi-agent social-deduction theaters
  evaluated against model configuration, deterministic rules, replay/transcript
  storage, simulation/evaluation harnesses and observer workflows

## Archetype detection

Project archetype is decided by a hybrid of declarative JSON probes
(`config/archetypes/*.json`) and built-in TypeScript probes. Each probe
scores positive and negative signals against a per-archetype threshold;
the detector sorts by ratio, then raw signal weight, then max possible
weight so a strict declarative library probe wins ties against a loose
built-in one.

```bash
pnpm matrixomnix archetype --project /path/to/repo
```

prints the full probe scoresheet — primary archetype, confidence, detected
signals and the top alternatives.

## Architecture

```
                  Any MCP client
                  (d2p, Claude Code, Cursor, manual)
                          │
                          │ MCP stdio
                          ▼
                  ┌─────────────────────────────────┐
                  │  d2p-verify MCP server          │
                  │                                 │
                  │   AnalyzerAgent ─► snapshot     │
                  │           │                     │
                  │           ▼                     │
                  │   ProjectScorer ─► score        │
                  │           │                     │
                  │           ▼                     │
                  │   gapAnalyzer ─► GapReport      │
                  │           │                     │
                  │           ▼                     │
                  │   QACaseStore (on-disk)         │
                  │   → preflight warnings          │
                  └─────────────────────────────────┘
```

Verifier-relevant agents:

| Agent | Responsibility |
|---|---|
| AnalyzerAgent | Scans project, takes snapshot, runs scorer + gap |
| Verifier | Independently re-runs verification; appends evidence |
| Reviewer | Rule-based audit (forbid unverified completion, etc.) |
| QAAgent | Loads / dedupes QA cases; maintains regression spec |
| MemoryAgent | In-memory fingerprint frequency counter |

(Supervisor, Planner, Executor and all do-layer providers were removed in
the verifier pivot — those belong to the do-layer.)

## CLI reference

```bash
matrixomnix init                              # Bootstrap config files
matrixomnix doctor                            # Environment + config diagnose
matrixomnix quickstart [--project <path>]     # 5-minute walkthrough
matrixomnix analyze --project <path>          # ProjectSnapshot + ProjectScore
matrixomnix gap --project <path> [--fast]     # GapReport with evidence verification
matrixomnix archetype --project <path>        # Detect project archetype
matrixomnix trust:check --project <path>      # Repo trust + safety scan
matrixomnix docs:truth --project <path>       # README/docs vs reality
matrixomnix qa:preflight --project <path>     # Load active QA cases
matrixomnix qa:regression --project <path>    # Replay QA regression spec
matrixomnix self-check                        # analyze/gap on this repo
matrixomnix evidence:show --project <path>    # Inspect evidence graph
matrixomnix standards:list / explain / validate
```

Removed in the verifier pivot: `iterate`, `plan`, `long-run`, `autonomy:*`,
`scenario:*`, `replay:*`, `regression:bisect`, `self-improve`, `governance:*`,
advisory agents, providers (RuleBasedExecutor, MiniMax, ClaudeCode, …). Those
were the do-layer. Use d2p or another do-layer to produce changes, then call
the verify-layer.

## Web

[`site/`](site/) — Vite/Vue app describing the MatrixOmnix umbrella project
(both subsystems, plus the merge endgame). Live at
<https://matrixomnix.vercel.app>.

## Current limits

- Reviewer is rule-based, not diff-based.
- Score weights are heuristic; tune via `config/project-standard.json`.
- QA regression runner asserts over recorded *events*, not live re-runs of commands.
- The MatrixOmnix web Service page is a usage guide for the open-source repos.
  Hosted file intake, queued processing and artifact packaging are deferred —
  those would belong to the do-layer, not the verify-layer.

## License

MIT. See [LICENSE](LICENSE).
