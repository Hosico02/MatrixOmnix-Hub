# d2p Verifier calibration harness — v0 design

**Date:** 2026-05-26
**Author:** session 9
**Status:** draft, awaiting user review
**Implementation repo:** `Hosico02/d2p` (this repo holds specs/plans only)

## 1. Purpose

The d2p Verifier (`d2p/agents/verifier.py`, shipped session 8) is opt-in
behind `D2P_VERIFY_ENABLED=1`. The
[verify-agent spec §11](./2026-05-22-d2p-verify-agent-design.md) lists
this as the gating prerequisite before turning verify on by default:

> Do not ship verify into the production loop before passing calibration.

This v0 harness builds the **toolchain + a small seed baseline set** so we
can observe single-pass behaviour on hand-authored projects with known
defects, get an early read on catch rate / false-positive rate, and have a
shape to grow into for the second-pass and broken-then-fixed criteria.

**This is NOT the full §11 calibration.** Single-pass only. 8 baselines
(5 broken + 3 productized). Single model (`minimax-m2.7-hs`). The full set
(20 broken + 10 productized + four pass criteria + Opus parallel run) is
explicitly deferred — see §10.

## 2. Scope

**In:**
- Directory layout for hand-authored baselines under `d2p/tests/calibration/`
- `expected.json` schema describing each baseline's classification + the
  category-substring set verify is expected to surface
- A `scripts/calibrate.py` runner: iterates baselines → collects pre-evidence
  → calls `Verifier.verify()` directly → writes structured report
- Extraction of orchestrator's pre-evidence collection into a reusable
  function so harness + production code share one source of truth
- 5 broken + 3 productized seed baselines, each 10-30 files, one defect
  each (broken) or fully productized (clean)
- Aggregate metrics: catch rate, FP rate, pass-on-broken count
- Harness unit tests (no real LLM calls) for outcome classification +
  metric aggregation + report-writing
- Exit-code semantics so the harness is CI-friendly later

**Out (deferred to subsequent sessions):**
- Second-pass false-positive criteria (spec §11 second-pass)
- Broken-then-fixed reclassification criteria (spec §11 third)
- Scaling to 20 broken + 10 productized
- Opus 4.7 parallel run (cost decision, deferred)
- Hub UI surface for calibration reports
- Real-result prompt-tuning iteration (we'll look at v0 results before
  deciding whether to tune)
- Calibration-data growth pipeline (using real production verify runs as
  new baselines, per verify-agent spec §12)

## 3. Directory layout

```
d2p/
├── d2p/
│   └── agents/
│       ├── verifier.py             # (unchanged)
│       └── pre_evidence.py         # NEW (§5 extraction)
├── scripts/
│   └── calibrate.py                # NEW
└── tests/
    ├── calibration/
    │   ├── __init__.py
    │   ├── baselines/
    │   │   ├── broken/
    │   │   │   ├── flask-bad-readme/
    │   │   │   │   ├── app.py
    │   │   │   │   ├── README.md
    │   │   │   │   ├── requirements.txt
    │   │   │   │   └── expected.json
    │   │   │   ├── fastapi-no-error-envelope/...
    │   │   │   ├── node-lib-unpinned-deps/...
    │   │   │   ├── python-cli-no-help/...
    │   │   │   └── empty-tests/...
    │   │   └── productized/
    │   │       ├── flask-clean/...
    │   │       ├── node-cli-clean/...
    │   │       └── python-cli-clean/...
    │   └── reports/                # gitignored, harness outputs land here
    │       └── 2026-05-26-160000/
    │           ├── report.json
    │           └── report.md
    └── test_calibrate.py           # NEW: harness unit tests
```

`tests/calibration/reports/` is gitignored. The harness writes a fresh
timestamped subdir each run; old reports stay until manually pruned.

Baselines live under `tests/calibration/baselines/` (tracked in git) so
they are reproducible across machines and peer-reviewable.

## 4. `expected.json` schema

```json
{
  "name": "flask-bad-readme",
  "kind": "broken",
  "archetype": "python-cli",
  "expected_verdict_in": ["needs_repair", "fail"],
  "expected_categories_any_of": ["readme", "documentation"],
  "notes": "README says `pnpm test`, project is Python — should flag mismatch"
}
```

| Field | Required | Description |
|---|---|---|
| `name` | yes | matches the directory name, used for grouping in reports |
| `kind` | yes | `"broken"` or `"productized"` |
| `archetype` | yes | hint for human reviewers; not asserted against `VerifyResult.detected_archetype` |
| `expected_verdict_in` | yes | list of acceptable `VerifyResult.verdict` values |
| `expected_categories_any_of` | yes | list of lowercase substrings; verifier passes if **any** of `VerifyResult.new_finding_categories[].category` (lowercased) contains **any** substring. Empty list means "do not check categories, only verdict" |
| `notes` | yes | human-readable description of the seeded defect (or for productized baselines, why this one should look clean) |

