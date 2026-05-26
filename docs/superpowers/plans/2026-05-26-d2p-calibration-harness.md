# d2p Verifier calibration harness v0 — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working calibration harness for `d2p/agents/verifier.py` plus 5 broken + 3 productized seed baselines, so we can measure single-pass catch rate / FP rate against the verify-agent spec §11 criteria.

**Architecture:** Three logical pieces. (1) A `pre_evidence.py` module extracted from orchestrator so harness + production share one pre-evidence collector. (2) A `d2p/calibration.py` module with pure functions for outcome classification, metric aggregation, and report writing — testable without LLM calls. (3) A thin `scripts/calibrate.py` CLI that glues router construction + per-baseline run loop on top of (2). Baselines live under `tests/calibration/baselines/{broken,productized}/<name>/`.

**Tech Stack:** Python 3.14, dataclasses, subprocess, argparse. Existing d2p infra: `Verifier`, `Sandbox`, `RoleRouter` / `build_router` / `ProviderSpec`, `PreEvidence`/`VerifyClaim`/`VerifyResult` dataclasses. Test framework: unittest (matches existing `tests/test_verifier.py`).

**Spec:** `docs/superpowers/specs/2026-05-26-d2p-calibration-harness-design.md` (in `Hosico02/demo2project`).

**Implementation repo:** `Hosico02/d2p` at `~/Desktop/Hosico/Works/Work/d2p`. All file paths in this plan are relative to that repo unless noted.

**Final commits (per spec §11):**
1. `refactor: extract pre_evidence collection into d2p/agents/pre_evidence.py` (Phase 1)
2. `feat: calibration harness + seed baseline set` (Phases 2-3)
3. `docs: 2026-05-26 calibration v0 baseline results` (Phase 4, after live run)

---

## File map

**New files:**

