# Hub ↔ d2p log integration · design v0

**Status**: draft, pending user review
**Date**: 2026-05-27
**Builds on**: `2026-05-26-hub-logs-tab-design.md` (logs tab v0, ships logs UI but only sees Hub-spawned runs)
**Related (other repo)**: d2p needs a parallel-session spec on its side

## 1. Problem

Hub's `/runs/:id` logs tab (shipped on branch `logs-tab`, 4 commits, unmerged)
can only see runs that Hub itself spawned via `/iterate` or
`POST /admin/runs/start`. d2p runs started directly from the CLI
(`python run.py <project> --resume … --iter N …`) are invisible:

1. Hub has no DB row for the run (events flow not wired)
2. Hub's stdout endpoint reads from `dataDir/runner-logs/<id>.log`, which
   only Hub's supervisor writes to
3. d2p's own stdout lives under `<project>/.d2p/<run-dir>/d2p.log`,
   never offered to Hub

Goal: a d2p iteration started anywhere — including the CLI — surfaces in
Hub's logs tab in real time, both the milestones panel and the stdout
viewer.

## 2. Scope

In: Hub-side schema/endpoint/ingest changes; cross-repo contract spec
(d2p-side implementation is the d2p session's task).

Out: changes to the `logs-tab` branch UI (no UI changes needed); active
discovery (filesystem watch); SSE/WebSocket push; retroactive ingest of
runs that started before this feature exists; path-safety hardening
(symlink resolution, allowlists).

Single-user local deployment. No multi-tenant assumptions beyond the
existing instance-token model.

## 3. Architecture

```
┌──────────────────┐    POST /events (bearer)    ┌────────────────┐
│   d2p (Python)   │ ──────────────────────────▶ │  Hub (Hono)    │
│ run-YYYYMMDD…    │   run_started/iter/term     │  SQLite        │
└──────────────────┘                              └────────────────┘
        │                                                 │
        │ writes append-only                              │ reads on demand
        ▼                                                 │
  <project>/.d2p/<run_id>/d2p.log ◀────────────────────────┘
```

- d2p is the source of truth: it owns the `run_id` (its dir name) and the
  log file path (absolute). It pushes both to Hub via the existing
  `POST /events` endpoint.
- Hub stores the advertised log path in the `runs` table; its stdout
  endpoint reads from that path on demand. No filesystem watching, no
  background tail process.
- The frontend (logs tab) needs no changes — milestones panel reads
  `/runs/:id` (already populated by `iteration_complete` events), stdout
  viewer polls `/admin/runs/:id/stdout` (now path-aware).

## 4. Cross-repo contract

**Run id**: a free-form string. d2p uses its directory name
(`run-YYYYMMDD-HHMMSS`). Hub stores it verbatim in `runs.id` (already
`TEXT PRIMARY KEY`). UUIDs from Hub-spawned runs continue to work
unchanged; the column is format-agnostic.

**Authentication**: existing instance-token bearer. d2p reads two env
vars; both must be set for Hub push to activate:
- `D2P_HUB_URL` — e.g. `http://127.0.0.1:3700`
- `D2P_INSTANCE_TOKEN` — must match an instance row in Hub's DB

If either is missing, d2p runs normally with zero Hub coupling (this
preserves the current "local-only" CLI workflow).

**Startup ordering** (d2p, required):

1. Create the run dir, `touch` the stdout log file
2. POST `run_started` with `stdout_path` set
3. Begin writing to the log file

The order matters: if Hub receives `run_started` before the file exists,
the user's first poll returns 404 and the tab shows "no log" — not
catastrophic, but confusing. Touching first eliminates the race.

**Failure handling** (d2p): each event POST retries up to 3 times with
5s backoff. On exhaustion, the event is dropped silently. d2p MUST NOT
block the run on Hub push failures — Hub is observability, not the
critical path.

**stdout write semantics** (d2p): the file is append-only. d2p tees its
own stdout + every subprocess's stdout/stderr to this file. Lines must be
flushed (no Python output buffering, no `subprocess` buffer accumulation)
or the tab will appear to stall for many seconds at a time.

**Termination**: d2p sends `run_terminated` synchronously before process
exit. Hub uses `runs.terminalState != null` to gate the stdout endpoint's
`eof` flag (§6.3).

**Event payload schemas**:

```json
{
  "type": "run_started",
  "run_id": "run-20260527-094242",
  "payload": {
    "project_path": "/Users/mack/Desktop/bazi-love",
    "stdout_path": "/Users/mack/Desktop/bazi-love/.d2p/run-20260527-094242/d2p.log",
    "started_at": "2026-05-27T09:42:42Z",
    "detected_archetype": "node-cli"
  }
}
```

`detected_archetype` is optional. `stdout_path` is required for this
feature to work; if absent, Hub falls back to `runner-logs/<id>.log` and
the stdout panel returns 404.

`iteration_complete`, `verdict_emitted`, `finding_recorded`,
`run_terminated`: payload shapes unchanged from
`src/hub/ingest/eventHandlers.ts` — see existing code. d2p must produce
them in the same shape Hub-spawned runs already produce.

## 5. Hub-side changes

### 5.1 Schema migration

Add nullable column to the `runs` table:

```ts
// src/hub/db/schema.ts
stdoutPath: text('stdout_path'),  // nullable
```

Drizzle generates the `ALTER TABLE` migration. Existing rows get NULL,
which is the correct semantics ("no advertised path — use the runner-logs
fallback").

### 5.2 Ingest

`src/hub/ingest/eventHandlers.ts`, `run_started` branch — read
`payload.stdout_path` and write it to the column. Treat missing field as
NULL (no error, no warning — preserves backward compat with Hub-spawned
runs that don't send this field).

### 5.3 stdout endpoint

`src/hub/routes/runs_runner.ts:128` — two changes:

**Path resolution** — current logic:

```ts
const path = cur?.runId === id
  ? cur.stdoutPath
  : pJoin(dataDir, 'runner-logs', `${id}.log`);
```

New three-tier priority:

```ts
const path = cur?.runId === id
  ? cur.stdoutPath                                          // Hub-spawned, live
  : (runsRow?.stdoutPath ?? pJoin(dataDir, 'runner-logs', `${id}.log`));
//   ^^^^^^^^^^^^^^^^^^^^^^                                 // external, advertised
//                          ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ // legacy fallback
```

The endpoint doesn't currently SELECT from `runs` — this change adds one
DB read per stdout poll (also needed for the EOF logic below, so it
amortizes).

**EOF logic** — current code:

```ts
const eof = (from + chunkSize >= size) && cur?.runId !== id;
```

This is correct for Hub-spawned runs (eof when supervisor's current
runner moved on) but wrong for external runs: `cur` is always null, so
`cur?.runId !== id` is always true, so eof flips true after one read and
the client stops polling.

New logic:

```ts
const isLive = cur?.runId === id
            || (runsRow != null && runsRow.terminalState == null);
const eof = (from + chunkSize >= size) && !isLive;
```

A run is "live" if it's currently Hub-spawned, OR it has a DB row with no
terminal state (external run that hasn't sent `run_terminated` yet).

### 5.4 No frontend changes

The logs tab already calls `/runs/:id` and `/admin/runs/:id/stdout` —
both endpoints now work for external runs once §5.1–5.3 land. The 30s
milestone refetch added in `logs-tab` branch commit `fbe1677` already
covers the "live run, milestones go stale" case.

## 6. Failure modes

| Failure | Behavior |
|---|---|
| d2p env vars not set | d2p runs normally; Hub never sees the run (by design) |
| d2p POST fails | d2p retries 3× with 5s backoff, then drops; run continues |
| `stdout_path` file not yet created when client polls | endpoint returns 404 `log_not_found`; logs tab shows "no log" state, recovers on next poll once file exists |
| File deleted after run ends | endpoint returns 404 from that point; client gets clear error |
| File truncated mid-run | `from > size` branch: returns `{ content: '', next_offset: size, eof: <terminalState-dependent> }`. Display freezes silently (known limitation, §8) |
| `run_started` missing `stdout_path` | `stdoutPath` column stays NULL → fallback to `runner-logs/<id>.log` → 404 → "no log". No crash |
| `run_started` arrives twice for same id | Ingest is upsert; second one overwrites. Idempotent |
| Hub process restarts mid-run | DB persists; stdout endpoint resumes from file offset. No state lost |
| d2p crashes without sending `run_terminated` | `terminalState` stays null → endpoint never returns eof=true → tab polls forever. **Known limitation** (§8) |

## 7. Testing

All on the Hub side; d2p-side tests are the d2p session's responsibility.

**Unit — ingest** (`tests/hub/ingest.test.ts`):
- `run_started` with `stdout_path` → column populated
- `run_started` without `stdout_path` → column NULL, no error
- `run_started` twice for same id → second value wins

**Unit — stdout endpoint** (`tests/hub/runs_runner.test.ts`):
- Hub-spawned live run → uses `cur.stdoutPath`
- External run with `runs.stdoutPath` set → uses that path
- External run with NULL stdoutPath → falls back to runner-logs path
- EOF logic: external run with `terminalState=null` returns `eof:false`
  even at end of file
- EOF logic: external run with `terminalState='SUCCESS'` returns
  `eof:true` at end of file
- Missing file → 404 `log_not_found`

**Integration** (`tests/hub/integration.test.ts`, new): write a
temporary log file, insert a `runs` row pointing at it, simulate event
posts, GET stdout endpoint, assert byte-correct content slices.

No new frontend tests — the logs tab is already tested at
`tests/site/useRunLogs.test.ts` (6 tests including header assertion); its
contract with the endpoint hasn't changed.

## 8. Known limitations

- **Stale tail on d2p crash**: if d2p dies without sending
  `run_terminated`, `terminalState` stays null and the tab polls forever.
  A separate session-8-style crash-recovery sweep is the right fix
  (orphaned-run detection on Hub startup); deferring.
- **Truncate-mid-run**: log file truncation is silently swallowed. d2p's
  contract forbids truncating; if it happens, the display freezes.
- **No catch-up for in-flight runs at deploy time**: PID 79710 (the d2p
  run currently in progress) won't gain Hub visibility without a restart
  + env vars. User accepts.
- **No backpressure**: a 100 MB log file gets read in 1 MB chunks per
  poll; on slow disks this could starve other requests. Not an issue for
  current single-user scale.

## 9. Out of scope (explicitly not doing)

- Path safety validation (symlink resolution / allowlists). Instance
  token is the trust boundary; Hub trusts the path d2p hands it.
- Filesystem watching for active discovery — d2p must push.
- SSE / WebSocket streaming — `setTimeout` polling in `useRunLogs.ts` is
  fine for this scale.
- Backward-compat shims for d2p versions that don't emit `stdout_path` —
  the fallback already gracefully degrades to a 404 + "no log" UI state.
- Multi-instance log aggregation — single instance per Hub.

## 10. Commit plan (Hub side)

1. **Schema + migration**: add `stdoutPath` nullable column to `runs`,
   generate drizzle migration. Tests: schema only, no behavior change.
2. **Ingest + endpoint**: wire `stdoutPath` through `dispatchIngest`,
   update `/admin/runs/:id/stdout` path resolution + EOF logic, add unit
   tests covering all six cases in §7.
3. **Integration test + docs**: tmp-file integration test; update
   `docs/superpowers/specs/2026-05-26-hub-logs-tab-design.md` with a
   one-line pointer to this spec.

Three commits, ship as one PR (or onto `logs-tab` branch then merge
together). No dependency on the d2p-side work — the fallback path means
Hub can ship first and d2p-side can light up independently.