Match rule for categories is intentionally fuzzy because the verifier may
emit synonyms (`readme_command_mismatch` vs `documentation_inconsistency`)
across runs. Verdict matching is exact.

## 5. Pre-evidence extraction

Current state: `d2p/orchestrator.py` collects pre-evidence
(pytest/pnpm/cargo/go test, mypy/tsc, git diff HEAD~N..HEAD) inline inside
`_run_iteration`. Calibration needs the same logic. Two-fold reasons to
extract rather than duplicate:

1. Single source of truth — if the production pipeline tweaks timeouts or
   adds a runner, calibration picks it up automatically.
2. The verify-agent spec §7 enumerates the exact pre-evidence set; both
   sites should agree.

**Refactor:** lift the logic to `d2p/agents/pre_evidence.py`:

```python
def collect(project_path: Path, *, timeout_seconds: int = 90) -> PreEvidence:
    """Run the pre-evidence command set against project_path and return
    a PreEvidence dataclass. Exit codes: actual code from subprocess;
    124 = timeout; 127 = command missing. Never raises on subprocess
    failure — only on `project_path` not existing or not being a dir."""
```

`d2p/orchestrator.py` swaps its inline block for a single
`pre_evidence.collect(project_path)` call. Existing verifier unit tests
(`tests/test_verifier.py`) already mock `subprocess.run`; they keep
passing without change.

**Calibration baseline edge case:** baseline directories have no `.git`
(git history is just noise for these synthetic projects). The existing
fallback in orchestrator already handles `git diff` with exit 127 — no
new code, just verified to work in this path.

## 6. Harness `scripts/calibrate.py`

### 6.1 CLI

```bash
python scripts/calibrate.py \
    --baselines tests/calibration/baselines \
    --kind broken,productized \
    --model minimax-m2.7-hs \
    --out tests/calibration/reports/2026-05-26-160000/
```

Optional flags:

| Flag | Description |
|---|---|
| `--kind <list>` | Comma-separated subset of `broken,productized`. Default: both. Use `--kind broken` to skip productized baselines when debugging catch logic |
| `--filter <name>` | Run only baselines whose `name` matches (substring); useful for debugging one baseline |
| `--dry-run` | Skip the `Verifier.verify()` call. Still collects pre-evidence + writes per-baseline rows with placeholder verdicts. Use to debug pre-evidence collection without LLM cost |
| `--skip-pre-evidence` | Pass an empty `PreEvidence` to verify. Use to isolate prompt behaviour from pre-evidence content |

### 6.2 Per-baseline loop

For each baseline directory:

1. Read `expected.json`. If missing or invalid → record `outcome="error"`, continue.
2. Run `pre_evidence.collect(baseline_dir)`.
3. Construct the synthetic claim:
   ```python
   VerifyClaim(
       iter_count=3,
       no_more_features=True,
       no_more_bugs=True,
       qa_corpus_green=True,
   )
   ```
   This is the "d2p says done" claim the verifier is designed to
   adversarially examine.
4. Instantiate `Verifier(provider=<model-via-RoleRouter>)` and call
   `verify(claim, pre_evidence, project_path=baseline_dir)`.
5. Classify the result against `expected.json` (§7).
6. Record the full row.

If step 4 raises, record `outcome="error"` with the exception type +
message. Do not abort the rest of the run.

### 6.3 Report row shape

```json
{
  "name": "flask-bad-readme",
  "kind": "broken",
  "expected_verdict_in": ["needs_repair", "fail"],
  "expected_categories_any_of": ["readme", "documentation"],
  "actual_verdict": "needs_repair",
  "actual_categories": ["readme_command_mismatch", "missing_tests"],
  "verdict_match": true,
  "category_match": true,
  "outcome": "catch",
  "elapsed_seconds": 8.3,
  "verify_result": { "...": "full VerifyResult.to_dict()..." }
}
```

### 6.4 Outcome classification

| baseline `kind` | verdict in `expected_verdict_in`? | `outcome` |
|---|---|---|
| broken | yes | `catch` |
| broken | no | `miss` (false negative) |
| productized | yes | `clean_pass` |
| productized | no | `false_alarm` (false positive) |
| any | error during run | `error` (excluded from metrics) |

### 6.5 Aggregate metrics

Computed across non-error rows:

```
catch_rate          = catch         / (catch + miss)
fp_rate             = false_alarm   / (clean_pass + false_alarm)
pass_on_broken      = # of broken baselines with verdict == "pass"
```

§11 single-pass pass criteria:

- `catch_rate ≥ 0.8`
- `fp_rate ≤ 0.2`
- `pass_on_broken == 0`

All three must hold for the harness to exit 0.