- `d2p/agents/pre_evidence.py` — pre-evidence collector lifted from orchestrator
- `d2p/calibration.py` — pure-logic harness module (importable from tests + scripts/calibrate.py)
- `scripts/calibrate.py` — thin CLI wrapper invoking `d2p.calibration.main(argv)`
- `tests/test_pre_evidence.py` — direct tests for the extracted collector
- `tests/test_calibrate.py` — unit tests for harness logic (no real LLM)
- `tests/calibration/__init__.py` — empty (so pytest discovers baselines dir? actually no — baselines aren't test modules. But the dir needs to exist; no __init__ required. Skip this file)
- `tests/calibration/baselines/broken/flask-bad-readme/{app.py, README.md, requirements.txt, expected.json}`
- `tests/calibration/baselines/broken/fastapi-no-error-envelope/{main.py, README.md, requirements.txt, expected.json}`
- `tests/calibration/baselines/broken/node-lib-unpinned-deps/{src/index.ts, package.json, README.md, expected.json}`
- `tests/calibration/baselines/broken/python-cli-no-help/{cli.py, README.md, requirements.txt, expected.json}`
- `tests/calibration/baselines/broken/empty-tests/{src/lib.py, tests/test_lib.py, README.md, requirements.txt, expected.json}`
- `tests/calibration/baselines/productized/flask-clean/{app.py, tests/test_app.py, README.md, requirements.txt, expected.json}`
- `tests/calibration/baselines/productized/node-cli-clean/{src/index.ts, tests/index.test.ts, package.json, tsconfig.json, README.md, expected.json}`
- `tests/calibration/baselines/productized/python-cli-clean/{cli.py, tests/test_cli.py, README.md, requirements.txt, expected.json}`

**Modified files:**

- `d2p/orchestrator.py:789-861` — delete `_collect_pre_evidence` and `_run_cmd` methods; call site at line 646 now imports `from d2p.agents.pre_evidence import collect` and uses `collect(self.sandbox, iter_count=it)`.
- `tests/test_verifier.py:366-...` (the `TestPreEvidenceCollection` class) — repointed to test the new module (or removed; the equivalent coverage moves to `tests/test_pre_evidence.py`).
- `.gitignore` — add `tests/calibration/reports/`.

---

## Phase 1 · Extract pre_evidence module

Goal: lift inline pre-evidence collection out of `orchestrator.py` into a standalone module, keeping the full 155-test suite green. This refactor is mechanical — no behaviour change.

### Task 1.1: Write failing test for pre_evidence.collect() — happy path

**Files:**
- Create: `tests/test_pre_evidence.py`

- [ ] **Step 1: Write the test**

```python
"""Direct tests for the extracted pre-evidence collector.
These tests do NOT depend on orchestrator.py — they verify that
`collect()` shells out to the right commands given a sandbox layout
and bundles the result into PreEvidence."""
from __future__ import annotations

import unittest
from pathlib import Path
from unittest import mock

from d2p.agents.pre_evidence import collect
from d2p.agents.verifier import PreEvidence
from d2p.fs import Sandbox


class TestCollectPreEvidence(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = Path(self.id().replace(".", "_"))
        self.tmpdir.mkdir(exist_ok=True)
        self.addCleanup(self._cleanup)

    def _cleanup(self) -> None:
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_collect_returns_empty_pre_evidence_when_no_runners_present(self) -> None:
        # No marker files → no test/build/typecheck commands. Empty PreEvidence.
        sandbox = Sandbox(self.tmpdir)
        with mock.patch("d2p.agents.pre_evidence.shutil.which", return_value=None):
            evidence = collect(sandbox, iter_count=1)
        self.assertIsInstance(evidence, PreEvidence)
        self.assertEqual(evidence.test_output, "")
        self.assertIsNone(evidence.test_exit_code)
        self.assertIsNone(evidence.build_exit_code)
        self.assertIsNone(evidence.typecheck_exit_code)
        self.assertEqual(evidence.git_diff_recent, "")
```

- [ ] **Step 2: Run test to verify it fails (module does not yet exist)**

Run: `cd ~/Desktop/Hosico/Works/Work/d2p && source .venv/bin/activate && pytest tests/test_pre_evidence.py -v`
Expected: `ModuleNotFoundError: No module named 'd2p.agents.pre_evidence'`

### Task 1.2: Create pre_evidence.py — minimal collect() to pass first test

**Files:**
- Create: `d2p/agents/pre_evidence.py`

- [ ] **Step 1: Write the module**

```python
"""Pre-pulled execution evidence collector for the Verifier.

Lifted out of orchestrator.py so the calibration harness can call
this directly without the orchestrator's iteration loop. Verify spec
§7 defines the fixed evidence set; this module implements collection
against an arbitrary sandbox directory.

Verifier never invokes commands itself — this module does, and bundles
output into PreEvidence."""
from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path
from typing import Optional

from d2p.agents.verifier import PreEvidence
from d2p.fs import Sandbox

DEFAULT_TIMEOUT_S = 90


def collect(sandbox: Sandbox, *, iter_count: int = 1,
            timeout_seconds: int = DEFAULT_TIMEOUT_S) -> PreEvidence:
    """Run tests / build / typecheck / git-diff against the sandbox root
    and bundle outputs into a PreEvidence record.

    Args:
        sandbox: Sandbox rooted at the project directory.
        iter_count: How many commits back to walk for git diff (HEAD~N..HEAD).
                    Falls back to HEAD-diff if history is shorter.
        timeout_seconds: Per-command hard timeout.

    Returns:
        PreEvidence with whichever runners were detected and executed.
        Missing runners → exit_code 127; timeouts → 124."""
    root = str(sandbox.root)
    listing = set(sandbox.listing(max_entries=400))
    is_python = ("pyproject.toml" in listing or "setup.py" in listing
                 or "requirements.txt" in listing
                 or any(p.endswith(".py") for p in listing))
    is_node = "package.json" in listing
    is_rust = "Cargo.toml" in listing
    is_go = "go.mod" in listing

    evidence = PreEvidence()

    # Tests
    test_cmd = None
    if is_python and shutil.which("pytest"):
        test_cmd = ["pytest", "-q", "--maxfail=20"]
    elif is_node:
        mgr = "pnpm" if "pnpm-lock.yaml" in listing else "npm"
        if shutil.which(mgr):
            test_cmd = [mgr, "test", "--silent"] if mgr == "npm" else [mgr, "test"]
    elif is_rust and shutil.which("cargo"):
        test_cmd = ["cargo", "test", "--quiet"]
    elif is_go and shutil.which("go"):
        test_cmd = ["go", "test", "./..."]
    if test_cmd:
        evidence.test_output, evidence.test_exit_code = _run_cmd(
            test_cmd, cwd=root, timeout_seconds=timeout_seconds)

    # Build
    build_cmd = None
    if is_node and shutil.which("pnpm" if "pnpm-lock.yaml" in listing else "npm"):
        mgr = "pnpm" if "pnpm-lock.yaml" in listing else "npm"
        pkg_txt = sandbox.read("package.json")
        if pkg_txt and '"build"' in pkg_txt:
            build_cmd = [mgr, "run", "build"]
    elif is_rust and shutil.which("cargo"):
        build_cmd = ["cargo", "build", "--quiet"]
    elif is_go and shutil.which("go"):
        build_cmd = ["go", "build", "./..."]
    if build_cmd:
        evidence.build_output, evidence.build_exit_code = _run_cmd(
            build_cmd, cwd=root, timeout_seconds=timeout_seconds)

    # Typecheck
    typecheck_cmd = None
    if is_python and shutil.which("mypy"):
        typecheck_cmd = ["mypy", "--ignore-missing-imports",
                         "--no-error-summary", "."]
    elif is_node and "tsconfig.json" in listing:
        mgr = "pnpm" if "pnpm-lock.yaml" in listing else "npx"
        if shutil.which(mgr):
            typecheck_cmd = [mgr, "tsc", "--noEmit"]
    if typecheck_cmd:
        evidence.typecheck_output, evidence.typecheck_exit_code = _run_cmd(
            typecheck_cmd, cwd=root, timeout_seconds=timeout_seconds)

    # Git diff: only meaningful if target is a git repo.
    if (Path(root) / ".git").is_dir() and shutil.which("git"):
        n = max(1, iter_count)
        out, code = _run_cmd(
            ["git", "diff", f"HEAD~{n}..HEAD"], cwd=root,
            timeout_seconds=timeout_seconds)
        if code != 0:
            out, _ = _run_cmd(["git", "diff", "HEAD"], cwd=root,
                              timeout_seconds=timeout_seconds)
        evidence.git_diff_recent = out

    return evidence


def _run_cmd(cmd: list[str], *, cwd: str,
             timeout_seconds: int) -> tuple[str, int]:
    """Run a command with a hard timeout. Returns (combined_output, exit_code).
    Exit code 124 = timeout (matching timeout(1)); 127 = command not found.
    Never raises — the verifier needs to see whatever happened."""
    try:
        p = subprocess.run(
            cmd, cwd=cwd, capture_output=True, text=True,
            timeout=timeout_seconds,
            env={**os.environ, "PYTHONUNBUFFERED": "1"},
        )
        return ((p.stdout + ("\n" + p.stderr if p.stderr else "")).rstrip(),
                int(p.returncode))
    except subprocess.TimeoutExpired as e:
        return (f"<timed out after {timeout_seconds}s: "
                f"{' '.join(cmd)}>\n{(e.stdout or b'').decode(errors='replace')}",
                124)
    except FileNotFoundError:
        return (f"<command not found: {cmd[0]}>", 127)
    except Exception as e:
        return (f"<unexpected error running {cmd!r}: "
                f"{type(e).__name__}: {e}>", 1)
```

- [ ] **Step 2: Run the happy-path test to verify it passes**

Run: `pytest tests/test_pre_evidence.py::TestCollectPreEvidence::test_collect_returns_empty_pre_evidence_when_no_runners_present -v`
Expected: PASS

### Task 1.3: Add more pre_evidence tests for runner detection + git diff fallback

**Files:**
- Modify: `tests/test_pre_evidence.py`

- [ ] **Step 1: Add three more tests**

Append to `TestCollectPreEvidence` class:

```python
    def test_collect_invokes_pytest_when_requirements_present(self) -> None:
        (self.tmpdir / "requirements.txt").write_text("flask\n")
        sandbox = Sandbox(self.tmpdir)
        with mock.patch("d2p.agents.pre_evidence.shutil.which",
                        side_effect=lambda c: "/usr/bin/" + c if c == "pytest" else None):
            with mock.patch("d2p.agents.pre_evidence.subprocess.run") as runner:
                runner.return_value = mock.Mock(
                    stdout="5 passed\n", stderr="", returncode=0)
                evidence = collect(sandbox, iter_count=1)
        runner.assert_called_once()
        invoked_cmd = runner.call_args.args[0]
        self.assertEqual(invoked_cmd[0], "pytest")
        self.assertEqual(evidence.test_exit_code, 0)
        self.assertIn("5 passed", evidence.test_output)

    def test_collect_records_127_when_runner_missing(self) -> None:
        (self.tmpdir / "package.json").write_text('{"name":"x"}\n')
        sandbox = Sandbox(self.tmpdir)
        # npm is detected via shutil.which; mock it absent.
        with mock.patch("d2p.agents.pre_evidence.shutil.which", return_value=None):
            evidence = collect(sandbox, iter_count=1)
        # No runners → no commands attempted → test_output stays ""
        self.assertEqual(evidence.test_output, "")
        self.assertIsNone(evidence.test_exit_code)

    def test_collect_falls_back_to_head_diff_when_history_shorter(self) -> None:
        (self.tmpdir / ".git").mkdir()
        sandbox = Sandbox(self.tmpdir)
        responses = [
            mock.Mock(stdout="", stderr="fatal: bad revision", returncode=128),
            mock.Mock(stdout="diff --git a/x b/x\n+y", stderr="", returncode=0),
        ]
        with mock.patch("d2p.agents.pre_evidence.shutil.which",
                        side_effect=lambda c: "/usr/bin/" + c if c == "git" else None):
            with mock.patch("d2p.agents.pre_evidence.subprocess.run",
                            side_effect=responses) as runner:
                evidence = collect(sandbox, iter_count=5)
        self.assertEqual(runner.call_count, 2)
        first_call_cmd = runner.call_args_list[0].args[0]
        second_call_cmd = runner.call_args_list[1].args[0]
        self.assertEqual(first_call_cmd, ["git", "diff", "HEAD~5..HEAD"])
        self.assertEqual(second_call_cmd, ["git", "diff", "HEAD"])
        self.assertIn("diff --git", evidence.git_diff_recent)
```

- [ ] **Step 2: Run all pre_evidence tests**

Run: `pytest tests/test_pre_evidence.py -v`
Expected: 4 PASS

### Task 1.4: Wire orchestrator to use pre_evidence.collect()

**Files:**
- Modify: `d2p/orchestrator.py:646` and `d2p/orchestrator.py:789-885`

- [ ] **Step 1: Update import block at top of orchestrator.py**

Find the existing import section (top of file). Add:

```python
from .agents.pre_evidence import collect as collect_pre_evidence
```

- [ ] **Step 2: Replace the call site at line 646**

Find:

```python
                pre_evidence = self._collect_pre_evidence(iter_count=it)
```

Replace with:

```python
                pre_evidence = collect_pre_evidence(self.sandbox, iter_count=it)
```

- [ ] **Step 3: Delete the now-unused methods**

Delete `_collect_pre_evidence` (lines 789-861) and `_run_cmd` (lines 863-885) from `orchestrator.py`. Also remove the now-unused `shutil` import if it's only referenced by these methods (grep first: `grep -n "shutil" d2p/orchestrator.py`).

If `shutil` is referenced elsewhere, leave the import alone. Same check for `subprocess`.

Also remove the constant `_PRE_EVIDENCE_TIMEOUT_S` if it lived on the class and is no longer referenced. Grep before deleting: `grep -n "_PRE_EVIDENCE_TIMEOUT_S" d2p/`.

- [ ] **Step 4: Update the existing TestPreEvidenceCollection tests in test_verifier.py to patch the new module path**

Open `tests/test_verifier.py`. Find every `mock.patch("d2p.orchestrator.subprocess.run", ...)` and `mock.patch("d2p.orchestrator.shutil.which", ...)` inside the `TestPreEvidenceCollection` class (around line 366) and repoint to `d2p.agents.pre_evidence.subprocess.run` / `d2p.agents.pre_evidence.shutil.which`.

Replace any `self.orch._collect_pre_evidence(iter_count=N)` calls with:

```python
from d2p.agents.pre_evidence import collect
collect(self.orch.sandbox, iter_count=N)
```

If `TestPreEvidenceCollection` becomes redundant after this (i.e., it just exercises `collect()` through the orchestrator instance), consider moving the whole class to `tests/test_pre_evidence.py`. Acceptable to leave in place for this commit — the refactor's goal is mechanical, not test reorganization.

### Task 1.5: Run the full test suite

- [ ] **Step 1: Run all d2p tests**

Run: `pytest -q`
Expected: 155 + 4 new pre_evidence tests = **159 PASS** (no regressions).

If anything fails: investigate before continuing. A common failure mode here is the orchestrator still referencing `self._collect_pre_evidence` somewhere else — grep `grep -n "_collect_pre_evidence" d2p/` to confirm no callers remain.

### Task 1.6: Commit the refactor

- [ ] **Step 1: Verify nothing else changed and stage**

```bash
git status
git diff --stat
git add d2p/agents/pre_evidence.py d2p/orchestrator.py tests/test_pre_evidence.py tests/test_verifier.py
```

- [ ] **Step 2: Commit**

```bash
git commit -m "$(cat <<'EOF'
refactor: extract pre_evidence collection into d2p/agents/pre_evidence.py

Lifts the pre-evidence collector (pytest/pnpm/cargo/go test,
mypy/tsc, git diff) out of orchestrator's `_collect_pre_evidence`
into a standalone module so the calibration harness can call it
without the orchestrator's iteration loop.

No behaviour change. Existing TestPreEvidenceCollection tests
repointed to the new module path. 4 new direct tests cover empty
runners, pytest invocation, missing-runner 127, and git-diff HEAD
fallback.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2 · Calibration harness module + CLI

Goal: write `d2p/calibration.py` (pure logic + the run loop) and `scripts/calibrate.py` (thin CLI), with `tests/test_calibrate.py` exercising the pure logic. No commit yet — Phase 3 adds baselines and we commit at the end of Phase 3 as the spec §11 commit 2.

### Task 2.1: Create calibration.py skeleton with dataclasses

**Files:**
- Create: `d2p/calibration.py`

- [ ] **Step 1: Write the module skeleton**

```python
"""Calibration harness for the d2p Verifier.

See docs/superpowers/specs/2026-05-26-d2p-calibration-harness-design.md
in the demo2project repo for the design rationale.

Pure-logic functions (classify_outcome, compute_metrics, match_categories,
load_baseline_meta) are testable without LLM calls. run_baseline() and
main() integrate with the live Verifier."""
from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any, Optional


# Outcome enum values
OUTCOME_CATCH = "catch"
OUTCOME_MISS = "miss"
OUTCOME_CLEAN_PASS = "clean_pass"
OUTCOME_FALSE_ALARM = "false_alarm"
OUTCOME_ERROR = "error"


@dataclass
class Metrics:
    catch_rate: float            # catch / (catch + miss); 0.0 if denominator 0
    fp_rate: float               # false_alarm / (clean_pass + false_alarm); 0.0 if denominator 0
    pass_on_broken: int          # # of broken baselines with verdict == "pass"
    criteria_met: bool           # catch >= 0.8 AND fp <= 0.2 AND pass_on_broken == 0
    total_baselines: int
    errors: int                  # # of rows with outcome == "error"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
```

- [ ] **Step 2: Confirm imports resolve**

Run: `python -c "from d2p.calibration import Metrics; print(Metrics)"`
Expected: prints `<class 'd2p.calibration.Metrics'>`.

### Task 2.2: Test for classify_outcome()

**Files:**
- Create: `tests/test_calibrate.py`

- [ ] **Step 1: Write failing tests**

```python
"""Unit tests for the calibration harness. No real LLM calls — all
Verifier interactions are mocked."""
from __future__ import annotations

import json
import unittest
from pathlib import Path
from unittest import mock

from d2p.calibration import (
    Metrics,
    classify_outcome,
    compute_metrics,
    match_categories,
    load_baseline_meta,
    OUTCOME_CATCH, OUTCOME_MISS, OUTCOME_CLEAN_PASS,
    OUTCOME_FALSE_ALARM, OUTCOME_ERROR,
)


class TestClassifyOutcome(unittest.TestCase):
    def test_broken_verdict_in_expected_set_is_catch(self) -> None:
        outcome = classify_outcome(
            kind="broken", verdict="needs_repair",
            expected_verdict_in=["needs_repair", "fail"])
        self.assertEqual(outcome, OUTCOME_CATCH)

    def test_broken_verdict_not_in_expected_set_is_miss(self) -> None:
        outcome = classify_outcome(
            kind="broken", verdict="pass",
            expected_verdict_in=["needs_repair", "fail"])
        self.assertEqual(outcome, OUTCOME_MISS)

    def test_productized_verdict_in_expected_set_is_clean_pass(self) -> None:
        outcome = classify_outcome(
            kind="productized", verdict="pass",
            expected_verdict_in=["pass", "no_new_findings"])
        self.assertEqual(outcome, OUTCOME_CLEAN_PASS)

    def test_productized_verdict_not_in_expected_set_is_false_alarm(self) -> None:
        outcome = classify_outcome(
            kind="productized", verdict="needs_repair",
            expected_verdict_in=["pass", "no_new_findings"])
        self.assertEqual(outcome, OUTCOME_FALSE_ALARM)

    def test_unknown_kind_returns_error(self) -> None:
        outcome = classify_outcome(
            kind="something_weird", verdict="pass",
            expected_verdict_in=["pass"])
        self.assertEqual(outcome, OUTCOME_ERROR)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/test_calibrate.py -v`
Expected: `ImportError: cannot import name 'classify_outcome' from 'd2p.calibration'`.

### Task 2.3: Implement classify_outcome()

**Files:**
- Modify: `d2p/calibration.py`

- [ ] **Step 1: Append function**

```python
def classify_outcome(*, kind: str, verdict: str,
                     expected_verdict_in: list[str]) -> str:
    """Determine outcome bucket for a baseline row.
    Returns one of OUTCOME_* constants. Unknown kind -> OUTCOME_ERROR
    so callers see misconfigured expected.json files clearly."""
    in_expected = verdict in expected_verdict_in
    if kind == "broken":
        return OUTCOME_CATCH if in_expected else OUTCOME_MISS
    if kind == "productized":
        return OUTCOME_CLEAN_PASS if in_expected else OUTCOME_FALSE_ALARM
    return OUTCOME_ERROR
```

- [ ] **Step 2: Run tests**

Run: `pytest tests/test_calibrate.py::TestClassifyOutcome -v`
Expected: 5 PASS.

### Task 2.4: Test + implement match_categories()

**Files:**
- Modify: `tests/test_calibrate.py`, `d2p/calibration.py`

- [ ] **Step 1: Append test class to tests/test_calibrate.py**

```python
class TestMatchCategories(unittest.TestCase):
    def test_empty_expected_returns_none_skip(self) -> None:
        # Empty list means "don't check categories" -> match is None.
        self.assertIsNone(match_categories(
            actual=["readme_command_mismatch"], expected_substrings=[]))

    def test_substring_match_is_case_insensitive(self) -> None:
        self.assertTrue(match_categories(
            actual=["README_Command_Mismatch"],
            expected_substrings=["readme"]))

    def test_no_substring_overlap_is_false(self) -> None:
        self.assertFalse(match_categories(
            actual=["missing_tests"],
            expected_substrings=["readme", "documentation"]))

    def test_any_actual_matching_any_substring_passes(self) -> None:
        self.assertTrue(match_categories(
            actual=["missing_tests", "readme_command_mismatch"],
            expected_substrings=["readme"]))

    def test_no_actual_categories_with_non_empty_expected_is_false(self) -> None:
        self.assertFalse(match_categories(
            actual=[], expected_substrings=["readme"]))
```

- [ ] **Step 2: Append function to d2p/calibration.py**

```python
def match_categories(*, actual: list[str],
                     expected_substrings: list[str]) -> Optional[bool]:
    """Soft substring match: any actual category contains any expected
    substring (case-insensitive). Empty expected_substrings -> None
    (caller treats as "skip", not as failure)."""
    if not expected_substrings:
        return None
    actual_lc = [c.lower() for c in actual]
    expected_lc = [s.lower() for s in expected_substrings]
    return any(any(sub in cat for sub in expected_lc) for cat in actual_lc)
```

- [ ] **Step 3: Run**

Run: `pytest tests/test_calibrate.py::TestMatchCategories -v`
Expected: 5 PASS.

### Task 2.5: Test + implement compute_metrics()

**Files:**
- Modify: `tests/test_calibrate.py`, `d2p/calibration.py`

- [ ] **Step 1: Append test class**

```python
class TestComputeMetrics(unittest.TestCase):
    def _row(self, kind: str, outcome: str) -> dict:
        return {"kind": kind, "outcome": outcome, "actual_verdict": "pass"
                if outcome in (OUTCOME_MISS, OUTCOME_CLEAN_PASS)
                else "needs_repair"}

    def test_all_catches_and_clean_passes_meets_criteria(self) -> None:
        rows = [
            self._row("broken", OUTCOME_CATCH),
            self._row("broken", OUTCOME_CATCH),
            self._row("productized", OUTCOME_CLEAN_PASS),
        ]
        m = compute_metrics(rows)
        self.assertEqual(m.catch_rate, 1.0)
        self.assertEqual(m.fp_rate, 0.0)
        self.assertEqual(m.pass_on_broken, 0)
        self.assertTrue(m.criteria_met)
        self.assertEqual(m.total_baselines, 3)
        self.assertEqual(m.errors, 0)

    def test_catch_rate_below_threshold_fails_criteria(self) -> None:
        rows = [
            self._row("broken", OUTCOME_CATCH),
            self._row("broken", OUTCOME_MISS),
            self._row("broken", OUTCOME_MISS),
            self._row("productized", OUTCOME_CLEAN_PASS),
        ]
        m = compute_metrics(rows)
        self.assertAlmostEqual(m.catch_rate, 1/3, places=3)
        self.assertFalse(m.criteria_met)

    def test_false_alarm_above_threshold_fails_criteria(self) -> None:
        rows = [
            self._row("broken", OUTCOME_CATCH),
            self._row("productized", OUTCOME_FALSE_ALARM),
            self._row("productized", OUTCOME_FALSE_ALARM),
            self._row("productized", OUTCOME_CLEAN_PASS),
        ]
        m = compute_metrics(rows)
        self.assertAlmostEqual(m.fp_rate, 2/3, places=3)
        self.assertFalse(m.criteria_met)

    def test_pass_verdict_on_broken_is_hard_fail(self) -> None:
        # MISS with verdict "pass" specifically is pass_on_broken,
        # which is criteria-failing even if other metrics are ok.
        rows = [
            {"kind": "broken", "outcome": OUTCOME_MISS, "actual_verdict": "pass"},
            self._row("broken", OUTCOME_CATCH),
            self._row("broken", OUTCOME_CATCH),
            self._row("broken", OUTCOME_CATCH),
            self._row("broken", OUTCOME_CATCH),
            self._row("productized", OUTCOME_CLEAN_PASS),
        ]
        m = compute_metrics(rows)
        self.assertEqual(m.pass_on_broken, 1)
        self.assertFalse(m.criteria_met)

    def test_errors_excluded_from_rate_denominators(self) -> None:
        rows = [
            self._row("broken", OUTCOME_CATCH),
            {"kind": "broken", "outcome": OUTCOME_ERROR, "actual_verdict": ""},
            self._row("productized", OUTCOME_CLEAN_PASS),
        ]
        m = compute_metrics(rows)
        self.assertEqual(m.catch_rate, 1.0)
        self.assertEqual(m.fp_rate, 0.0)
        self.assertEqual(m.errors, 1)
        self.assertEqual(m.total_baselines, 3)
```

- [ ] **Step 2: Append function to d2p/calibration.py**

```python
CATCH_THRESHOLD = 0.8
FP_THRESHOLD = 0.2


def compute_metrics(rows: list[dict]) -> Metrics:
    """Aggregate outcome rows into Metrics. Rows with outcome OUTCOME_ERROR
    are counted in total/errors but excluded from rate denominators."""
    catch = sum(1 for r in rows if r["outcome"] == OUTCOME_CATCH)
    miss = sum(1 for r in rows if r["outcome"] == OUTCOME_MISS)
    clean = sum(1 for r in rows if r["outcome"] == OUTCOME_CLEAN_PASS)
    false_alarm = sum(1 for r in rows if r["outcome"] == OUTCOME_FALSE_ALARM)
    errors = sum(1 for r in rows if r["outcome"] == OUTCOME_ERROR)

    broken_denom = catch + miss
    prod_denom = clean + false_alarm
    catch_rate = catch / broken_denom if broken_denom else 0.0
    fp_rate = false_alarm / prod_denom if prod_denom else 0.0

    pass_on_broken = sum(
        1 for r in rows
        if r["kind"] == "broken" and r.get("actual_verdict") == "pass"
    )

    criteria_met = (catch_rate >= CATCH_THRESHOLD
                    and fp_rate <= FP_THRESHOLD
                    and pass_on_broken == 0)

    return Metrics(
        catch_rate=catch_rate, fp_rate=fp_rate,
        pass_on_broken=pass_on_broken, criteria_met=criteria_met,
        total_baselines=len(rows), errors=errors,
    )
```

- [ ] **Step 3: Run**

Run: `pytest tests/test_calibrate.py::TestComputeMetrics -v`
Expected: 5 PASS.

### Task 2.6: Test + implement load_baseline_meta()

**Files:**
- Modify: `tests/test_calibrate.py`, `d2p/calibration.py`

- [ ] **Step 1: Append test class**

```python
class TestLoadBaselineMeta(unittest.TestCase):
    def setUp(self) -> None:
        import tempfile
        self.tmpdir = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: __import__("shutil").rmtree(self.tmpdir,
                                                            ignore_errors=True))

    def test_valid_expected_json_loads(self) -> None:
        baseline = self.tmpdir / "x"
        baseline.mkdir()
        (baseline / "expected.json").write_text(json.dumps({
            "name": "x", "kind": "broken", "archetype": "python-cli",
            "expected_verdict_in": ["needs_repair"],
            "expected_categories_any_of": ["readme"],
            "notes": "n",
        }))
        meta = load_baseline_meta(baseline)
        self.assertEqual(meta["kind"], "broken")
        self.assertEqual(meta["expected_verdict_in"], ["needs_repair"])

    def test_missing_expected_json_raises(self) -> None:
        baseline = self.tmpdir / "y"
        baseline.mkdir()
        with self.assertRaises(FileNotFoundError):
            load_baseline_meta(baseline)

    def test_missing_required_field_raises_value_error(self) -> None:
        baseline = self.tmpdir / "z"
        baseline.mkdir()
        (baseline / "expected.json").write_text(json.dumps({
            "name": "z", "kind": "broken",  # missing required fields
        }))
        with self.assertRaises(ValueError) as ctx:
            load_baseline_meta(baseline)
        self.assertIn("required", str(ctx.exception).lower())
