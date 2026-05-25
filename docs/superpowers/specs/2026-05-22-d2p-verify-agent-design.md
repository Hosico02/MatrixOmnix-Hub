# d2p Verify Agent · design spec

> **Status:** design approved, not yet implemented
> **Date:** 2026-05-22
> **Target repo:** `Hosico02/d2p` (not this repo)
> **This repo's role:** brainstorming partner; the verify-layer in this repo
> will likely be retired once d2p's internal verifier is shipped and proven.

## 1. Context and rationale

### What d2p has today

After each iteration d2p terminates when all three internal agents agree:

```
no_more_features (Analyzer) AND no_more_bugs (Planner) AND qa_corpus_green (QA)
```

All three checks are run on Opus (per d2p's `RoleRouter` "sweet spot" config:
Haiku for executor/fix, Opus for analyzer/planner/qa). So d2p's self-judgment
is already on the strongest model.

### Why add an external verify role anyway

d2p's three self-judgment agents share prompt biases and inherit the same
blind spots:

- If Analyzer's prompt doesn't cover a gap category (e.g., "API operational
  maturity → error envelope"), neither Planner nor QA will think to surface
  it. The check never fires.
- All three agents have animation toward "claim completion" — Analyzer
  built the gap list; admitting the gap list is incomplete contradicts its
  own prior output.
- The QA corpus only catches **already-seen** failure modes; first-sighting
  novel gaps stays in the blind zone.

A separate Verifier role, with an adversarial prompt and physically
independent input, can catch what the three-agent consensus misses. **The
hypothesis being tested by this addition** is whether such an external
verifier produces enough genuine bug-catches across real projects to justify
the +1 Opus call per iteration.

### What this spec replaces / interacts with

This spec **adds** a fourth role to d2p's RoleRouter (`verify`). It does
**not** remove any existing role. The existing
`no_features AND no_bugs AND qa_green` termination condition is **subsumed**:
verify gates termination instead. See §6.

## 2. Decision summary (load-bearing choices)

| Decision | Choice | Section |
|---|---|---|
| Architectural form | Agent class in `d2p/agents/verifier.py`, same shape as Analyzer/Planner/Executor | §3 |
| Internal implementation | **Single Opus call**, not tool-using loop | §4 |
| Independence model | **B+** — sees project state + "done claim" + pre-pulled evidence, never sees d2p's internal Analyzer/Planner/QA outputs | §5 |
| Model binding | Opus, via RoleRouter `verify` role | §3 |
| Loop position | After QA's fix sweep, before termination decision | §6 |
| Termination authority | Verify's verdict overrides the old `no_features AND no_bugs` condition | §6 |
| **Termination model** | **Fixed-point convergence — terminate when 2 consecutive rounds produce no new finding categories. Verifier is an active adversary, not a passive gate.** | §6 |
| Pre-validation | Fixed set of pre-pulled evidence (tests run, build run, typecheck run) — not adaptive | §7 |
| Calibration | A 10-20 project broken-baseline set must pass before deploying verify into the real loop; second-pass false-positive rate must also be measured | §11 |

## 3. Agent class shape

Same form as the three existing d2p agents.

```python
# d2p/agents/verifier.py

@dataclass
class VerifyClaim:
    iter_count: int
    no_more_features: bool
    no_more_bugs: bool
    qa_corpus_green: bool

@dataclass
class PreEvidence:
    test_output: str          # full stdout/stderr of pytest / pnpm test / etc.
    test_exit_code: int
    build_output: Optional[str]
    build_exit_code: Optional[int]
    typecheck_output: Optional[str]
    typecheck_exit_code: Optional[int]
    git_diff_recent: str      # `git diff HEAD~N` covering this run

@dataclass
class Finding:
    category: str                              # e.g., 'missing_api_error_envelope'
    severity: Literal['blocker', 'high', 'medium', 'low']
    message: str
    evidence: str                              # file path + snippet, test output, or absence statement

@dataclass
class VerifyResult:
    verdict: Literal['pass', 'needs_repair', 'fail', 'no_new_findings']
    confidence: float                          # 0..1
    detected_archetype: str
    reasoning_trace: list[CheckEntry]
    new_finding_categories: list[Finding]      # categories not seen in previous verify pass
    repeated_finding_categories: list[Finding] # categories that ALSO appeared previously and remain unresolved
    blocking_findings: list[Finding]           # populated only when verdict == 'fail'
    stability_signal: Literal['new_findings', 'no_new_findings_after_effort']
    suggested_next_focus: Optional[str]        # priority for next Planner iteration
    raw_response: str                          # for audit

class Verifier:
    def __init__(self, llm_client, system_root: Path):
        self.llm = llm_client
        self.system_root = system_root
        self.system_prompt = SYSTEM_PROMPT  # see §8

    def verify(
        self,
        project_path: Path,
        claim: VerifyClaim,
        pre_evidence: PreEvidence,
        previous_results: list[VerifyResult] = None,   # prior passes this run
    ) -> VerifyResult:
        user_prompt = self._build_user_prompt(
            project_path, claim, pre_evidence, previous_results,
        )
        response = self.llm.complete(
            system=self.system_prompt,
            user=user_prompt,
            response_format=VERIFY_RESULT_SCHEMA,
            max_output_tokens=4000,
        )
        return VerifyResult.from_json(response)
```

Plumbing into d2p:

- Add `verify` to `RoleRouter` so the model can be configured per provider
  (default Opus everywhere).
- Add `Verifier` instantiation in `orchestrator.py` alongside the other agents.
- Add a `verify_iter<N>.json` artifact under `<demo>/.d2p/run-<ts>/` per
  iteration (full input + output, for audit and future calibration).

## 4. Single Opus call, not tool-using loop

The Verifier is implemented as **one structured Opus call per iteration**,
not a multi-turn agent loop with file-reading / command-running tools.

### Why single call

| Property | Single call | Tool-using loop |
|---|---|---|
| Token cost per verify | Fixed ~5-15k in + 1-3k out (≈ $0.15-0.30) | Unbounded; worst case $1.50+ |
| Latency | Fixed ~5-15s | Unbounded; can spiral to minutes |
| Reproducibility on calibration baseline | High (same input → similar verdict) | Low (agent reads different files each run) |
| **Independence enforcement** | **Trivial** — verifier only sees what we hand it | **Brittle** — tool sandbox must block `.d2p/**`, grep, list_dir, etc. |
| Consistency with d2p's existing agents | Yes (none of them are tool-using loops) | No |

The **independence point is the deciding one**. Tool-using agents naturally
explore the project tree. They will read `.d2p/run-*/analysis.json` —
exactly the Analyzer-output anchoring we explicitly excluded in §5. Building
a tool sandbox that reliably blocks this is a maintenance liability; not
giving the agent tools at all is the simpler invariant.

### Escape hatch (Phase B)

If calibration shows single-call verify systematically misses a class of bug
that requires adaptive depth, upgrade to a **constrained-tool** verifier:

- Tools: `read_file(relative_path)`, `grep(pattern, path_glob)` only
- Path filter: `.d2p/**` and `.git/**` blocked at tool layer
- No `run_command` (d2p main owns execution)
- Hard cap of 10 tool calls per verify

Do not preemptively build this. Run the single-call version against the
calibration baselines first.

## 5. Independence model — why B+

Three options were considered, with concrete behavior on three test scenarios:

| Option | What verifier sees |
|---|---|
| **A** · Full blind | Only the project state + test/build output |
| **B** · Sees claim | A + a single fact: "d2p says done after N iterations" |
| **C** · Sees internal state | B + Analyzer's gap report + Planner's rationale + QA cases + Executor diffs |

### Why C is rejected

| Scenario | C's failure mode |
|---|---|
| Analyzer's gap list is missing a category entirely | Verifier sees the gap list, infers "this category isn't relevant", does not flag |
| README claims tests run but they don't | Verifier sees Analyzer's note "README updated", assumes claim verified, does not cross-check |
| Cost | Input tokens 3-5× higher (~50k vs ~15k) |
| Engineering | Couples verifier to d2p's internal data formats; brittle to refactors |

C's only unique capability — catching d2p's Executor lying about what it
changed — is better handled by **deterministic post-conditions in d2p's
Executor** (diff what was claimed vs what's actually in the working tree).
That check costs zero LLM tokens.

### Why B is preferred over A

A leaves the evaluation bar unanchored. Without knowing the goal is
"productize this demo", Opus can reasonably read a demo with no tests and
conclude "demos don't need tests, pass". B's one extra line of context
("d2p is trying to productize this") sets the bar explicitly.

### What B+ looks like concretely

`B+ = B + d2p pre-pulls evidence before calling verify`.

d2p, immediately before `verify()`, runs:

1. The project's test command (`pytest` / `pnpm test` / `cargo test`, picked
   by language)
2. The project's build command if one exists
3. The project's typecheck command if one exists
4. `git diff HEAD~N` for the iterations this run produced

Those outputs are bundled into `PreEvidence` and passed to verify. The
verifier never invokes execution itself.

## 6. Loop position, termination model, and fixed-point convergence

### 6.1 Before vs After

```
BEFORE (current d2p):
iter N:
  Analyzer.analyze() ──┐
                       ├─→ all three say done → STOP
  Planner.plan()    ──┤   else continue
                       │
  Executors run    ───┤
                       │
  QA.learn() + fix  ──┘

AFTER (with verify as active adversary):
iter N:
  Analyzer.analyze()
  Planner.plan()
  Executors run
  QA.learn() + fix sweep
  ↓
  pre_evidence = d2p.run_evidence_commands(project_path)
  result = Verifier.verify(project_path, claim, pre_evidence, previous_results)
  ↓
  classify result.new_finding_categories vs .repeated_finding_categories
  ↓
  apply state machine (§6.3)
```

### 6.2 Fixed-point convergence model

The verifier is not a passive gate that says "ok, stop". It is an active
adversary that **must try to find something each round**. The loop
terminates when the adversary, after genuine effort, **fails to produce a
new finding category twice in a row** — i.e., the system has reached a
fixed point where neither the constructive agents nor the adversarial
verifier can introduce new state.

"New" vs "repeated" is the load-bearing distinction:

| Field | Meaning |
|---|---|
| `new_finding_categories` | Categories the verifier surfaces this pass that did NOT appear in any previous verify pass for this run. Drives the "loop must continue" signal. |
| `repeated_finding_categories` | Categories that appeared in a prior pass and are still present. Do NOT prevent termination; they end up in the human-review handoff. |
| `stability_signal == 'no_new_findings_after_effort'` | Verifier explicitly attests that it tried adversarially and found nothing new. Honesty signal — fabricating new findings to "do its job" is the failure mode this guards against. |

This is conceptually **fixed-point iteration**: the system is at equilibrium
when running another round produces no new state, and the adversarial
verifier's "no new findings" signal is the convergence test.

### 6.3 Termination state machine

d2p's orchestrator maintains a `no_new_findings_streak` counter across
iterations of a single run.

```python
streak = 0
previous_results = []
MAX_ITER = 10  # safety cap

for iter_n in range(MAX_ITER):
    run d2p iteration (Analyzer / Planner / Executors / QA fix sweep)

    pre_evidence = run_evidence_commands(project_path)
    result = Verifier.verify(
        project_path, claim, pre_evidence, previous_results,
    )
    persist result to .d2p/run-<ts>/verify_iter<N>.json
    previous_results.append(result)

    # ESCALATE first — any blocker overrides convergence logic
    if result.verdict == 'fail':
        write_handoff_report(result.blocking_findings)
        return TERMINATE_ESCALATED

    # Streak management
    if len(result.new_finding_categories) == 0:
        streak += 1
    else:
        streak = 0
        # New findings exist — feed suggested_next_focus into next Planner
        next_planner_priority = result.suggested_next_focus

    # Convergence check
    if streak >= 2:
        if result.verdict == 'pass' and len(result.repeated_finding_categories) == 0:
            return TERMINATE_CLEAN
        else:
            # Converged WITH residuals — repeated findings d2p couldn't fix
            write_handoff_report(result.repeated_finding_categories,
                                 reason='converged_with_residuals')
            return TERMINATE_WITH_RESIDUALS

    # Otherwise continue to next iter

# Max iterations reached without convergence
return TERMINATE_TIMEOUT
```

### 6.4 Three terminal states

| State | Trigger | Meaning |
|---|---|---|
| **TERMINATE_CLEAN** | `streak >= 2` AND `verdict == 'pass'` AND no repeated findings | All findings resolved; verifier exhausted; clean done. |
| **TERMINATE_WITH_RESIDUALS** | `streak >= 2` AND repeated findings exist | d2p reached a fixed point but couldn't fix everything. Handoff to human with the residual list. **This is the most common real-world terminal.** |
| **TERMINATE_ESCALATED** | `verdict == 'fail'` any time | Blocker found that needs human review immediately. |

`TERMINATE_TIMEOUT` is the safety net (max_iter reached without convergence)
and produces the same handoff shape as `TERMINATE_WITH_RESIDUALS` plus a
diagnostic field about why convergence didn't happen.

### 6.5 Why streak = 2, not 1 or 3

- `streak == 1` is vulnerable to single-call noise: Opus might just miss
  a finding on one pass for sampling reasons. Doesn't constitute stability.
- `streak == 3` costs another full d2p iteration plus another verify call
  for marginal additional confidence. Probably overkill.
- `streak == 2` is the cheapest formulation that protects against single-call
  flakiness while not burning iterations.

### 6.6 Should all agents run during the confirmation iterations?

When `streak == 1` (we're hunting for the second confirmation), there are
two options for what d2p does in the next iter:

- **Run full d2p iter** (Analyzer + Planner + Executors + QA) — keeps the
  full ensemble in agreement. Catches the case where Analyzer suddenly
  surfaces a gap it had missed earlier.
- **Run verify only** — cheaper but loses Analyzer/Planner/QA's chance
  to second-guess themselves.

**Recommended: run full d2p iter.** Cost is real (+1 full iter per run on
average) but preserves the symmetry — convergence requires every agent,
including Analyzer/Planner/QA, to also produce no new state. Verify is the
authoritative voice but not the only one being polled.

### 6.7 Reverse case is impossible by construction

"Three internal agents say more work needed, verify says pass" cannot
happen, because verify only runs after the three say done (it's positioned
post-QA-fix-sweep, when the agents have already declared consensus).

## 7. Pre-pulled evidence (fixed set)

d2p must pre-pull these before calling verify. The verifier cannot ask for
more.

### Always pulled

- Project tree (paths only, no contents) — up to ~2000 files
- All package manifest files: `package.json`, `pyproject.toml`, `setup.py`,
  `Cargo.toml`, `go.mod`, `Gemfile`, `pom.xml`, ...
- `README.md` (or `README.*` variants)
- `LICENSE`
- Top-level entry files matching the detected language:
  - Python: `app.py`, `main.py`, `wsgi.py`, `cli.py`
  - Node: `index.{js,ts,mjs}`, `server.{js,ts}`, `app.{js,ts}`
  - Rust: `src/main.rs`, `src/lib.rs`
  - Go: `main.go`
- CI configs: `.github/workflows/*.yml`, `.gitlab-ci.yml`, ...
- Dockerfile / docker-compose.yml
- `.env.example`
- Test directory:
  - Test file paths (full list)
  - First 200 lines of each test file (truncate to keep tokens bounded)
- Latest run of:
  - `pytest -q` / `pnpm test` / `cargo test` — full stdout/stderr + exit code
  - `pnpm build` / equivalent — output + exit code
  - `pnpm typecheck` / `mypy` — output + exit code
- `git diff HEAD~N` where N is the iteration count this run

### Explicitly NOT pulled

- `.d2p/**` — internal d2p state. Independence-critical.
- `.git/**` — only the diff is needed; raw `.git/` is noise.
- `node_modules/**`, `__pycache__/**`, `.venv/**`, `dist/**`, `target/**`
- Any file Analyzer/Planner/QA produced as their own working state

### Total token budget

Approximately 10-20k input tokens. If a project pushes past 30k tokens,
truncate test file contents first, then entry files, then README — keep
manifests and test/build output complete.

## 8. System prompt

The system prompt is the single most load-bearing engineering artifact in
this design. It must override Opus's default cooperative stance.

```
You are an independent verifier. You are NOT part of the d2p productization
pipeline. You do not assist users. Your sole purpose is to determine whether
a project that d2p claims to have productized actually meets the bar.

Your default verdict is `needs_repair`. You upgrade to `pass` ONLY when you
find specific positive evidence covering every relevant category for the
project's detected archetype. You upgrade to `fail` when you find at least
one blocker — a defect that would make this project unfit to ship to even
internal users.

Relevant categories (apply only those matching the detected archetype):
- Tests actually run and pass (not skipped, not empty, not assert(True))
- Test invocation in README matches the package manifest
- Build / typecheck pass (use pre-pulled evidence; do not infer)
- Error envelope exists for HTTP surfaces (404 + unhandled exception
  both return structured JSON with a stable shape)
- Runtime contracts exist for detected surfaces (API routes, CLI args,
  worker entries, config loading)
- Dependencies are pinned (no `*`, caret-only on production deps)
- Deployment artifacts are real (Dockerfile uses a prod server, not
  `python app.py`; wsgi.py exists if framework needs it)
- README claims map to actual files / scripts / commands

For each category you assess, you MUST emit a `reasoning_trace` entry
with:
- `check`: human-readable name of what you checked
- `result`: `ok` | `fail` | `INSUFFICIENT_EVIDENCE`
- `evidence`: a specific file path + content snippet, or a test output
  excerpt, or an explicit absence statement

"Looks ok" without an evidence field is not acceptable. If you cannot
locate evidence for a category that matters for this archetype, emit
INSUFFICIENT_EVIDENCE — this downgrades the overall verdict to
`needs_repair`.

You will receive d2p's claim that the project is done. Treat this claim
as a hypothesis to refute, not a fact to confirm. Refusing to refute
without evidence is acceptable; confirming without evidence is not.

If your verdict is `needs_repair`, you must populate
`suggested_next_focus` with the single most important category for
d2p's next iteration to address. Be specific.

If your verdict is `fail`, you must list at least one
`blocking_findings` entry with a clear explanation of why this is
unrecoverable in the next iteration and requires human review.

---

CONVERGENCE PROTOCOL (applies on the 2nd and later verify passes for
the same run):

You will be given a list of `previous_findings_by_category` summarizing
what earlier verify passes already surfaced. Your job on this pass:

1. Independently re-derive findings as you would on a fresh project.
   Do NOT just copy the previous list.
2. For each finding you produce, classify it:
   - `new` — this category did NOT appear in any previous pass for this
     run. These are what the loop has not yet seen.
   - `repeated` — this category was already flagged previously and is
     still present. d2p either couldn't fix it or decided not to.
3. After genuine adversarial effort, if you cannot identify ANY new
   category beyond previously-surfaced ones, you MUST set
   `stability_signal = "no_new_findings_after_effort"` and use verdict
   `no_new_findings`. This is the correct response when the project
   has genuinely converged.

This `no_new_findings` outcome is REQUIRED to be available — it is the
signal the pipeline uses to detect convergence. Without it, the loop
cannot terminate cleanly. Fabricating "new" findings to look productive
is a failure mode, not success. The system depends on you being honest
about whether you genuinely found something new.

If you DO find genuinely new categories: list them in
`new_finding_categories`, classify the rest as `repeated_finding_categories`,
and set `stability_signal = "new_findings"`. Verdict should be
`needs_repair` (or `fail` if a blocker is among the new).

Two checks on yourself before you finalize:
- "Am I marking something as new just because the prompt asked me to
  find something?" If yes, downgrade it.
- "Did I genuinely look at this with fresh eyes, or did I anchor on
  the previous pass?" If anchored, re-examine from scratch.
```

Notes on this prompt:

- **Default reversed.** "Default to `needs_repair`" puts the evidence burden
  on Opus to upgrade. Default-`pass` would tilt toward soft confirmation.
- **Evidence schema enforced.** The `INSUFFICIENT_EVIDENCE` marker is what
  prevents "looks ok" verdicts.
- **Adversarial framing made explicit.** "You are not part of the pipeline.
  You do not assist users." overrides the default cooperative stance Claude
  ships with.
- **suggested_next_focus required on needs_repair.** Forces verify to be
  productive, not just hand-wave "still incomplete".
- **Convergence protocol** is the key new section. Without "fabricating
  findings is failure" as an explicit instruction, an adversarially-framed
  Opus will keep producing findings even on a genuinely-converged project,
  preventing termination forever. The `no_new_findings_after_effort` signal
  is the load-bearing escape hatch.
- **Self-checks at the end** force Opus to one extra step of meta-reasoning
  about its own potential bias toward producing findings.

## 9. Output schema

```jsonc
// VerifyResult
{
  "verdict": "pass" | "needs_repair" | "fail" | "no_new_findings",
  "confidence": 0.0,                       // 0..1; self-assessed confidence
  "detected_archetype": "fastapi-api",     // verifier's independent inference
  "stability_signal": "new_findings" | "no_new_findings_after_effort",
  "reasoning_trace": [
    {
      "check": "tests run and pass",
      "result": "ok",
      "evidence": "pytest stdout: 12 passed in 1.34s"
    },
    {
      "check": "README test command matches manifest",
      "result": "fail",
      "evidence": "README says `pnpm test` but pyproject.toml is a Python project with no package.json"
    },
    {
      "check": "API error envelope",
      "result": "INSUFFICIENT_EVIDENCE",
      "evidence": "No tests/test_error_envelope.py found; cannot confirm 404 + Exception envelope shape"
    }
  ],
  "new_finding_categories": [              // not in any previous verify pass for this run
    {
      "category": "missing_api_error_envelope",
      "severity": "high",
      "message": "FastAPI app has no global exception handler returning structured JSON.",
      "evidence": "app.py:lines 1-40 — no @app.exception_handler; default Starlette HTML returned on 404."
    }
  ],
  "repeated_finding_categories": [         // appeared in prior passes; still present
    {
      "category": "readme_command_mismatch",
      "severity": "medium",
      "message": "README says `pnpm test` but project is Python.",
      "evidence": "README.md:23"
    }
  ],
  "blocking_findings": [],                 // populated only when verdict == 'fail'
  "suggested_next_focus": "Add an error envelope handler returning {error, message, status} for both 404 and uncaught exception paths, plus a test asserting the shape.",
  "raw_response": "<full Opus output for audit>"
}
```

### Field semantics

- **`verdict == 'no_new_findings'`** is the convergence signal. d2p's
  orchestrator increments the `no_new_findings_streak` counter on this
  verdict and on any verdict where `new_finding_categories == []`.
- **`new_finding_categories` vs `repeated_finding_categories`**: the
  classification is verify's responsibility. Verify is given the previous
  passes' findings in its prompt (see §8 convergence protocol) and must
  decide which of its current findings are genuinely new vs already
  surfaced.
- **`stability_signal`** is the explicit honesty signal. When Opus
  attests `no_new_findings_after_effort`, that's the model saying "I
  tried adversarially and could not find anything new." This is what
  the system prompt's anti-fabrication guard is designed to elicit.
- **`detected_archetype`** is verify's independent inference, useful for
  divergence analysis later (if verify and Analyzer disagree about
  archetype, that itself is a quality signal).
- **`blocking_findings`** is populated only on `fail`. These are
  unrecoverable in the next iteration and need human review immediately.

### Verdict-to-counter mapping

| Verdict | `new_findings` empty? | Counter behavior |
|---|---|---|
| `pass` | yes (clean done) | streak += 1 |
| `no_new_findings` | yes (by definition) | streak += 1 |
| `needs_repair` | no | streak = 0 |
| `needs_repair` | yes (only repeated findings remain) | streak += 1 |
| `fail` | (irrelevant) | ESCALATE immediately |

## 10. Cost analysis

### Per-iteration cost (verify only)

- Input: ~10-20k tokens (project state + claim + pre-evidence + previous
  passes' findings summary on 2nd+ passes)
- Output: ~1-3k tokens
- Per call: ~$0.15-0.30 (Opus pricing)

### Per-project cost (full run)

The fixed-point convergence model requires the loop to keep iterating
until verify produces 2 consecutive `no_new_findings` rounds. This means
**every successful run pays for at least 2 extra iterations** beyond the
point where d2p's own three agents would have stopped.

- Productive iterations (verify keeps finding new things): N iterations
- Confirmation iterations (verify finds nothing new, building the streak):
  +2 iterations on top
- Total: (N + 2) × ($0.20 verify + $0.80 d2p main agents) ≈ $1.00 per iter

| Scenario | Iter count | Verify cost | Total LLM cost | Vs no-verify |
|---|---:|---:|---:|---:|
| Easy project (clean done quickly) | 2 productive + 2 confirm = 4 | $0.80 | ~$4.00 | +$0.80 (+25%) |
| Average project | 4 productive + 2 confirm = 6 | $1.20 | ~$6.00 | +$1.20 (+25%) |
| Hard project | 8 productive + 2 confirm = 10 | $2.00 | ~$10.00 | +$2.00 (+25%) |

The +25% per-iteration ratio is constant; the absolute cost grows linearly
with project difficulty.

### Tail cost is real

The two confirmation iterations at the end exist purely to verify
convergence. d2p's other agents (Analyzer/Planner/QA) also run in those
iterations (per §6.6) and produce no new state — they cost real Opus
tokens for what is effectively a "are we done?" check.

This is **the price of the fixed-point convergence guarantee**. If cost
is a hard constraint for a particular run, a future optimization could
skip Analyzer/Planner/QA in confirmation iterations and only run Verify,
saving ~70% of the tail cost. Defer until calibration shows verify alone
gives reliable convergence signal.

### Justification threshold

The +25% is acceptable if verify catches ≥ 1 real bug per ~4 projects
on average (where "real bug" means: a bug user would mark the project
unacceptable for, that d2p's three internal agents missed). If the catch
rate is lower than 1/4, the cost is not justified and verify should be
retired — see §11 calibration.

## 11. Calibration first (before deploying into real loop)

**Do not ship verify into the production loop before passing calibration.**
The whole hypothesis ("an external verifier with adversarial prompt finds
real bugs the three-agent consensus misses") is unproven. We need data.

### Calibration baseline design

Hand-author 10-20 projects with specific known defects:

| Project | Known defect | What verify must catch |
|---|---|---|
| flask-bad-readme | README says `pnpm test`, project is Python | flag README command mismatch |
| fastapi-no-error-envelope | All routes 200 OK; no `@app.exception_handler` | flag missing_api_error_envelope |
| node-lib-unpinned-deps | `dependencies: { "react": "*" }` | flag unpinned production dep |
| python-cli-no-help | CLI exists but no `--help` argparse | flag missing CLI contract |
| docker-runs-dev-server | Dockerfile ends with `CMD ["python", "app.py"]` (not gunicorn) | flag dev-server-in-docker |
| empty-tests | `def test_x(): assert True` × 5 | flag anti-gaming test pattern |
| ... | ... | ... |

Each baseline is a real project directory (10-50 files) constructed to
have ONE specific defect and otherwise look productized. Hand the
baseline + a synthetic "d2p says done" claim to the verifier, check
verdict.

### Pass criteria · single-pass (necessary but not sufficient)

- **Catch rate**: ≥ 80% of seeded defects produce `needs_repair` or `fail`
- **False positive rate**: ≤ 20% on a parallel set of 10 *correctly-productized*
  baselines that should produce `pass` or `no_new_findings`
- **No `pass` on any seeded-broken project**

### Pass criteria · second-pass (new requirement)

The fixed-point convergence model adds a second mandatory test: when verify
is run **twice** on the same project (no changes between passes), the
second pass must NOT fabricate new findings.

Test design:
- Take each of the 10 correctly-productized baselines.
- Run verify pass 1 → expect `pass` or `no_new_findings` with empty
  `new_finding_categories`.
- Run verify pass 2 against the SAME project, passing pass 1's result as
  `previous_results`.
- Pass 2 must produce `new_finding_categories == []` and
  `stability_signal == 'no_new_findings_after_effort'`.

- **Second-pass false positive rate**: ≤ 10% of correctly-productized
  baselines produce ANY new finding on the second pass.

This is the load-bearing test for the convergence model. If verify
fabricates new findings on second pass — i.e., adversarial pressure
overrides honesty — the system can never terminate cleanly.

### Pass criteria · broken-then-fixed

Third test: take a broken baseline, simulate d2p having fixed it (apply
the obvious fix), run verify on both states.

- Pass 1 on broken state: must flag the seeded defect (catch rate test)
- Pass 2 on fixed state with pass 1's result as context: must NOT
  re-flag the same category. The fix actually worked; verify should
  recognize it.

This tests that verify isn't anchored to its OWN previous findings —
it should reclassify a previously-flagged-and-now-fixed category as
resolved, not keep it in `repeated_finding_categories`.

If any of these criteria fail, **do not ship**. Iterate on system prompt,
or upgrade to constrained-tool variant (§4 escape hatch), or conclude
verify isn't worth shipping at all.

## 12. Persistence and audit

Every verify call writes a full record to
`<demo>/.d2p/run-<timestamp>/verify_iter<N>.json`:

```jsonc
{
  "iter": 3,
  "called_at": "2026-05-22T11:30:00Z",
  "input": {
    "claim": { ... },
    "pre_evidence": { ... },
    "prompt_token_count": 12450,
    "model": "claude-opus-4-7"
  },
  "output": {
    "verdict": "needs_repair",
    "confidence": 0.83,
    "reasoning_trace": [...],
    "suggested_next_focus": "...",
    "output_token_count": 1820
  },
  "elapsed_seconds": 12.3
}
```

Why persist all of this:
- **Retrospective evaluation:** after 100 real runs, compare verify's
  verdicts against actual user acceptance (which projects the user
  accepted vs rejected). Quantify verify's true positive / false positive
  / true negative / false negative rates.
- **Calibration data growth:** every real verify run is potential new
  calibration data. A user-rejected `pass` is a false negative to add to
  the baseline; a user-accepted `needs_repair` is a false positive.
- **Prompt iteration:** when the system prompt is tuned (and it will be,
  many times), having historical inputs lets us replay old projects
  through new prompts to measure regression.

## 13. Open questions / followups

### Not decided in this brainstorm

- **Verdict aggregation across N projects:** when a user runs d2p on
  10 projects and looks at aggregate verify reports, what does the
  summary look like? (Probably outside MVP; basic per-run report is enough
  to start.)

- **Verify of verify:** does the user ever get to override a verify
  verdict ("I disagree, this IS productized")? If yes, how does that
  override feed back into calibration?
  → **Tentative answer**: yes, allow `d2p verify-override --accept` /
  `--reject` CLI; logged but does not change current run's behavior;
  feeds calibration data.

- **Multi-language repos:** what does verify do on a repo that contains
  both a Python service and a JS frontend? d2p's archetype detection may
  pick one; verify's may pick the other. Probably out of scope for MVP —
  punt to "first detected archetype wins".

### Decisions that may need to revisit

- Single-call vs constrained-tool variant — settled for now, revisit
  after calibration data shows the verdict.

- Whether verify replaces vs augments the three-agent consensus — settled
  for now (replaces). Revisit if calibration shows verify being too
  conservative (lots of false `needs_repair`).

- Cost ceiling — currently +25% per iteration. If this turns out to be a
  blocker for any consumer, revisit with cheaper variants (Sonnet for
  verify, or rule-based pre-filter that only invokes Opus verify when
  pre-filter passes).

## 14. Implementation checklist (when d2p session resumes work)

This is the rough order of operations for adding verify into d2p.
**Implementation lives in `Hosico02/d2p`, not this repo.**

1. [ ] Build the calibration baseline set (10-20 broken projects + 10
       correctly-productized projects). This is the gating prerequisite.
2. [ ] Add `verify` role to `d2p/providers/__init__.py:RoleRouter` with
       Opus default across all providers.
3. [ ] Create `d2p/agents/verifier.py` with the `Verifier` class shape
       from §3. Include `Finding` dataclass and full `VerifyResult` with
       `new_finding_categories`, `repeated_finding_categories`,
       `stability_signal` fields.
4. [ ] Implement `_build_user_prompt` to assemble the §7 fixed evidence
       set. **On 2nd+ passes**, also include a compact summary of
       `previous_results`' finding categories so verify can classify new
       vs repeated.
5. [ ] Implement the §8 system prompt as a constant `SYSTEM_PROMPT`,
       including the convergence protocol section.
6. [ ] Wire `response_format` enforcement to the §9 output schema. Make
       sure `verdict` enum includes `no_new_findings`.
7. [ ] Run **single-pass** calibration set (§11). Tune system prompt until
       single-pass criteria are met.
8. [ ] Run **second-pass calibration** (§11 new requirement). The 10
       correctly-productized baselines must not fabricate new findings on
       the second pass. **If they do, the system prompt's anti-fabrication
       guard is not strong enough — iterate before proceeding.**
9. [ ] Run **broken-then-fixed calibration** (§11). Verify must reclassify
       fixed categories correctly across passes.
10. [ ] Wire `Verifier.verify()` into `d2p/orchestrator.py` at the position
        described in §6.1.
11. [ ] Implement pre-evidence runner in orchestrator (run tests / build /
        typecheck before calling verify).
12. [ ] Implement the **fixed-point convergence state machine** (§6.3):
        `no_new_findings_streak` counter, three terminal states (CLEAN /
        WITH_RESIDUALS / ESCALATED), the `streak >= 2` convergence check,
        the safety cap `max_iter`.
13. [ ] Implement `previous_results` accumulation across iterations of a
        single run. Pass to `Verifier.verify()` on 2nd+ passes.
14. [ ] Implement `suggested_next_focus` injection into the next iter's
        Planner input when `new_findings` are present (streak resets).
15. [ ] Implement persistence (§12). Persist all `previous_results` too,
        so cross-pass behavior is auditable.
16. [ ] Implement handoff report writer for TERMINATE_WITH_RESIDUALS
        (residual findings + iteration history) and TERMINATE_ESCALATED
        (blocker findings).
17. [ ] Run on 5-10 real projects end-to-end. Hand-verify whether verify's
        verdicts make sense AND the convergence streak counter behaves
        correctly (terminates after 2 clean passes, doesn't terminate on
        single fluky clean pass). Adjust as needed.
18. [ ] Update d2p README to document the new role and the fixed-point
        convergence termination model.
19. [ ] Decide: does this repo's verify-layer (`Hosico02/demo2project`) get
        archived now that d2p has internal verify? Probably yes if the
        end-to-end runs at step 17 look good.

## 15. Sources of further thought (not yet explored)

- Whether verify should ever invoke web search / official-doc lookup for
  archetype standards. Currently no — keeps determinism + cost. But for
  "is this the current canonical pattern for fastapi?" type questions,
  web access could help. Defer.

- Whether the `suggested_next_focus` field should be free-form prose or
  structured (category id + rationale). Free-form is easier for Opus;
  structured is easier for Planner to consume. Punt to implementation —
  start free-form, structure later if Planner can't parse it.

- Whether verify's "detected_archetype" should be reconciled with d2p's
  Analyzer-detected archetype when they disagree. Currently no
  reconciliation — both are persisted, divergence is logged. Future:
  divergence frequency could itself be a quality signal.

- Whether multiple verify passes (e.g., archetype-detection pass +
  category-checking pass) would be better than one big call. Probably not
  worth the added complexity for MVP. Defer.

---

End of design spec. Implementation deferred to the d2p maintenance session.