### 6.6 How to run

Environment variables required:

```bash
export MINIMAX_API_KEY=<minimax key>     # extracted from ~/Desktop/MINIMAX_KEY.docx in session 8
```

`D2P_VERIFY_ENABLED` is **not** read by the harness — the harness calls
`Verifier.verify()` directly, bypassing the orchestrator's gate. It is
still useful to set when running the production loop on a baseline for
manual cross-checking, but the harness itself ignores it.

Run:

```bash
cd <d2p-repo>
source .venv/bin/activate
python scripts/calibrate.py \
    --baselines tests/calibration/baselines \
    --model minimax-m2.7-hs \
    --out tests/calibration/reports/$(date +%Y%m%d-%H%M%S)/
```

Expected resource usage (rough; will be measured by the first live run):

- 8 baselines × 1 verify call × ~5–15s round-trip ≈ **1–2 min** of LLM time
- Each call: ~3–5k input + ~1–2k output tokens via minimax-m2.7-hs ≈ **$0.05–0.10 total**
- Pre-evidence subprocesses (pytest/vitest/mypy/git diff) per baseline: ~5–30s ≈ **3–5 min** of local CPU time
- Grand total wall-clock: **~5–7 min**

These are estimates from session 8's similar end-to-end runs. The first
live run replaces them with measurements (recorded in
`docs/calibration/2026-05-26-v0-results.md` per §11 commit 3).

### 6.7 Exit codes

| Code | Meaning |
|---|---|
| `0` | All baselines completed and all three §11 single-pass criteria met |
| `1` | All baselines completed but at least one criterion not met |
| `2` | Harness itself errored (≥ 1 baseline classified `error`, or fewer baselines ran than `--baselines` glob found, or model/provider misconfig at startup) |

Future CI hook: a nightly `pytest -m calibration` could shell out to this
script and gate on exit code. Not in v0.

## 7. Report outputs

Written to `--out` directory (default
`tests/calibration/reports/<ISO-timestamp>/`):

### 7.1 `report.json`

```json
{
  "harness_version": "v0",
  "started_at": "2026-05-26T16:00:00Z",
  "elapsed_seconds": 173.4,
  "model": "minimax-m2.7-hs",
  "metrics": {
    "catch_rate": 0.8,
    "fp_rate": 0.0,
    "pass_on_broken": 0,
    "criteria_met": true,
    "total_baselines": 8,
    "errors": 0
  },
  "rows": [ /* §6.3 shape */ ]
}
```

### 7.2 `report.md`

Human-readable summary:

```markdown
# Calibration report · 2026-05-26 16:00:00 UTC

**Model:** minimax-m2.7-hs
**Total baselines:** 8 (5 broken + 3 productized) · errors: 0
**Elapsed:** 2m 53s

## Metrics

| Metric | Value | §11 target | Met? |
|---|---|---|---|
| catch_rate | 0.80 (4/5) | ≥ 0.80 | ✅ |
| fp_rate | 0.00 (0/3) | ≤ 0.20 | ✅ |
| pass_on_broken | 0 | == 0 | ✅ |

**Single-pass criteria met:** ✅

## Per-baseline detail

### broken / flask-bad-readme — catch ✅
- verdict: `needs_repair` (∈ {needs_repair, fail})
- categories matched: `readme_command_mismatch` contains `readme`
- elapsed: 8.3s

### broken / fastapi-no-error-envelope — miss ❌
- verdict: `pass` (expected ∈ {needs_repair, fail})
- categories: none
- elapsed: 7.1s

... (etc)
```

Verifier's own per-call `verify_iter1.json` lands under
`<baseline_dir>/.d2p/run-<ts>/verify_iter1.json` (default Verifier
persistence, verify-agent spec §12). The harness does not duplicate
this — `report.md` per-baseline section links to the path.

## 8. Seed baseline set (5 broken + 3 productized)

### 8.1 Broken

| Name | Archetype | Seeded defect | Expected category substrings |
|---|---|---|---|
| `flask-bad-readme` | python-cli | README documents `pnpm test`; project is Python | `readme`, `documentation` |
| `fastapi-no-error-envelope` | python-api | All routes return 200 OK; no `@app.exception_handler` | `error_envelope`, `error_handling` |
| `node-lib-unpinned-deps` | node-lib | `dependencies: { "react": "*" }` in package.json | `unpinned`, `dependency` |
| `python-cli-no-help` | python-cli | CLI exists but no `argparse --help` | `cli`, `help`, `interface` |
| `empty-tests` | python-cli | `def test_x(): assert True` × 5 | `test`, `assertion`, `anti_gaming` |

### 8.2 Productized

