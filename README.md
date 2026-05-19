# MatrixOmnix

**MatrixOmnix is a demo-to-product operating system — not another coding agent.**

`demo2project` remains as a backwards-compatible CLI alias while the product
brand moves to MatrixOmnix.

## Sibling project: [`d2p`](https://github.com/Hosico02/d2p) — the minimal agent-driven loop

If you want the **same demo-to-product idea expressed in ~2.5k lines** without
hardcoded "demo type" detectors, see [`Hosico02/d2p`](https://github.com/Hosico02/d2p).
It runs Analyzer → Planner → parallel Executors → QA where the Analyzer
searches the web for mature competitors itself and the agents work out what
"product" means for the demo at hand. Zero code changes to add new domains.

|  | MatrixOmnix (this repo) | [d2p](https://github.com/Hosico02/d2p) (sibling) |
|---|---|---|
| Lines of core code | ~41k TypeScript | ~4k Python |
| Gap detection | 80+ hardcoded detectors organised in 3 honest tiers | pure LLM, no detectors |
| Adding a new demo domain | author new detector + planner case + executor handler | zero code changes |
| Stress / regression suite | **15/15 fixtures** product-ready, **737 vitest** tests | failing-tests-as-bug-reports corpus grows per run |
| Inflation resistance | very strong (every gap path is engineered, every tier asks a stricter question than the last) | depends on LLM quality + rollback guards |
| Default LLM cost per run | $0 (deterministic providers ship) | non-zero (every iteration is agent-driven) |
| Best for | reproducible product baselines under engineered standards | exploratory, new-domain, agent-first runs |

The two projects are complementary: MatrixOmnix's hardened pipeline gives
strong inflation resistance on known archetypes; d2p's minimal loop gives
zero-marginal-cost generalization to new ones.

## Quickstart

```bash
pnpm install && pnpm build
pnpm matrixomnix doctor                          # check your environment
pnpm matrixomnix init --interactive              # 30-second setup wizard
pnpm matrixomnix quickstart --use-example        # 5-minute analyze/gap/trust loop
pnpm run site:check                              # validate the MatrixOmnix web entry
pnpm run site:build                              # build the Vite/Vue web app
```

Then on your real project:

```bash
pnpm matrixomnix analyze --project /path/to/your/repo
pnpm matrixomnix research --project /path/to/your/repo --domain web_ui_app --web
pnpm matrixomnix models:refresh --project /path/to/your/repo --web
pnpm matrixomnix gap --project /path/to/your/repo           # runs evidence verification by default
pnpm matrixomnix gap --project /path/to/your/repo --fast    # static scan only
pnpm matrixomnix trust:check --project /path/to/your/repo
pnpm matrixomnix iterate --project /path/to/your/repo --provider rule-based --max-iterations 1 --web
pnpm matrixomnix iterate --project /path/to/your/repo --provider minimax --max-iterations 1 --web --advisory-agents
pnpm matrixomnix report:project --project /path/to/your/repo
```

`iterate --web` performs the same controlled official LLM model catalog refresh
before planning when an LLM/provider surface is detected, so provider/model
selectors can be repaired from current provider-owned documentation during the
normal demo-to-product loop without adding model research to unrelated demos.

`iterate --web --advisory-agents` adds a model-backed critique layer before
planning. MatrixOmnix first runs controlled, source-cited market research for
the detected project domain, then gives that report to advisory roles that
compare the demo against mature products, challenge the gap report and planner,
and can reserve one task slot for high-confidence, source-backed work. They
cannot mark a project product-ready: unsourced advice is dropped, and the
Verifier, Reviewer and Scorer remain authoritative.

For agent-facing products, domain inference now keeps the product premise in
scope. For example, an LLM werewolf theater is assessed as an
`agent_social_deduction_theater`: the loop compares it against model
configuration, deterministic rules, replay/transcript storage, simulation
evaluation, observability and observer workflows instead of forcing it into a
human multiplayer account/lobby/voice-chat roadmap.

Full quickstart: [`docs/getting-started/quickstart.md`](docs/getting-started/quickstart.md). CLI reference: [`docs/reference/cli.md`](docs/reference/cli.md).

Web app: [`site/`](site/). The MatrixOmnix interface is a Vite/Vue app based
on the original MatrixOmnix visual language, with Home, About, Service and
Contact views. The Service view is a beta usage guide for running MatrixOmnix
locally; hosted file intake and artifact packaging flows are intentionally not
exposed yet.

Live site: <https://matrixomnix.vercel.app>

Deployment guide: [`docs/deployment.md`](docs/deployment.md). The repository
includes Vercel and Render configuration for the MatrixOmnix web surface.

## Current State

MatrixOmnix is a **beta, local-first productization harness**. It is already
useful for turning rough repositories into stronger engineering baselines:
tests, contracts, runtime guards, configuration examples, deployment hooks,
documentation, QA memory and repeatable verification reports.

The current system is intentionally strict about evidence:

- `analyze` and `gap` separate project structure from real product readiness.
- `gap` now runs evidence-weighted verification by default, so a project with
  red tests or build failures is capped even when its files look complete. Use
  `--fast` or `--no-verify` only when you explicitly want a static scan.
- `research --web` records source-cited competitor capabilities under
  `.demo2project/research`.
- `iterate --web --advisory-agents` runs controlled market research, then
  model-backed market, gap, planner and reviewer critics before planning, while
  still requiring source URLs and local verification commands before their
  proposals become normal tasks. When source-backed fallback advice is already
  available, slow advisory model calls are cut off early instead of blocking a
  whole iteration; when only deterministic deployment/docs closeout remains,
  advisory agents are skipped.
- Broad deterministic backlogs can expand to six planned tasks in one round, so
  demos with many obvious productization gaps spend fewer iterations on
  mechanical setup while ordinary plans stay small.
- The **15-fixture** stress suite now reaches product-ready on **15/15** demo types:
  UI SPA, API, CLI, LLM chat, game, WebGL/3D, ML inference, media pipeline,
  browser extension, notebook, mobile, desktop, DB CRUD, multi-service repos
  and standalone workers.
- Every surface owns gates across **three honest tiers** —
  **tier-1 structural contract** (always-on source-shape checks),
  **tier-2 behavioural runtime** (exercises the surface end-to-end; amber when
  the runtime lib is absent), and **tier-3 productization surface** (the
  operational gates that separate a runtime-passing demo from a productized
  app: error envelope, streaming response, prompt-eval harness, provider
  failure fallback, token budget, prompt template registry, etc.).
- **LLM chat full productization suite** (5/5) now gates `tests/prompts/*.json`
  golden eval cases, mocked-provider failure fallback returning structured 5xx,
  `MAX_MESSAGE_LENGTH` guard, `prompts/` template registry and `streaming.py`
  SSE endpoint — driven by detection of a real `/chat`-style HTTP surface,
  not just an LLM dep (so LLM-backed simulation servers don't get
  misclassified as chat demos).
- **API operational maturity** (kickoff): `missing_api_error_envelope` now
  fires when a Flask app has no `@app.errorhandler`, and the handler ships
  a 404 + Exception handler plus `tests/test_error_envelope.py` that asserts
  `{error, message, status}` JSON shape on both paths.
- **Node parity** for Config and Worker runtime gates: when no Python entry
  is detected, `writeConfigRuntimeLoadTest` and `writeWorkerRuntimeEnqueueTest`
  fall back to emitting `node:test` harnesses for `.js/.mjs/.ts` config
  modules and worker entries (file-queue, enqueue-fn or bare-drain shapes).
- **`callsExternalService` walks depth-1 cross-module imports** — a handler
  that proxies through `from .services import llm_call` is now correctly
  classified as externally-reaching when the SDK import lives in
  `services.py`.
- agent-facing social deduction demos now get a dedicated maturity model, so
  MatrixOmnix can preserve the multi-agent theater premise while still gating
  rules, model/provider configuration, replay, evaluation and observability.
- mechanical deployment tasks such as missing Flask `Dockerfile` / `wsgi.py`
  are deduplicated and routed to deterministic scaffolding before any
  model-backed free edit, and Python CI is checked for the same
  `constraints.txt` install policy used by local and Docker builds.
- `iterate` plans bounded tasks and verifies them locally before accepting
  progress.
- failed verification becomes repair work before normal productization
  continues.
- QA cases are fingerprinted so repeated bugs can be detected across future
  runs.

This does **not** mean every demo becomes an industrial product after one run.
MatrixOmnix should be read as a disciplined operating system for iteration,
not a magic upload service or a substitute for release review.

## Product Boundaries

The hosted MatrixOmnix site is currently an introduction and beta usage guide.
It does not yet accept uploaded demo archives, run private jobs in hosted
workspaces, or return production ZIP artifacts. Those capabilities require
workspace isolation, queueing, artifact storage, secrets handling, abuse
controls, billing/support boundaries and much stronger end-to-end validation.

Internally, MatrixOmnix now treats market-readiness claims more conservatively:
source-backed research must extract concrete capabilities before the project can
claim source-cited market parity. A local module named `lobby.py` or
`ranking.py` is not enough by itself; the system must prove the capability is
integrated, reachable and verified.

## Roadmap

Near-term work focuses on making the beta harder to fool:

- stricter scoring gates for README quality, market research quality and
  in-memory product skeletons;
- more reliable MiniMax and other API-backed provider execution, including
  base64 edit payloads for large file edits;
- richer model-backed advisory teams that use controlled search against current
  competitors, critique domain-specific expectations and feed only source-backed,
  verifiable proposals into the local iteration plan;
- deeper UI/browser checks for accessibility, responsive layout, touch,
  keyboard and render-smoke behavior;
- broader project-surface harnesses for API, CLI, data, worker, game, ML,
  media, mobile, desktop and extension demos;
- long-running iteration reports that make every improvement, failure and open
  blocker auditable.

Longer term, MatrixOmnix should become a managed service: upload or connect a
demo repository, run it in a controlled workspace, compare it against real
market expectations, iterate safely for hours, then return a reviewed product
baseline with source control history, verification evidence and a clear list of
remaining release blockers.

---

It sits *above* coding agents (Claude Code, Codex, Devin, OpenHands, Aider, …)
and answers a different question:

> Has this demo actually become a maintainable project, and if not, what
> exactly is missing and how do we prove it stayed fixed?

Coding agents are the **Executor** behind a provider seam. MatrixOmnix owns
the parts coding agents are bad at: **Supervisor + Project Scorer + Gap
Analyzer + Verification Gate + QA Learning + Regression Memory + Docs Truth
Check + Workspace Isolation**.

The thesis is simple: the bottleneck in demo→project work is not raw code
generation — it is *enforced discipline*. AI agents skip verification, claim
completion without evidence, reintroduce yesterday's bug, and ship READMEs
that lie about what runs. MatrixOmnix mechanically prevents each of those
failure modes.

| What we do NOT do | What we DO do |
|---|---|
| Compete with Claude Code / Codex / Devin on code quality | Score the **project** (not the code) against a project-ready standard |
| Generate demos | Verify demos *became* projects (and detect regression) |
| Run an LLM by default | Run a deterministic loop; LLM providers are pluggable |
| Trust agent self-reports | Re-run verification independently and refuse unverified completions |
| Forget across sessions | Persist fingerprinted QA cases at repo / workspace / global scopes |

---

## What this solves

Demos typically lack: tests, build scripts, error handling, docs, config
hygiene, CI, regression coverage. Each individual gap is easy to describe but
hard to *consistently* close — AI agents skip verification, claim success
without evidence, lose context across runs, and reintroduce yesterday's bug.

MatrixOmnix enforces a discipline:

1. **Score** the project against a project-ready standard.
2. **Find gaps** with severity + suggested fix.
3. **Plan** a bounded batch of tasks (normally 4, up to 6 for broad
   deterministic productization backlogs) each with acceptance criteria and
   verification commands.
4. **Execute** via a pluggable `AgentProvider` (Mock / LocalCommand / a future
   ClaudeCode provider).
5. **Verify**: every code change must produce verification evidence **or** an
   explicit `unable_to_verify_reason`. No exceptions — the supervisor downgrades
   completion to failure when this is violated.
6. **Repair failed verification first**: a failed command becomes a blocker
   repair task before normal productization continues.
7. **Review** the result against the project standard.
8. **Learn**: the QA Agent extracts QA Cases (fingerprinted, deduped, persisted)
   from the iteration events and updates `qa/specs/qa-regression.spec.json`.
9. **Regress**: the QA runner replays workflow assertions over the iteration
   history of any project to ensure old failure modes do not return.

It now also runs a **misjudgment audit** before planning: high-risk findings
such as CLI/API/UI/LLM/social-deduction classifications are cross-checked
against concrete project evidence. If a finding lacks enough evidence, the
Analyzer records an agent-discovered misjudgment and suppresses that task
before Executor can mutate the wrong project surface.

## Harness Coverage

MatrixOmnix treats a "product" as a set of verified contracts, not a prettier
demo. Every surface is gated across three honest tiers:

| Tier | What it asks |
|---|---|
| **1 · Structural contract** | Always-on. Does the source actually look like this surface? (route decorators parsed, manifest schema valid, ML model has the right magic bytes, expo.slug is URL-safe, etc.) |
| **2 · Behavioural runtime** | Exercises the surface end-to-end (test_client hits every route, NotebookClient executes cells, sharp resizes a 16×16 buffer and checks the PNG signature, InferenceSession loads the model and runs). Specialized surfaces honestly skip-with-diagnostic when the runtime lib is absent. |
| **3 · Productization surface** | Operational maturity above runtime: error envelope, prompt-eval harness, provider failure fallback, token budget, prompt template registry, streaming response, etc. |

Current harness families include:

- **Single-file intake/runtime** — captures `demo.py`, `app.js`, `index.html`
  and similar raw entries before expansion.
- **CLI executable contract** — verifies installed/declared CLI entries expose
  a stable `--help` contract.
- **API contract/runtime** — detects Flask/FastAPI/Express/Fastify/Hono-style
  surfaces and requires a route contract harness.
- **Config contract** — extracts environment-variable usage and checks
  `.env.example` coverage.
- **Data/migration contract** — detects ORM/schema/migration surfaces and
  requires explicit schema evidence.
- **Worker contract** — detects queues, scheduled jobs and background workers
  before productizing async behavior.
- **Specialized delivery-surface contracts** — detects browser extensions,
  notebooks, mobile/desktop shells, games, 3D/WebGL scenes, ML model demos and
  media pipelines, then requires executable harnesses before agents apply
  unrelated UI/API/CLI assumptions.
- **UI product verification** — checks browser harnesses, render smoke,
  accessibility, responsive layout and common interaction risks.
- **Public product-claim verification** — flags UI/docs that promise hosted
  upload, processing or artifact-return flows without backend, worker, storage
  or API evidence; deterministic repair rewrites those surfaces into explicit
  beta CLI usage guidance instead of shipping false product claims.
- **Source-cited market research** — `matrixomnix research --web` runs a
  controlled, audited search provider and writes `.demo2project/research`.
  Gap analysis consumes only source-backed capabilities, ignores unsourced
  claims, and creates market-parity tasks without copying competitor text,
  code, UI, names or brand assets.
- **Agent-facing simulation products** — detects LLM/agent social-deduction
  theaters separately from human multiplayer games, then plans toward
  per-session model/provider settings, deterministic rule tests, prompt
  guardrails, replay/transcript artifacts, simulation/evaluation harnesses and
  observer-facing workflows.
- **LLM chat productization suite** — when a real `/chat`-style HTTP route
  is detected (not just an LLM dep), gates prompt-eval harness, mocked
  provider failure fallback returning structured 5xx, `MAX_MESSAGE_LENGTH`
  guard, `prompts/` template registry, and SSE streaming endpoint via a
  generated `streaming.py`. LLM-backed simulation servers (background loops
  with no chat surface) are explicitly excluded from this suite.
- **API operational maturity** — structured error envelope gate
  (`@app.errorhandler` returning `{error, message, status}` JSON for both
  404 and uncaught exception paths, with `tests/test_error_envelope.py`
  asserting the shape). Suppressed on multi-service repos where the
  cross-service integration check subsumes it. First slice of a longer
  operational-maturity roadmap (rate limit / OpenAPI / retry+backoff /
  dead-letter / bundle and a11y budgets to follow as bounded gates).

---

## Architecture (one screen)

```
                 ┌─────────────┐
   User goal ───►│ Supervisor  │◄── ProjectStandard
                 └────┬────────┘
                      │
       ┌──────────────┼───────────────────┐
       ▼              ▼                   ▼
   Research ──► source-cited market report
       │
       ▼
   Analyzer ──► Planner ──► Executor (Provider) ──► Verifier ──► Reviewer
       │                                                              │
       └──────────────► EventStore (JSONL) ◄──────────────────────────┘
                              │
                              ▼
                         QA Agent ──► QACaseStore + qa-regression.spec.json
                              │
                              ▼
                       Memory Agent (fingerprint dedup, frequency)
```

Each agent is a small TypeScript class — see `src/agents/`. Providers live in
`src/agents/providers/`.

---

## Multi-agent roles

| Agent | Responsibility |
|-------|----------------|
| Supervisor | Owns the loop; assigns tasks; enforces stop conditions |
| Analyzer | Scans, scores, produces gap report |
| Planner | Turns gaps into bounded, verifiable tasks |
| Executor | Wraps an `AgentProvider`; enforces verification policy |
| Verifier | Independently re-runs verification; appends evidence |
| Reviewer | Rule-based audit (forbid unverified completion, etc.) |
| QA Agent | Generates / dedupes / persists QA cases; updates regression spec |
| Memory Agent | Cross-iteration fingerprint counts, recurrence detection |

---

## Iteration closed loop

```
Scan ─► Score ─► Gap ─► Plan ─► Execute ─► Verify ─► Review ─► Learn ─► Regress ─► Repeat
```

See `docs/iteration-process.md` for the step-by-step inputs/outputs.

---

## How QA Agent learns from BUGs

Every iteration appends events to `<project>/.demo2project/events/<iter>.jsonl`.
After tasks finish, the QA Agent:

1. Reads the iteration's events.
2. Runs detectors → emits QA cases with a stable **fingerprint** (e.g.
   `missing_validation_after_code_change`).
3. Dedupes by fingerprint; merges into `<project>/.demo2project/qa-cases.json`.
4. Bumps `frequency` for recurring fingerprints.
5. Upserts into the system-level `qa/specs/qa-regression.spec.json` so the
   knowledge is available cross-project.
6. Future iterations run a **preflight** that warns about active cases.
7. `matrixomnix qa:regression` replays workflow assertions over recorded
   history — your CI line for not regressing.

See `docs/qa-agent.md` for the QA Case schema and dedup strategy.

---

## Install & run

```bash
pnpm install
pnpm build
pnpm test
```

CLI usage (after build):

```bash
pnpm matrixomnix analyze --project ./werewolf-demo --evidence --verify
pnpm matrixomnix gap --project ./werewolf-demo
pnpm matrixomnix long-run --project ./werewolf-demo --provider minimax-m27 --hours 10 --in-place --output reports/long-run/werewolf.json
```

For MiniMax live runs, set `DEMO2PROJECT_MINIMAX=1` and `MINIMAX_API_KEY`.
The default model is `MiniMax-M2.7-highspeed`; override it with
`MINIMAX_MODEL` when needed. The default MiniMax base URL is
`https://api.minimaxi.com/v1`; override it with `MINIMAX_BASE_URL` when needed.
The same key/model settings are used by `--advisory-agents` when
`--advisory-provider minimax` is selected.

```bash
# Inspect a project
pnpm matrixomnix analyze --project examples/bad-demo
pnpm matrixomnix gap --project examples/bad-demo
pnpm matrixomnix plan --project examples/bad-demo --goal "project-ready"

# Run one mock iteration (no external LLM)
pnpm matrixomnix iterate \
  --project examples/bad-demo \
  --goal "project-ready" \
  --max-iterations 1 \
  --provider mock --mode happy

# Run a model-backed iteration with source-backed advisory critics
pnpm matrixomnix iterate \
  --project examples/bad-demo \
  --goal "product-ready baseline" \
  --max-iterations 1 \
  --provider minimax \
  --web \
  --advisory-agents

# Run a premise-preserving agent-facing werewolf productization pass
pnpm matrixomnix iterate \
  --project ./werewolf-demo \
  --goal "Productize this agent-facing Werewolf multi-agent theater without changing its premise" \
  --max-iterations 2 \
  --provider minimax \
  --web \
  --advisory-agents

# QA workflow
pnpm matrixomnix qa:preflight --project examples/bad-demo
pnpm matrixomnix qa:regression --project examples/bad-demo

# Run the whole pipeline on this repo
pnpm matrixomnix self-check
```

All persisted state lives under `<project>/.demo2project/` — safe to delete
to start fresh.

---

## Provider design

`AgentProvider` is the swap point. Implementations:

- `MockAgentProvider` — deterministic; used by tests and the MVP.
- `LocalCommandProvider` — runs whitelisted local commands (e.g. test, build).
- `RuleBasedExecutor` — deterministic executor that writes a small supported
  set of projectization fixes and records verification evidence. It now covers
  README/env/gitignore/CI/smoke tests plus single-file intake, CLI, API,
  config, data, worker and UI harness scaffolds.
- `MiniMaxProvider` — real MiniMax API-backed executor. Set
  `DEMO2PROJECT_MINIMAX=1` and `MINIMAX_API_KEY`; the executor still reports
  changed files and verification commands through the same gate. The provider
  now retries malformed JSON edit payloads, rejects domain-drift edits such as
  replacing werewolf prompts with unrelated chess content, preflights Python
  syntax before writing files, broadens repair context for project-wide Python
  compatibility failures and refuses fake Node package scaffolds that would
  demote a Python project.
- `ClaudeCodeProvider` — real `claude -p` subprocess driver. Set
  `DEMO2PROJECT_CLAUDE_CODE=1` to arm; the JSON protocol is documented in
  `docs/architecture.md`.
- `MiniMaxAdvisoryProvider` — model-backed market/gap/planner/reviewer critic
  used by `iterate --web --advisory-agents`. It can propose work, but never
  edits files directly and never passes the release gate.

The system still works end-to-end without any external API through deterministic
providers. Model-backed providers add stronger implementation and critique, but
their claims are only accepted after local verification and scoring.

---

## Current limits

- Deterministic execution is intentionally conservative: `RuleBasedExecutor`
  can establish productization harnesses and repair supported patterns, but
  broad feature implementation still belongs to a model-backed provider.
- Reviewer is rule-based, not diff-based.
- Score weights are heuristic; tune via `config/project-standard.json`.
- QA runner asserts over recorded *events*, not live re-runs of commands.
- The MatrixOmnix web Service page is a beta usage guide. Hosted file intake,
  queued processing and artifact packaging are deferred until the productization
  pipeline has stronger production guarantees.
- Live MiniMax-M2.7-highspeed runs on restored `werewolf-demo` copies exposed
  and then repaired important gate failures: Flask Dockerfiles that existed but
  still launched `python app.py`, missing `wsgi.py` entries, CI installs that
  ignored `constraints.txt`, and stale API tests that supplied a player key
  while asserting `missing_api_key`. The latest copied-source evidence run
  reached `97/100 production_ready_baseline`, `product_maturity market_ready`,
  and `33 passed` in three iterations with no repair task. `Dockerfile`,
  `wsgi.py`, deployment docs and operations docs were batched through
  deterministic scaffolds instead of model free edits. This remains a
  productization baseline rather than a claim that no human release review is
  needed.
- The built-in stress suite now reports `15/15 product_ready` across UI, API,
  CLI, LLM, game, 3D, ML, media, browser extension, notebook, mobile, desktop,
  DB CRUD, multi-service repos and standalone workers. Specialized surfaces
  get behavior-level workflow repairs instead of stopping at docs and
  contract harnesses, and every surface ships a tier-1 structural check that
  fails on wrapper-only or placeholder demos so "test passed" can't be
  reached by emitting an empty `tests/__init__.py`.

---

## Roadmap

v0.0.6 = Phase-6 long-horizon autonomy & self-improving engineering. v0.0.5
proved we generalize across projects; **v0.0.6 proves we can run many
rounds without losing quality, detect when we should stop, refuse to
modify our own safety surface, and hand off cleanly to a human when stuck**.

### v0.0.6 — Long-Horizon Autonomy & Self-Improving Engineering System

- **`AutonomyPolicy` (6 levels)** — L0 read-only → L5 long-run.
  `config/autonomy-policy.json` declares the budget,
  `forbidden_self_modifications` list, and rollback rules. CLIs:
  `autonomy:policy / set-level / explain`.
- **`LongHorizonAutonomyController`** — session lifecycle wrapper around
  the supervisor with per-iteration trend snapshots, drift checks, and a
  governance decision log. CLIs: `autonomy:run / status / report`,
  `long-run`.
- **`QualityTrendMonitor`** — emits `continue / stop / rollback /
  request_approval` decisions from the iteration trend window. CLIs:
  `trend:show / explain`.
- **`ArchitectureDriftDetector`** — captures architecture fingerprints,
  flags file-count explosions, dependency bloat, test/source imbalance,
  oversized files, top-level dir sprawl. CLIs: `drift:check / compare`.
- **`RegressionBisector`** — walks recorded iterations, identifies the
  first iteration where score dropped or verification failed. CLIs:
  `regression:bisect / explain`, `rollback:stable`.
- **`SelfImprovementEngine`** — hypothesis → experiment workflow.
  Hypotheses touching `forbidden_self_modifications` paths are
  auto-rejected at proposal time. Real mutation deferred to a later phase
  by design. CLIs: `self:diagnose / hypotheses / experiment / accept /
  reject / rollback`.
- **`PlannerCalibrationEngine`** — records predicted vs actual deltas.
  Surfaces worst-predicted categories. CLIs: `planner:calibrate / report
  / explain`.
- **`ExecutorReliabilityModel`** — per-provider per-task-category
  reliability with `confidence_score`. CLIs: `executor:reliability /
  recommend / compare`.
- **`QAMemoryHealthManager`** — memory noise + usefulness scores,
  duplicate cluster detection, merge/retire/promote suggestions, conservative
  `qa:compact --apply`. CLIs: `qa:health / compact / merge / retire-stale
  / report-memory`.
- **`ReplaySystem`** — redacted reproducibility bundles. Source code is
  NOT bundled — pair with `git_ref`. CLIs: `replay:create / run / explain`.
- **`ScenarioStressTester`** — 15 named scenarios, run as a single command
  to confirm defensive behavior. CLIs: `scenario:list / run`.
- **`GovernanceDecisionLog`** — append-only JSONL of every autonomous
  decision. CLIs: `governance:log / explain`.
- **`HumanHandoffReport`** — structured handoff when stuck, with blockers,
  recommended actions, files to review, commands to run. CLIs:
  `handoff:create / show`.

### v0.0.6 verification (this commit)

- `pnpm test` → **62 files / 204 specs, all passing**
- `pnpm demo2project self-check` → **all 19 Phase-6 probes green**
- `pnpm demo2project scenario:run --all` → **15/15 scenarios pass**

### v0.0.5 — Cross-Project Generalization & Adaptive Learning

- **`ProjectArchetypeDetector`** — 11 archetypes (node-cli, typescript-library,
  react-app, nextjs-app, python-cli, python-package, fastapi-api, monorepo,
  docs-only-project, agent-framework, unknown) with explainable weighted-signal
  scoring. CLI: `archetype --project`.
- **Adaptive standards** — reorganized to `src/standards/{base,archetypes,learned}/`.
  `AdaptiveProjectStandardManager` auto-selects per archetype, with optional
  `learned/workspace-standard-overrides.json` overlay. CLIs:
  `standards:list / explain / validate`.
- **Transferable QA patterns** — `transferability` field on `QACase`
  (`applicable_archetypes` / `excluded_archetypes` / `required_project_signals`
  / `excluded_project_signals` / `portability_score`). `TransferabilityEvaluator`
  filters preflight per archetype. CLIs: `qa:transfer`, `qa:applicable`.
- **Project corpus** — local-only index of evaluated projects with
  path-hash + redaction. CLIs: `corpus:add / list / evaluate / remove / report`.
- **Cross-project learning** — `CrossProjectLearningEngine` aggregates
  anonymized reports → `LearningPattern[]`. CLIs: `learn:workspace / project
  / patterns / explain`.
- **Learning governance** — promotion candidates (repo→workspace,
  workspace→global) with manual approval gate for high-risk. CLIs:
  `learning:candidates / approve / reject / explain`.
- **Standard feedback loop** — `standards:suggest-updates`, with
  approve/reject CLIs.
- **Generalization evaluator** — `generalize --all [--report]`
  aggregates per-archetype success rate, weakest archetypes, recommended
  standard updates.
- **Project similarity** — Jaccard over deterministic signals.
  `similar --project` returns ranked historical-project hits.
- **Adaptive QA preflight** — `QAAgent.preflight` now detects archetype
  and filters cases via `TransferabilityEvaluator`. Adds `archetype` /
  `applicable` / `skipped` to the preflight result.
- **Workspace dashboard** — `report:workspace` emits 6 markdown reports
  to `reports/workspace/` (generalization, qa-memory, standard-feedback,
  corpus, executor-comparison).
- **Failure taxonomy** — fixed enum of ~35 categories under 8 buckets;
  shared join key for QA cases, gap findings, learning patterns. CLIs:
  `taxonomy:list / explain`.
- **Privacy redaction enhanced** — emails, `/Users/<n>` & `/home/<n>`
  paths, IPv4, DB URLs. CLI: `redact:test`.

### Generalization proof

Pointing v0.0.5 at unseen sibling project `/Users/mack/Desktop/Hosico/Works/Work/mentor`
(never in any benchmark): `archetype --project` correctly returned
`python-package` and selected the matching standard. Three unseen Python
projects classified consistently. Corpus entry persisted with the absolute
path redacted to `/Users/***/Desktop/Hosico/Works/Work/mentor`.

### v0.0.4 — Real-World Generalization & Control

- **Real `ClaudeCliProvider`** — `--provider claude-cli --enabled` shells out
  to the actual `claude -p` CLI. Before/after filesystem fingerprinting,
  confidence scoring (high/medium/low), and **low-confidence results never
  reach `completed`**. End-to-end verified in v0.0.4 against `claude` 2.1.139.
- **Evidence graph** — `EvidenceNode` + `ClaimNode` types persisted at
  `.demo2project/evidence/<iter>.json`. New CLIs: `evidence:show`,
  `evidence:explain`.
- **Anti-gaming detectors** — empty tests, sham assertions (`assert(1==1)`),
  echo-only build scripts, fake CI, secrets in source, dependency bloat.
  Penalties flow into the evidence-weighted score; `confidence_adjusted_score`
  added.
- **`benchmarks/public/` + `benchmarks/hidden/`** — hidden cases use
  `hidden_defects.json` (NOT `known_defects`) so they survive overfitting.
  `eval --include-hidden` is the generalization gate.
- **`long-run` CLI** — N iterations with trend reporting:
  `score_trend`, `qa_memory_growth`, `docs_truth_trend`,
  `final_stability_rating` (`stable` / `degraded_after_peak` / `volatile`).
- **Cost tracking** — every iteration writes a `CostRecord`
  (`wall_time_ms`, `command_count`, `token_estimate`, `retry_count`,
  `cost_per_score_point`). `cost:report` CLI.
- **Multi-executor comparison** — `compare-executors --case <n> --providers <list>`
  runs the same fixture through several providers and prints a comparison
  table.
- **Human approval gate** — `recordPendingApprovals` flags medium/high-risk
  paths; `approvals:list / approve / reject` CLIs. Default policy in
  `config/approval-policy.json`.
- **`self-iterate-sandbox`** — worktree-bounded self-mutation with mandatory
  `pnpm test` + `pnpm build` + score gate. `--apply` only.
- **10 new tests** — evidenceGraph, antiGamingScorer, costTracking,
  humanApprovalGate, hiddenBenchmark, multiExecutorComparison,
  longHorizonEvaluation, qaMemoryAudit, selfIterationSandbox, plus the
  expanded claudeCliProvider contract.

### v0.0.3 — Evaluation & Proof

- **A/B framework** — `eval --all | --case <name>` runs every benchmark
  through BOTH paths (`NaiveBaselineProvider` vs Demo2Project Supervisor loop)
  and emits a JSON + Markdown report under `reports/evaluation/`.
- **Headline result (8 cases):** Demo2Project wins **8/8**, average score
  Δ **+18.1**, baseline `unverified_changes` 3–4 per case vs Demo2Project's **0**.
- **Evidence-weighted scoring** — `scoreProjectWithEvidence` penalizes README
  claims without matching scripts, declared-but-unrun test commands, and CI
  configs that have nothing to run. Prevents "drop empty files for free score".
- **QA case lifecycle** — `new` → `active` → `confirmed` (TP ≥ 2) → `noisy`
  (FP > TP, n ≥ 3) → `retired`. CLI: `qa:audit`, `qa:retire`, `qa:promote`.
- **8 benchmarks** — bad-node-cli, bad-ts-library, bad-react-app, bad-next-app,
  bad-python-cli, bad-fastapi-api, bad-docs-project, bad-monorepo — each with
  `known_defects.json` + `evaluation_notes.md`.
- **ClaudeCliProvider contract test** — `provider:test --provider claude-cli`
  drives the adapter; tests verify it degrades gracefully when the binary is
  missing.
- **+25 tests** — `evidenceWeightedScorer`, `scoreGamingPrevention`,
  `qaCaseLifecycle`, `regressionEffectiveness`, `evaluationRunner`,
  `benchmarkSuite`, `claudeCliProvider`.

### v0.0.2 — Phase-2 hardening

- **Repositioned**: README and `docs/architecture.md` make explicit that
  Demo2Project is a **control layer**, not a coding agent. Coding agents are
  pluggable executors behind `AgentProvider`.
- **Provider isolation**: New `FutureProvider` stubs for Codex / Devin /
  OpenHands / Aider. A dedicated `providerIsolation.test` asserts the
  Supervisor never imports a concrete provider class.
- **Workspace isolation**: `IterationWorkspace` snapshots the base commit,
  runs each iteration on a `demo2project/iter-<id>` branch, and supports
  `iterate --use-worktree` + a new `rollback --iteration <id>` CLI.
- **Claude CLI hooks**: `templates/claude/` ships three hooks
  (pre-tool-use-safety, post-tool-use-event-recorder, stop-verification-gate)
  and a `claude:install-hooks` command. Hooks fail open on parse error,
  fail closed on rule match, and respect `DEMO2PROJECT_HOOKS_DISABLED=1`.
- **Docs truth check**: `DocsTruthChecker` parses README commands and
  verifies them against `package.json` scripts, Dockerfile, CI config, and
  `.env.example`. New CLI `docs:truth --project`.
- **Three-tier QA memory**: cases now have `scope` and `portability`; the
  QA Agent reads `global` → `workspace` → `repo` at preflight. Seeded
  `qa/specs/global-patterns.json` with well-known AI-coding failure modes.
- **Standards library**: 7 standards under `src/standards/library/`
  (generic / node-cli / typescript-library / react-app / nextjs-app /
  python-package / fastapi-api). Analyzer auto-selects per snapshot.
- **Benchmark suite**: 4 new benchmark fixtures with `known_defects.json`,
  `hidden_checks.md`, and expected score windows. `benchmark` now copies
  each fixture to a tmp sandbox before iterating — fixtures are never
  mutated. `--case <name>` runs a single benchmark.
- **Verification gate proven**: dedicated `verificationGate.test` exercises
  all 5 invariants end-to-end.
- **Security docs**: `docs/claude-cli-integration.md` and
  `docs/plugin-security.md` describe the hook protocol, MCP caveats, and
  the right posture for running agents on untrusted repos.

### Earlier phases (kept from v0.0.1) Heavier pieces (real model
calls behind API keys, vector embeddings, autonomous self-mutation) remain
explicitly deferred — the slice exists, the integration does not.

- **Phase 1 — MVP** ✅ deterministic loop, score, gap, plan, mock executor,
  verifier, QA learning, regression runner.
- **Phase 2** ✅ slice: `RuleBasedExecutor` writes real files; `ClaudeCodeProvider`
  is a real `claude -p` subprocess driver (gated by env flag); Supervisor
  supports `retryPolicy` and `parallelism`. ⏳ still future: Claude API SDK,
  OpenAI SDK, multi-provider concurrency policy.
- **Phase 3** ✅ slice: `QASimilarity` (Jaccard token overlap, no external
  embedding model). ⏳ still future: real embeddings, cross-project KB.
- **Phase 4** ✅ slice: rule handlers for README / `.env.example` / `.gitignore` /
  `tsconfig.json` / `Dockerfile` / CI workflow / smoke test / package.json
  scripts. ⏳ still future: error-handling rewrites, automatic project
  restructuring, language coverage beyond TS/JS.
- **Phase 5** ✅ slice: read-only `self-iterate` CLI emits the plan the
  system would apply to itself. ⏳ still future: worktree-bounded
  self-mutation with revert-on-failure.
- **Phase 6** ✅ slice: a second bad-demo (Python) and a `benchmark` CLI that
  scores every project under `examples/` and prints a table. ⏳ still future:
  paired before/after benchmarks and CI integration.

## Phase 7: Trust, Safety, Security & Enterprise-Grade Governance

Phase 7 turns Demo2Project from "can run autonomously" into "can be trusted
to run autonomously in an enterprise". It adds:

- **Threat model** (20 named threats; `security:threat-model`)
- **SecurityPolicyEngine** with 25-rule default policy (`policy:check`, `policy:violations`)
- **CapabilityManager** — time- and use-bounded permission tokens with high-risk gating
- **Untrusted repository mode** — unknown repos blocked from network / install / hooks
- **PromptInjectionScanner + PromptContextSanitizer** — repo content cannot override system policy
- **SecretScanner / SecretExposureDetector** — over both project files and persisted state
- **SupplyChainGuard** — typo-squat heuristic, lifecycle script analysis, lockfile diff
- **CommandGuard / FileAccessGuard / NetworkGuard** with `GuardedCommandRunner` and `GuardedFileSystem`
- **ApprovalWorkflow** — risk-tiered, role-based, scope-bound, expiring
- **AuditLog with SHA-256 hash chain** — `audit:verify` detects silent tampering
- **IncidentManager + EmergencyStop** — auto-stop on critical incidents
- **PrivacyMode** (4 levels) + **DataRetentionPolicy** + **DataInventory** + **DataDeletion**
- **Plugin / MCP / Hook scanners** (defense in depth, not security boundary)
- **Enterprise governance** — 6 roles, team policy, dual-approval option
- **TrustReport** — single document summarising current safety posture
- **8 new Claude CLI security hooks** — same checks one layer closer to the model

See `docs/security-overview.md` for the full guide.