```

- [ ] **Step 2: Append function**

```python
_REQUIRED_META_FIELDS = (
    "name", "kind", "archetype",
    "expected_verdict_in", "expected_categories_any_of", "notes",
)


def load_baseline_meta(baseline_dir: Path) -> dict:
    """Read and validate expected.json. Raises FileNotFoundError if absent,
    ValueError if required fields missing."""
    f = baseline_dir / "expected.json"
    if not f.is_file():
        raise FileNotFoundError(f"missing expected.json in {baseline_dir}")
    meta = json.loads(f.read_text())
    missing = [k for k in _REQUIRED_META_FIELDS if k not in meta]
    if missing:
        raise ValueError(f"{f}: required fields missing: {missing}")
    if meta["kind"] not in ("broken", "productized"):
        raise ValueError(f"{f}: kind must be broken|productized, got {meta['kind']!r}")
    return meta
```

- [ ] **Step 3: Run**

Run: `pytest tests/test_calibrate.py::TestLoadBaselineMeta -v`
Expected: 3 PASS.

### Task 2.7: Test + implement run_baseline() with mocked Verifier

**Files:**
- Modify: `tests/test_calibrate.py`, `d2p/calibration.py`

- [ ] **Step 1: Append test class**

```python
class TestRunBaseline(unittest.TestCase):
    def setUp(self) -> None:
        import tempfile
        self.tmpdir = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: __import__("shutil").rmtree(self.tmpdir,
                                                            ignore_errors=True))

    def _baseline(self, name: str, kind: str, expected_in: list[str],
                  expected_subs: list[str]) -> Path:
        b = self.tmpdir / name
        b.mkdir()
        (b / "expected.json").write_text(json.dumps({
            "name": name, "kind": kind, "archetype": "python-cli",
            "expected_verdict_in": expected_in,
            "expected_categories_any_of": expected_subs,
            "notes": "test",
        }))
        return b

    def test_run_baseline_produces_catch_row_when_verifier_reports_needs_repair(self) -> None:
        from d2p.calibration import run_baseline
        baseline = self._baseline("flask-bad-readme", "broken",
                                  ["needs_repair", "fail"], ["readme"])
        mock_verifier = mock.Mock()
        mock_result = mock.Mock()
        mock_result.verdict = "needs_repair"
        mock_result.new_finding_categories = [
            mock.Mock(category="readme_command_mismatch"),
        ]
        mock_result.to_dict.return_value = {"verdict": "needs_repair"}
        mock_verifier.verify.return_value = mock_result
        verifier_factory = mock.Mock(return_value=mock_verifier)

        with mock.patch("d2p.calibration.collect_pre_evidence") as cpe:
            cpe.return_value = mock.Mock(to_dict=lambda: {})
            row = run_baseline(baseline, verifier_factory)

        verifier_factory.assert_called_once_with(baseline)
        # Verifier.verify takes (claim, pre_evidence) positionally; no project_path kwarg
        called_args = mock_verifier.verify.call_args
        self.assertEqual(len(called_args.args), 2)
        self.assertEqual(row["name"], "flask-bad-readme")
        self.assertEqual(row["outcome"], OUTCOME_CATCH)
        self.assertEqual(row["actual_verdict"], "needs_repair")
        self.assertTrue(row["verdict_match"])
        self.assertTrue(row["category_match"])

    def test_run_baseline_records_error_when_verify_raises(self) -> None:
        from d2p.calibration import run_baseline
        baseline = self._baseline("flask-bad-readme", "broken",
                                  ["needs_repair", "fail"], ["readme"])
        mock_verifier = mock.Mock()
        mock_verifier.verify.side_effect = RuntimeError("api down")
        verifier_factory = mock.Mock(return_value=mock_verifier)
        with mock.patch("d2p.calibration.collect_pre_evidence") as cpe:
            cpe.return_value = mock.Mock(to_dict=lambda: {})
            row = run_baseline(baseline, verifier_factory)
        self.assertEqual(row["outcome"], OUTCOME_ERROR)
        self.assertIn("api down", row.get("error", ""))

    def test_run_baseline_dry_run_skips_verifier_factory(self) -> None:
        from d2p.calibration import run_baseline
        baseline = self._baseline("x", "broken", ["needs_repair"], [])
        verifier_factory = mock.Mock()
        with mock.patch("d2p.calibration.collect_pre_evidence") as cpe:
            cpe.return_value = mock.Mock(to_dict=lambda: {})
            row = run_baseline(baseline, verifier_factory, dry_run=True)
        verifier_factory.assert_not_called()
        self.assertEqual(row["actual_verdict"], "<dry-run>")
        self.assertEqual(row["outcome"], OUTCOME_ERROR)  # dry-run can't be classified