| Name | Archetype | Description |
|---|---|---|
| `flask-clean` | python-api | Small Flask app: routes, `@app.errorhandler` for 404/500, README, `pytest` passing, requirements pinned |
| `node-cli-clean` | node-cli | TypeScript CLI: `--help`, `vitest` passing, strict `tsconfig`, deps pinned |
| `python-cli-clean` | python-cli | argparse CLI: README, `pytest` passing, `mypy` clean, requirements pinned |

The three productized baselines cover spec §7's three pre-evidence test
runners (`pytest`, `vitest`, `pytest+mypy`) so we get signal on whether
the verifier reads pre-evidence output correctly across runner types.

### 8.3 Explicitly NOT in v0

- `docker-runs-dev-server` (needs Docker available for pre-evidence)
- Go / Rust projects (no `cargo`/`go` on dev machine by default)
- Multi-file (>30 files) projects (hand-authoring cost grows fast)

## 9. Harness unit tests

`tests/test_calibrate.py`, no real LLM calls. Targets:

- `classify_outcome()` returns the correct `outcome` for each (kind, verdict-match) combination
- `compute_metrics()` produces correct catch_rate / fp_rate / pass_on_broken given a hand-built list of rows
- `write_report()` writes both `report.json` (valid JSON, expected keys) and `report.md` (contains the three metric lines + per-baseline sections)
- Mocked Verifier returning a `VerifyResult` produces an expected row shape
- A baseline with malformed `expected.json` produces `outcome="error"` and the run continues
- Exit-code derivation: criteria-met → 0; criteria-failed → 1; baseline-error present → 2

4-6 test cases; goal is to lock the contract of harness internals so they
can be refactored safely later.

## 10. Out of scope (for completeness — what comes after v0)

Following the spec §11 ladder:

1. **Second-pass FP** (next session) — extend harness to run verify twice
   on each productized baseline, passing pass-1's result as
   `previous_results`. New metric `second_pass_fp_rate` ≤ 0.1.
2. **Broken-then-fixed reclassification** — for each broken baseline,
   create a parallel `<name>-fixed/` directory with the obvious fix
   applied. Run pass-1 on broken, pass-2 on fixed with pass-1 as context.
   Verify the fixed category is no longer in `repeated_finding_categories`.
3. **Scale up** to the full 20 broken + 10 productized set (spec §11).
4. **Opus 4.7 parallel run** — once minimax results are in, decide
   whether the cost delta to also run Opus is justified.
5. **Prompt-tuning loop** — if catch_rate < 0.8 or fp_rate > 0.2, iterate
   on `SYSTEM_PROMPT` in verifier.py. Harness exists precisely to make
   that loop cheap.
6. **CI integration** — wire harness into a nightly job once exit-code
   contract is stable.

## 11. Commit plan

Three commits when this lands in d2p:

1. `refactor: extract pre_evidence collection into d2p/agents/pre_evidence.py`
   - New file with `collect()` function lifted from orchestrator
   - `orchestrator.py` swapped to call it
   - Existing tests still pass (verifier tests, orchestrator tests)
2. `feat: calibration harness + seed baseline set`
   - `scripts/calibrate.py`
   - `tests/calibration/baselines/{broken,productized}/<8 dirs>/...`
   - `tests/test_calibrate.py`
   - `.gitignore` entry for `tests/calibration/reports/`
3. (After a live run) `docs: 2026-05-26 calibration v0 baseline results`
   - Copy of the generated `report.md` into `docs/calibration/`
   - Brief notes on what we learned (catch rate, surprises)

## 12. Verification plan

- All existing d2p tests (155 currently) must still pass after the
  `pre_evidence.py` refactor
- New `tests/test_calibrate.py` (4-6 cases) green
- One live run of the harness against the 8 seed baselines, producing
  a non-error report. Whether the metrics meet §11 thresholds is data,
  not pass/fail — the v0 deliverable is the harness + the first
  measurement, not "we passed calibration"

## 13. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Hand-authored baselines have artifacts the verifier latches onto (e.g., the README mentions "calibration", spoiling the test) | medium | medium | Review each baseline as if it were a real project; no calibration self-references in baseline content |
| Pre-evidence subprocess hangs on a baseline that imports missing deps | low | low | Existing 90s timeout in orchestrator; harness inherits |
| minimax-m2.7-hs verdict signal differs from Opus enough that v0 results don't generalize | medium | medium | Explicitly flagged; spec calls for Opus parallel run before default-on decision |
| Fuzzy category matching hides actual divergence (e.g., `readme` substring fires on a verifier that's actually flagging something different) | medium | low | `notes` field in expected.json forces author to be explicit; manual review of first run's `report.md` per-baseline section |
| Refactoring pre_evidence out of orchestrator breaks an undocumented path | low | medium | Verifier tests cover orchestrator's `_run_iteration`; run the full test suite before/after extraction |

---

End of design. Ready for user review; on approval, advance to writing-plans.