```

- [ ] **Step 2: Append imports + function to d2p/calibration.py**

Add at the top of d2p/calibration.py (after existing imports):

```python
from d2p.agents.pre_evidence import collect as collect_pre_evidence
from d2p.agents.verifier import VerifyClaim, PreEvidence
from d2p.fs import Sandbox
```

Then append the function:

```python
def run_baseline(baseline_dir: Path, verifier_factory, *,
                 dry_run: bool = False,
                 skip_pre_evidence: bool = False) -> dict:
    """Execute one baseline: load meta, collect pre-evidence, build a
    fresh Verifier via `verifier_factory(baseline_dir)`, call verify,
    classify outcome, build row dict. Catches verify exceptions and
    records them as OUTCOME_ERROR rows instead of propagating.

    `verifier_factory` is a callable `(Path) -> Verifier`. The
    Verifier needs a Sandbox rooted at `baseline_dir`, so we cannot
    reuse a single Verifier across baselines — but `verifier_factory`
    can close over a shared router so provider construction is paid
    once."""
    started = time.monotonic()
    try:
        meta = load_baseline_meta(baseline_dir)
    except (FileNotFoundError, ValueError) as e:
        return {
            "name": baseline_dir.name, "kind": "unknown",
            "expected_verdict_in": [], "expected_categories_any_of": [],
            "actual_verdict": "", "actual_categories": [],
            "verdict_match": False, "category_match": None,
            "outcome": OUTCOME_ERROR, "elapsed_seconds": 0.0,
            "verify_result": {}, "error": f"{type(e).__name__}: {e}",
        }

    sandbox = Sandbox(baseline_dir)
    if skip_pre_evidence:
        pre_evidence = PreEvidence()
    else:
        pre_evidence = collect_pre_evidence(sandbox, iter_count=1)

    if dry_run:
        return {
            "name": meta["name"], "kind": meta["kind"],
            "expected_verdict_in": meta["expected_verdict_in"],
            "expected_categories_any_of": meta["expected_categories_any_of"],
            "actual_verdict": "<dry-run>", "actual_categories": [],
            "verdict_match": False, "category_match": None,
            "outcome": OUTCOME_ERROR,
            "elapsed_seconds": time.monotonic() - started,
            "verify_result": {"pre_evidence": pre_evidence.to_dict()},
        }

    claim = VerifyClaim(iter_count=3, no_more_features=True,
                        no_more_bugs=True, qa_corpus_green=True)
    try:
        verifier = verifier_factory(baseline_dir)
        result = verifier.verify(claim, pre_evidence)
    except Exception as e:
        return {
            "name": meta["name"], "kind": meta["kind"],
            "expected_verdict_in": meta["expected_verdict_in"],
            "expected_categories_any_of": meta["expected_categories_any_of"],
            "actual_verdict": "", "actual_categories": [],
            "verdict_match": False, "category_match": None,
            "outcome": OUTCOME_ERROR,
            "elapsed_seconds": time.monotonic() - started,
            "verify_result": {}, "error": f"{type(e).__name__}: {e}",
        }

    actual_cats = [f.category for f in result.new_finding_categories]
    verdict_match = result.verdict in meta["expected_verdict_in"]
    cat_match = match_categories(
        actual=actual_cats,
        expected_substrings=meta["expected_categories_any_of"])
    outcome = classify_outcome(
        kind=meta["kind"], verdict=result.verdict,
        expected_verdict_in=meta["expected_verdict_in"])

    return {
        "name": meta["name"], "kind": meta["kind"],
        "expected_verdict_in": meta["expected_verdict_in"],
        "expected_categories_any_of": meta["expected_categories_any_of"],
        "actual_verdict": result.verdict,
        "actual_categories": actual_cats,
        "verdict_match": verdict_match,
        "category_match": cat_match,
        "outcome": outcome,
        "elapsed_seconds": time.monotonic() - started,
        "verify_result": result.to_dict(),
    }
```

- [ ] **Step 3: Run**

Run: `pytest tests/test_calibrate.py::TestRunBaseline -v`
Expected: 3 PASS.

### Task 2.8: Test + implement report writers

**Files:**
- Modify: `tests/test_calibrate.py`, `d2p/calibration.py`

- [ ] **Step 1: Append test class**

```python
class TestWriteReport(unittest.TestCase):
    def setUp(self) -> None:
        import tempfile
        self.tmpdir = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: __import__("shutil").rmtree(self.tmpdir,
                                                            ignore_errors=True))

    def test_write_report_creates_json_and_md_files(self) -> None:
        from d2p.calibration import write_report
        rows = [
            {"name": "x", "kind": "broken", "outcome": OUTCOME_CATCH,
             "actual_verdict": "needs_repair",
             "expected_verdict_in": ["needs_repair"],
             "expected_categories_any_of": ["readme"],
             "actual_categories": ["readme_x"],
             "verdict_match": True, "category_match": True,
             "elapsed_seconds": 5.0, "verify_result": {}},
        ]
        meta = {"model": "minimax-m2.7-hs", "started_at": "2026-05-26T16:00:00Z",
                "elapsed_seconds": 5.0, "harness_version": "v0"}
        metrics = compute_metrics(rows)
        write_report(self.tmpdir, rows, metrics, meta)
        self.assertTrue((self.tmpdir / "report.json").exists())
        self.assertTrue((self.tmpdir / "report.md").exists())

        report = json.loads((self.tmpdir / "report.json").read_text())
        self.assertEqual(report["model"], "minimax-m2.7-hs")
        self.assertEqual(report["metrics"]["catch_rate"], 1.0)
        self.assertEqual(len(report["rows"]), 1)

        md = (self.tmpdir / "report.md").read_text()
        self.assertIn("catch_rate", md)
        self.assertIn("fp_rate", md)
        self.assertIn("pass_on_broken", md)
        self.assertIn("minimax-m2.7-hs", md)
        self.assertIn("x", md)  # baseline name surfaces
```

- [ ] **Step 2: Append function**

```python
def write_report(out_dir: Path, rows: list[dict], metrics: Metrics,
                 meta: dict) -> None:
    """Write report.json + report.md to out_dir. Creates out_dir if missing."""
    out_dir.mkdir(parents=True, exist_ok=True)
    full = {
        "harness_version": meta.get("harness_version", "v0"),
        "started_at": meta.get("started_at", ""),
        "elapsed_seconds": meta.get("elapsed_seconds", 0.0),
        "model": meta.get("model", ""),
        "metrics": metrics.to_dict(),
        "rows": rows,
    }
    (out_dir / "report.json").write_text(json.dumps(full, indent=2,
                                                    default=str))
    (out_dir / "report.md").write_text(_render_md(rows, metrics, meta))


def _render_md(rows: list[dict], metrics: Metrics, meta: dict) -> str:
    lines: list[str] = []
    lines.append(f"# Calibration report · {meta.get('started_at', '')}")
    lines.append("")
    lines.append(f"**Model:** {meta.get('model', '')}")
    lines.append(f"**Total baselines:** {metrics.total_baselines}"
                 f" (errors: {metrics.errors})")
    lines.append(f"**Elapsed:** {meta.get('elapsed_seconds', 0.0):.1f}s")
    lines.append("")
    lines.append("## Metrics")
    lines.append("")
    lines.append("| Metric | Value | §11 target | Met? |")
    lines.append("|---|---|---|---|")
    lines.append(f"| catch_rate | {metrics.catch_rate:.2f} | ≥ 0.80 | "
                 f"{'✅' if metrics.catch_rate >= CATCH_THRESHOLD else '❌'} |")
    lines.append(f"| fp_rate | {metrics.fp_rate:.2f} | ≤ 0.20 | "
                 f"{'✅' if metrics.fp_rate <= FP_THRESHOLD else '❌'} |")
    lines.append(f"| pass_on_broken | {metrics.pass_on_broken} | == 0 | "
                 f"{'✅' if metrics.pass_on_broken == 0 else '❌'} |")
    lines.append("")
    lines.append(f"**Single-pass criteria met:** "
                 f"{'✅' if metrics.criteria_met else '❌'}")
    lines.append("")
    lines.append("## Per-baseline detail")
    lines.append("")
    for r in rows:
        icon = {OUTCOME_CATCH: "✅", OUTCOME_CLEAN_PASS: "✅",
                OUTCOME_MISS: "❌", OUTCOME_FALSE_ALARM: "❌",
                OUTCOME_ERROR: "⚠️"}.get(r["outcome"], "?")
        lines.append(f"### {r['kind']} / {r['name']} — {r['outcome']} {icon}")
        lines.append(f"- verdict: `{r['actual_verdict']}` "
                     f"(expected ∈ {r['expected_verdict_in']})")
        lines.append(f"- categories: {r.get('actual_categories', []) or 'none'}")
        if r.get("category_match") is True:
            lines.append("- category match: ✅")
        elif r.get("category_match") is False:
            lines.append("- category match: ❌")
        lines.append(f"- elapsed: {r.get('elapsed_seconds', 0):.1f}s")
        if r.get("error"):
            lines.append(f"- error: `{r['error']}`")
        lines.append("")
    return "\n".join(lines) + "\n"
```

- [ ] **Step 3: Run**

Run: `pytest tests/test_calibrate.py::TestWriteReport -v`
Expected: 1 PASS.

### Task 2.9: Test + implement main() with exit-code semantics

**Files:**
- Modify: `tests/test_calibrate.py`, `d2p/calibration.py`

- [ ] **Step 1: Append test class**

```python
class TestMainExitCode(unittest.TestCase):
    def test_criteria_met_returns_0(self) -> None:
        from d2p.calibration import _exit_code_for
        m = Metrics(catch_rate=0.9, fp_rate=0.1, pass_on_broken=0,
                    criteria_met=True, total_baselines=8, errors=0)
        self.assertEqual(_exit_code_for(m), 0)

    def test_criteria_failed_returns_1(self) -> None:
        from d2p.calibration import _exit_code_for
        m = Metrics(catch_rate=0.5, fp_rate=0.1, pass_on_broken=0,
                    criteria_met=False, total_baselines=8, errors=0)
        self.assertEqual(_exit_code_for(m), 1)

    def test_any_errors_force_exit_2(self) -> None:
        from d2p.calibration import _exit_code_for
        m = Metrics(catch_rate=1.0, fp_rate=0.0, pass_on_broken=0,
                    criteria_met=True, total_baselines=8, errors=1)
        self.assertEqual(_exit_code_for(m), 2)
```

- [ ] **Step 2: Append function + main() to d2p/calibration.py**

```python
def _exit_code_for(metrics: Metrics) -> int:
    if metrics.errors > 0:
        return 2
    return 0 if metrics.criteria_met else 1


def _build_verifier_factory(model: str):
    """Return a callable `(Path) -> Verifier` that constructs a fresh
    Verifier rooted at the given baseline directory. The provider is
    built once (closed over) and reused; only the Sandbox changes.

    Reads MINIMAX_API_KEY from env. v0 only supports kind=minimax."""
    import os
    from d2p.providers import ProviderSpec, build_router
    from d2p.agents.verifier import Verifier
    api_key = os.environ.get("MINIMAX_API_KEY", "")
    if not api_key:
        raise RuntimeError("MINIMAX_API_KEY env var not set")
    spec = ProviderSpec(
        kind="minimax", api_key=api_key, default_model=model,
        role_models={"default": model, "verify": model},
    )

    def factory(project_path: Path):
        router = build_router(spec=spec, working_dir=str(project_path))
        return Verifier(router.for_role("verify"), Sandbox(project_path))

    return factory


def _iter_baselines(baselines_dir: Path,
                    kinds: list[str],
                    name_filter: Optional[str]) -> list[Path]:
    out: list[Path] = []
    for kind in kinds:
        kind_dir = baselines_dir / kind
        if not kind_dir.is_dir():
            continue
        for child in sorted(kind_dir.iterdir()):
            if not child.is_dir():
                continue
            if name_filter and name_filter not in child.name:
                continue
            out.append(child)
    return out


def main(argv: Optional[list[str]] = None) -> int:
    import datetime as _dt
    parser = argparse.ArgumentParser(
        description="d2p Verifier calibration harness")
    parser.add_argument("--baselines", required=True, type=Path,
                        help="root containing broken/ and productized/ subdirs")
    parser.add_argument("--kind", default="broken,productized",
                        help="comma-separated subset of kinds to run")
    parser.add_argument("--model", default="minimax-m2.7-hs")
    parser.add_argument("--out", required=True, type=Path,
                        help="output directory for report.json + report.md")
    parser.add_argument("--filter", default=None,
                        help="run only baselines whose name contains this")
    parser.add_argument("--dry-run", action="store_true",
                        help="skip Verifier.verify() calls (no LLM)")
    parser.add_argument("--skip-pre-evidence", action="store_true",
                        help="pass empty PreEvidence to verify")
    args = parser.parse_args(argv)

    kinds = [k.strip() for k in args.kind.split(",") if k.strip()]
    baselines = _iter_baselines(args.baselines, kinds, args.filter)
    if not baselines:
        print(f"No baselines found under {args.baselines} for kinds={kinds}",
              file=sys.stderr)
        return 2

    started = time.monotonic()
    started_iso = _dt.datetime.now(_dt.timezone.utc).isoformat(
        timespec="seconds").replace("+00:00", "Z")

    rows: list[dict] = []
    verifier_factory = None
    if not args.dry_run:
        try:
            verifier_factory = _build_verifier_factory(args.model)
        except Exception as e:
            print(f"Could not construct verifier factory: {e}", file=sys.stderr)
            return 2

    for b in baselines:
        print(f"[calibrate] {b.parent.name}/{b.name} ...", flush=True)
        rows.append(run_baseline(
            b, verifier_factory,
            dry_run=args.dry_run,
            skip_pre_evidence=args.skip_pre_evidence,
        ))

    metrics = compute_metrics(rows)
    meta = {
        "harness_version": "v0",
        "started_at": started_iso,
        "elapsed_seconds": time.monotonic() - started,
        "model": args.model,
    }
    write_report(args.out, rows, metrics, meta)
    print(f"[calibrate] report → {args.out}")
    print(f"[calibrate] catch_rate={metrics.catch_rate:.2f} "
          f"fp_rate={metrics.fp_rate:.2f} "
          f"pass_on_broken={metrics.pass_on_broken} "
          f"criteria_met={metrics.criteria_met}")
    return _exit_code_for(metrics)


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 3: Run**

Run: `pytest tests/test_calibrate.py::TestMainExitCode -v`
Expected: 3 PASS.

### Task 2.10: Create scripts/calibrate.py CLI wrapper

**Files:**
- Create: `scripts/calibrate.py`

- [ ] **Step 1: Write the script**

```python
#!/usr/bin/env python3
"""Thin CLI wrapper for the calibration harness.

Usage:
    python scripts/calibrate.py \\
        --baselines tests/calibration/baselines \\
        --model minimax-m2.7-hs \\
        --out tests/calibration/reports/$(date +%Y%m%d-%H%M%S)/

Exit codes:
    0  all baselines completed AND §11 single-pass criteria met
    1  all baselines completed but at least one criterion not met
    2  harness errored (baseline error, model misconfig, etc.)

See docs/superpowers/specs/2026-05-26-d2p-calibration-harness-design.md
in the demo2project repo for design rationale.
"""
import sys
from pathlib import Path

# Ensure d2p is importable when running from anywhere in the repo.
_HERE = Path(__file__).resolve()
sys.path.insert(0, str(_HERE.parent.parent))

from d2p.calibration import main

if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Make executable + smoke test the CLI**

```bash
chmod +x scripts/calibrate.py
python scripts/calibrate.py --help
```

Expected: argparse usage block printed; exit 0.

### Task 2.11: Run full d2p test suite

- [ ] **Step 1: Run all tests**

Run: `pytest -q`
Expected: existing 155 + 4 pre_evidence + ~17 calibration unit tests = **~176 PASS** total.

Do not commit yet — wait until baselines are in (Phase 3) so the commit is the spec §11 commit 2 in one piece.

---

## Phase 3 · Seed baseline set (5 broken + 3 productized)

Goal: hand-author 8 baselines, each a small project with the defect (or cleanliness) described in spec §8. Pre-evidence commands must be runnable against each baseline without external setup (no Docker, no network, just the runners already in the dev venv).

### Task 3.1: Broken · flask-bad-readme

**Files:**
- Create: `tests/calibration/baselines/broken/flask-bad-readme/{app.py, README.md, requirements.txt, expected.json}`

- [ ] **Step 1: app.py — minimal but real Flask app**

```python
"""Simple greeter Flask app."""
from flask import Flask

app = Flask(__name__)


@app.route("/")
def index() -> str:
    return "hello"


if __name__ == "__main__":
    app.run(port=5000)
```

- [ ] **Step 2: README.md — deliberately wrong (says pnpm test for a Python project)**

```markdown
# flask-bad-readme

A small Flask app.

## Run

```
python app.py
```

## Test

```
pnpm test
```

(The README is wrong on purpose — this is a calibration baseline. The
verifier should catch the README/project-language mismatch.)
```

- [ ] **Step 3: requirements.txt**

```
flask==3.0.0
```

- [ ] **Step 4: expected.json**

```json
{
  "name": "flask-bad-readme",
  "kind": "broken",
  "archetype": "python-api",
  "expected_verdict_in": ["needs_repair", "fail"],
  "expected_categories_any_of": ["readme", "documentation"],
  "notes": "README says `pnpm test`; project is Python — should flag command/language mismatch"
}
```

### Task 3.2: Broken · fastapi-no-error-envelope

**Files:**
- Create: `tests/calibration/baselines/broken/fastapi-no-error-envelope/{main.py, README.md, requirements.txt, expected.json}`

- [ ] **Step 1: main.py — FastAPI app with no exception handler, even for invalid input**

```python
"""FastAPI service that returns 200 OK for everything, including bad input.
No @app.exception_handler — production gap."""
from fastapi import FastAPI

app = FastAPI()

USERS = {"1": {"name": "alice"}, "2": {"name": "bob"}}


@app.get("/users/{user_id}")
def get_user(user_id: str):
    # Returns whatever is at USERS[user_id], or empty dict if missing.
    # No 404, no error shape — every response is 200 with whatever payload.
    return USERS.get(user_id, {})
```

- [ ] **Step 2: README.md (clean, says nothing wrong)**

```markdown
# fastapi-no-error-envelope

A small FastAPI service.

## Run

```
uvicorn main:app --reload
```

## Test

```
pytest
```
```

- [ ] **Step 3: requirements.txt**

```
fastapi==0.110.0
uvicorn==0.29.0
```

- [ ] **Step 4: expected.json**

```json
{
  "name": "fastapi-no-error-envelope",
  "kind": "broken",
  "archetype": "python-api",
  "expected_verdict_in": ["needs_repair", "fail"],
  "expected_categories_any_of": ["error", "envelope", "exception"],
  "notes": "All routes 200 OK even for missing IDs; no @app.exception_handler — verifier should flag missing standardised error responses"
}
```

### Task 3.3: Broken · node-lib-unpinned-deps

**Files:**
- Create: `tests/calibration/baselines/broken/node-lib-unpinned-deps/{src/index.ts, package.json, README.md, expected.json}`

- [ ] **Step 1: src/index.ts**

```ts
/** Trivial library that re-exports a sum function. */
export function add(a: number, b: number): number {
  return a + b;
}
```

- [ ] **Step 2: package.json (deliberately unpinned)**

```json
{
  "name": "node-lib-unpinned-deps",
  "version": "0.1.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest run"
  },
  "dependencies": {
    "lodash": "*"
  },
  "devDependencies": {
    "typescript": "^5",
    "vitest": "*"
  }
}
```

- [ ] **Step 3: README.md**

```markdown
# node-lib-unpinned-deps

A tiny TypeScript library.

## Build / Test

```
npm install
npm run build
npm test
```
```

- [ ] **Step 4: expected.json**

```json
{
  "name": "node-lib-unpinned-deps",
  "kind": "broken",
  "archetype": "node-lib",
  "expected_verdict_in": ["needs_repair", "fail"],
  "expected_categories_any_of": ["unpinned", "dependency", "version"],
  "notes": "dependencies use `*` and `^` ranges — verifier should flag production deps not pinned"
}
```

### Task 3.4: Broken · python-cli-no-help

**Files:**
- Create: `tests/calibration/baselines/broken/python-cli-no-help/{cli.py, README.md, requirements.txt, expected.json}`

- [ ] **Step 1: cli.py — CLI exists but skips argparse**

```python
"""Greeter CLI. Takes one positional arg, prints `Hello, NAME`.
No argparse, no --help; this is the seeded defect."""
import sys


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: cli.py NAME", file=sys.stderr)
        return 1
    print(f"Hello, {sys.argv[1]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: README.md**

```markdown
# python-cli-no-help

Greet someone.

## Run

```
python cli.py World
```
```

- [ ] **Step 3: requirements.txt** (empty stdlib-only project, but file must exist for pre-evidence to detect Python)

```
# stdlib-only
```

- [ ] **Step 4: expected.json**

```json
{
  "name": "python-cli-no-help",
  "kind": "broken",
  "archetype": "python-cli",
  "expected_verdict_in": ["needs_repair", "fail"],
  "expected_categories_any_of": ["cli", "help", "interface", "argparse"],
  "notes": "CLI exists but has no --help; verifier should flag missing CLI contract"
}
```

### Task 3.5: Broken · empty-tests

**Files:**
- Create: `tests/calibration/baselines/broken/empty-tests/{src/lib.py, tests/test_lib.py, README.md, requirements.txt, expected.json}`

- [ ] **Step 1: src/lib.py — a real function**

```python
def add(a: int, b: int) -> int:
    return a + b


def subtract(a: int, b: int) -> int:
    return a - b
```

- [ ] **Step 2: tests/test_lib.py — anti-gaming pattern (assert True)**

```python
"""These tests are deliberately empty — they assert True without
exercising the lib. This is the anti-gaming pattern the verifier
should detect."""


def test_add() -> None:
    assert True


def test_subtract() -> None:
    assert True


def test_invariant_one() -> None:
    assert True


def test_invariant_two() -> None:
    assert True


def test_invariant_three() -> None:
    assert True
```

- [ ] **Step 3: README.md**

```markdown
# empty-tests

A small math lib with tests.

## Run

```
pytest
```
```

- [ ] **Step 4: requirements.txt**

```
# stdlib-only; tests use pytest from venv
```

- [ ] **Step 5: expected.json**

```json
{
  "name": "empty-tests",
  "kind": "broken",
  "archetype": "python-lib",
  "expected_verdict_in": ["needs_repair", "fail"],
  "expected_categories_any_of": ["test", "assertion", "anti_gaming", "trivial"],
  "notes": "5 tests that just `assert True`; src/lib.py is uncovered. Verifier should flag anti-gaming test pattern"
}
```

### Task 3.6: Productized · flask-clean

**Files:**
- Create: `tests/calibration/baselines/productized/flask-clean/{app.py, tests/test_app.py, README.md, requirements.txt, expected.json}`

- [ ] **Step 1: app.py — Flask app with proper error handlers**

```python
"""Productized Flask user service."""
from flask import Flask, jsonify

app = Flask(__name__)
USERS = {"1": {"name": "alice"}, "2": {"name": "bob"}}


@app.route("/users/<user_id>")
def get_user(user_id: str):
    if user_id not in USERS:
        return jsonify({"error": "not_found", "user_id": user_id}), 404
    return jsonify({"data": USERS[user_id]})


@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "not_found"}), 404


@app.errorhandler(500)
def server_error(e):
    return jsonify({"error": "internal"}), 500


if __name__ == "__main__":
    app.run(port=5000)
```

- [ ] **Step 2: tests/test_app.py**

```python
import pytest
from app import app


@pytest.fixture
def client():
    app.testing = True
    return app.test_client()


def test_get_user_ok(client):
    r = client.get("/users/1")
    assert r.status_code == 200
    assert r.get_json() == {"data": {"name": "alice"}}


def test_get_user_404(client):
    r = client.get("/users/missing")
    assert r.status_code == 404
    body = r.get_json()
    assert body["error"] == "not_found"
```

- [ ] **Step 3: README.md**

```markdown
# flask-clean

A small Flask user service with consistent error envelopes.

## Setup

```
pip install -r requirements.txt
```

## Run

```
python app.py
```

## Test

```
pytest -q
```
```

- [ ] **Step 4: requirements.txt (pinned)**

```
flask==3.0.0
pytest==8.0.0
```

- [ ] **Step 5: expected.json**

```json
{
  "name": "flask-clean",
  "kind": "productized",
  "archetype": "python-api",
  "expected_verdict_in": ["pass", "no_new_findings"],
  "expected_categories_any_of": [],
  "notes": "Flask app with @app.errorhandler, JSON error envelopes, pinned deps, README, tests passing"
}
```

### Task 3.7: Productized · node-cli-clean

**Files:**
- Create: `tests/calibration/baselines/productized/node-cli-clean/{src/index.ts, tests/index.test.ts, package.json, tsconfig.json, README.md, expected.json}`

- [ ] **Step 1: src/index.ts**

```ts
#!/usr/bin/env node
/** Greeter CLI in TypeScript. */

export function buildMessage(name: string): string {
  return `Hello, ${name}!`;
}

function main(argv: string[]): number {
  const args = argv.slice(2);
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    console.log("usage: greet NAME\n\nPrints a greeting for NAME.");
    return args.length === 0 ? 1 : 0;
  }
  console.log(buildMessage(args[0]));
  return 0;
}

if (require.main === module) {
  process.exit(main(process.argv));
}
```

- [ ] **Step 2: tests/index.test.ts**

```ts
import { describe, it, expect } from "vitest";
import { buildMessage } from "../src/index";

describe("buildMessage", () => {
  it("greets by name", () => {
    expect(buildMessage("World")).toBe("Hello, World!");
  });
});
```

- [ ] **Step 3: package.json (pinned exact versions)**

```json
{
  "name": "node-cli-clean",
  "version": "0.1.0",
  "type": "commonjs",
  "bin": { "greet": "dist/index.js" },
  "scripts": {
    "build": "tsc",
    "test": "vitest run"
  },
  "dependencies": {},
  "devDependencies": {
    "typescript": "5.4.5",
    "vitest": "1.5.0",
    "@types/node": "20.12.7"
  }
}
```

- [ ] **Step 4: tsconfig.json (strict)**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": false
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 5: README.md**

```markdown
# node-cli-clean

A small TypeScript CLI greeter.

## Setup

```
npm install
```

## Build

```
npm run build
```

## Test

```
npm test
```

## Run

```
./dist/index.js NAME
```
```

- [ ] **Step 6: expected.json**

```json
{
  "name": "node-cli-clean",
  "kind": "productized",
  "archetype": "node-cli",
  "expected_verdict_in": ["pass", "no_new_findings"],
  "expected_categories_any_of": [],
  "notes": "TS CLI with --help, vitest tests, strict tsconfig, pinned deps"
}
```

### Task 3.8: Productized · python-cli-clean

**Files:**
- Create: `tests/calibration/baselines/productized/python-cli-clean/{cli.py, tests/test_cli.py, README.md, requirements.txt, expected.json}`

- [ ] **Step 1: cli.py**

```python
"""Greeter CLI with argparse + --help."""
from __future__ import annotations

import argparse
import sys


def build_message(name: str) -> str:
    return f"Hello, {name}!"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="greet", description="Greet someone by name.")
    parser.add_argument("name", help="who to greet")
    args = parser.parse_args(argv)
    print(build_message(args.name))
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: tests/test_cli.py**

```python
from cli import build_message


def test_build_message_greets_by_name() -> None:
    assert build_message("World") == "Hello, World!"
```

- [ ] **Step 3: README.md**

```markdown
# python-cli-clean

A small CLI greeter.

## Setup

```
pip install -r requirements.txt
```

## Run

```
python cli.py NAME
```

## Test

```
pytest -q
```
```

- [ ] **Step 4: requirements.txt**

```
pytest==8.0.0
mypy==1.9.0
```

- [ ] **Step 5: expected.json**

```json
{
  "name": "python-cli-clean",
  "kind": "productized",
  "archetype": "python-cli",
  "expected_verdict_in": ["pass", "no_new_findings"],
  "expected_categories_any_of": [],
  "notes": "argparse CLI with --help, pytest tests passing, mypy clean (typed), README, pinned deps"
}
```

### Task 3.9: Add .gitignore entry

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Append**

```bash
echo "" >> .gitignore
echo "# Calibration harness reports (gitignored; commit manually to docs/calibration/)" >> .gitignore
echo "tests/calibration/reports/" >> .gitignore
```

### Task 3.10: Dry-run smoke test

- [ ] **Step 1: Run harness in dry-run mode against all 8 baselines**

```bash
cd ~/Desktop/Hosico/Works/Work/d2p
source .venv/bin/activate
python scripts/calibrate.py \
    --baselines tests/calibration/baselines \
    --dry-run \
    --out /tmp/calibrate-dryrun/
```

Expected:
- 8 baselines processed
- Each prints `[calibrate] broken/<name> ...` or `[calibrate] productized/<name> ...`
- `/tmp/calibrate-dryrun/report.json` and `report.md` exist
- All 8 rows have `actual_verdict = "<dry-run>"` and `outcome = "error"`
- Exit code 2 (errors > 0 because dry-run rows are classified as OUTCOME_ERROR)

This is the v0 contract: dry-run skips LLM but exercises pre-evidence collection and the run loop. If pre-evidence collection blows up on a baseline (e.g., pytest hangs), this is where we find out.

### Task 3.11: Commit Phase 2 + 3 together

- [ ] **Step 1: Stage**

```bash
git add d2p/calibration.py scripts/calibrate.py \
        tests/test_calibrate.py tests/calibration/ .gitignore
```

- [ ] **Step 2: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: calibration harness + seed baseline set

Single-pass calibration harness for the d2p Verifier per spec §11:
- d2p/calibration.py: pure-logic outcome classification + metric
  aggregation + report writers (testable without LLM)
- scripts/calibrate.py: thin CLI wrapping main()
- tests/test_calibrate.py: ~17 unit tests; mocked Verifier
- tests/calibration/baselines/{broken,productized}/<8 dirs>/ seed set:
  5 broken (flask-bad-readme, fastapi-no-error-envelope,
  node-lib-unpinned-deps, python-cli-no-help, empty-tests) + 3
  productized (flask-clean, node-cli-clean, python-cli-clean)
- .gitignore: tests/calibration/reports/

Spec: docs/superpowers/specs/2026-05-26-d2p-calibration-harness-design.md
(in Hosico02/demo2project).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 4 · Live run + results doc

Goal: actually run the harness against the seed set with a real LLM, capture the report, and persist a copy to `docs/calibration/` so the v0 results are auditable.

### Task 4.1: Confirm MINIMAX_API_KEY is set

- [ ] **Step 1: Check env**

```bash
echo "${MINIMAX_API_KEY:?MINIMAX_API_KEY not set}" | head -c 6
```

Expected: prints first 6 chars of the key. If unset, extract from `~/Desktop/MINIMAX_KEY.docx` via the session 8 incantation:

```bash
export MINIMAX_API_KEY=$(unzip -p ~/Desktop/MINIMAX_KEY.docx word/document.xml \
    | python3 -c "import sys, re; print(re.search(r'sk-[A-Za-z0-9]+', sys.stdin.read()).group(0))")
```

### Task 4.2: Live run against full seed set

- [ ] **Step 1: Run**

```bash
cd ~/Desktop/Hosico/Works/Work/d2p
source .venv/bin/activate
TS=$(date +%Y%m%d-%H%M%S)
python scripts/calibrate.py \
    --baselines tests/calibration/baselines \
    --model minimax-m2.7-hs \
    --out tests/calibration/reports/$TS/
```

Expected: 5-7 minutes wall-clock. Final line prints
`catch_rate=X.XX fp_rate=X.XX pass_on_broken=N criteria_met=True|False`.

Whatever the exit code, capture the report — the v0 deliverable is the harness + the first measurement, not "we passed calibration" on attempt 1.

### Task 4.3: Persist results to docs/calibration/

**Files:**
- Create: `docs/calibration/2026-05-26-v0-results.md`

- [ ] **Step 1: Copy report.md + add a short preamble**

```bash
mkdir -p docs/calibration
TS=<the timestamp from Task 4.2>
{
  echo "# Calibration v0 — first live run"
  echo ""
  echo "**Date:** 2026-05-26"
  echo "**Harness:** d2p/calibration.py v0"
  echo "**Spec:** docs/superpowers/specs/2026-05-26-d2p-calibration-harness-design.md (in demo2project)"
  echo ""
  echo "## Observations"
  echo ""
  echo "<2-3 bullet points after eyeballing the report — surprises,"
  echo "any baseline that misbehaved, what to address before scale-up.>"
  echo ""
  echo "---"
  echo ""
  cat tests/calibration/reports/$TS/report.md
} > docs/calibration/2026-05-26-v0-results.md
```

- [ ] **Step 2: Hand-edit the Observations section**

Open `docs/calibration/2026-05-26-v0-results.md` and replace the placeholder bullets with what you actually saw — e.g., "catch_rate=0.6, two false negatives on `fastapi-no-error-envelope` and `empty-tests`; prompt likely under-emphasises anti-gaming pattern detection".

### Task 4.4: Commit results doc

- [ ] **Step 1: Stage + commit**

```bash
git add docs/calibration/2026-05-26-v0-results.md
git commit -m "$(cat <<'EOF'
docs: 2026-05-26 calibration v0 baseline results

First live run of the calibration harness against the 8 seed
baselines, model minimax-m2.7-hs. Numbers + per-baseline detail
in this doc; raw report under tests/calibration/reports/<ts>/
(gitignored). Observations section captures what to address
before scale-up to the full §11 set.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Acceptance criteria for the plan as a whole

1. `pytest -q` on d2p passes 100% (≈ 176 tests) after Phase 2 ends.
2. Dry-run smoke (Task 3.10) emits a report with 8 rows, all `outcome="error"`, no exceptions reach the CLI.
3. Live run (Task 4.2) emits a report with 8 rows, ≤ 1 row with `outcome="error"` (a single transient API error is acceptable; ≥ 2 means harness needs investigation, not a baseline problem).
4. `docs/calibration/2026-05-26-v0-results.md` exists, contains real numbers, contains hand-written Observations section.
5. No regressions in the existing d2p verify wire-up — `D2P_VERIFY_ENABLED=1` runs against `/tmp/d2p-e2e-demo` (the session 8 demo) still produce the same verify behaviour as before the refactor.

## Out of scope (do not implement)

Anything not listed above. Specifically:

- Second-pass FP, broken-then-fixed, scale-up to 20+10, Opus parallel runs (spec §10)
- Prompt iteration based on observed results (decide after looking at the report)
- CI integration of the harness
- Hub UI surface for calibration reports
