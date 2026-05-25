# Hub `/iterate` page · design spec

> **Status**: design approved (approach A, 2026-05-25)
> **Repos**: `Hosico02/MatrixOmnix-Hub` (this repo, all new code) + 1-line
>   change in `Hosico02/d2p` (`D2P_RUN_ID` env override)
> **Live target**: <https://matrixomnix.vercel.app> stays the public umbrella;
>   `/iterate` lives in the Hub UI (admin-token-gated, single-machine
>   operator surface) and is NOT exposed on the public site.

## 1. Goal

A one-click operator surface for kicking off d2p on a local folder, watching
its progress, and pushing the productized result to an existing GitHub repo —
all from a browser, without touching a terminal.

This is an **operator tool**, not a public service. It runs `python run.py`
as a subprocess on whichever machine Hub is running on, so it only ever
makes sense when Hub is running on the user's own laptop or a private
machine they SSH to. It's gated by the admin token Hub already uses for
`/admin/*` routes, and additionally feature-gated by `D2P_RUNNER_ENABLED=1`
so a default Hub deployment cannot accidentally expose subprocess
execution.

## 2. Non-goals

- Multi-tenant / hosted version. Hub stays single-instance.
- Concurrent runs. Mutex enforces one in-flight d2p at a time per Hub
  instance.
- Creating a new GitHub repo. Only pushing to an existing remote URL.
  (Per brainstorm decision: B — push to existing repo only.)
- Full d2p config UI. MVP exposes only `--iter` (default 3); `--no-qa` and
  the other flags are not surfaced.
- Calibration / verify enabled by default. Verify stays off (`D2P_VERIFY_ENABLED`
  unset by default); the page does not surface verify state in MVP.

## 3. User flow

1. Operator opens Hub UI, navigates to `/iterate`.
2. Enters an absolute project path (text input — no FS picker; browser FS
   APIs don't return paths and a path is what `subprocess.spawn` needs).
3. Picks `iter` count (number input, default 3, range 1-10).
4. Clicks **Run d2p**. Page transitions to the Progress view.
5. Progress view shows, polling every 2s:
   - Current iter / total iter
   - Cumulative cost so far (from `/api/runs/:id` row)
   - Stage timings of last iter (planner, executor, qa)
   - Tail of d2p stdout (last 200 lines, incrementally appended from
     `/admin/runs/:id/stdout?from=<offset>`).
6. When the run reaches a terminal state (`complete` / `failed` /
   `TERMINATE_CLEAN` / etc.), Progress view freezes and the Push panel
   expands below it.
7. Operator enters remote URL + branch + commit message (defaults
   pre-filled), clicks **Push to GitHub**. Page shows the git output as
   it streams.
8. On push success, page shows the remote URL as a clickable link.

If the operator closes the browser mid-run, d2p keeps running (server-
spawned process). Reopening the page reattaches by reading the in-flight
run from the supervisor singleton.

## 4. Architecture

```
┌─ Browser ────────────────────────────────────────────────────────────┐
│  site/ (Vue 3 + Pinia + Tailwind, admin-token gate)                  │
│  /iterate route:                                                     │
│    - Setup form         POST /admin/runs/start                       │
│    - Progress           poll  /api/runs/:id   (2s)                   │
│                         poll  /admin/runs/:id/stdout?from=N  (2s)    │
│    - Push panel         POST /admin/runs/:id/push-github             │
└──────────────────────────────────────────────────────────────────────┘
                                  │
                                  │ HTTP (Bearer admin-token)
                                  ▼
┌─ Hub (Hono on Node) ─────────────────────────────────────────────────┐
│  POST /admin/runs/start                                              │
│      1. validate { project_path, iter }                              │
│      2. RunSupervisor.acquire() (refuse if a run is in flight)       │
│      3. pre-generate run_id = uuid()                                 │
│      4. spawn:                                                       │
│         python <D2P_PATH>/run.py <project_path>                      │
│             --iter <iter> --no-cache-analysis                        │
│         env: HUB_URL=self  HUB_TOKEN=<D2P_RUNNER_INSTANCE_TOKEN>     │
│              MINIMAX_API_KEY=<D2P_RUNNER_MINIMAX_API_KEY>            │
│              D2P_RUN_ID=<pre-generated uuid>      [← d2p reads this] │
│         stdio: pipe stdout+stderr to <data>/runner-logs/<run_id>.log │
│      5. return { run_id, pid }                                       │
│                                                                      │
│  GET  /admin/runs/current                                            │
│      → return supervisor's active run (or null) for page reattach    │
│                                                                      │
│  GET  /admin/runs/:id/stdout?from=N                                  │
│      → returns content of <data>/runner-logs/<id>.log from byte N,   │
│        plus next_offset so the page knows where to resume.           │
│                                                                      │
│  POST /admin/runs/:id/push-github  { remote_url, branch, commit_msg }│
│      1. look up project_path from runs table (`runs.id == :id`)      │
│      2. ensure run.terminal_state is set (refuse if still RUNNING)   │
│      3. on project_path:                                             │
│         - `git init`            (no-op if already a repo)            │
│         - `git add -A`                                               │
│         - `git commit -m "<msg>"` (skip if nothing to commit)        │
│         - `git remote set-url origin <url>` OR `git remote add origin`│
│         - `git push -u origin <branch>`                              │
│      4. stream combined stdout/stderr back, plus exit_code.          │
│                                                                      │
│  RunSupervisor (singleton, in-memory):                               │
│      - current: { run_id, child, stdout_path, started_at } | null    │
│      - acquire() / release() / get()                                 │
│      - on Hub shutdown: SIGTERM the child if any                     │
│      - on child exit: release(); if the run row in DB is still       │
│        RUNNING, mark it `crashed` and write a synthetic              │
│        run_terminated event                                          │
└──────────────────────────────────────────────────────────────────────┘
                                  │
                                  │ HTTP (existing /api/events)
                                  ▼
                          d2p subprocess pushes
                          run_started / iteration_complete /
                          run_terminated events back to Hub
```

The d2p subprocess is just the existing `run.py` — no changes except
**reading `D2P_RUN_ID` env if present** so Hub and d2p agree on the run
identifier before any DB row exists. Without that bridge the page would
have to poll-search for "the run that just started", which is racy.

## 5. Data model

No new tables. Existing schema covers it:

- `runs` row populated by d2p's existing `hub_client.push_event('run_started', ...)`.
- `iterations` rows populated by `iteration_complete` events.
- `terminal_state` populated by `run_terminated` event.

New on-disk artifact:

- `<HUB_DATA_DIR>/runner-logs/<run_id>.log` — combined stdout+stderr of
  the d2p subprocess. `HUB_DATA_DIR` defaults to the parent of
  `HUB_DB_PATH` so log lives next to the DB. Kept indefinitely (small,
  human-readable; auto-prune is YAGNI for v1).

## 6. New Hub routes (4) and config

### 6.1 `POST /admin/runs/start`

Request:
```json
{ "project_path": "/abs/path", "iter": 3 }
```

Validation:
- `project_path` is absolute, exists, is a directory, no `..` after
  resolution, and (if `HUB_RUNNER_PATH_PREFIX` env is set) starts with
  one of the allowed prefixes (comma-separated). When unset, defaults
  to allowing user's `$HOME` + `/tmp`.
- `iter` is 1-10 integer; default 3.
- `D2P_RUNNER_ENABLED=1` required; otherwise 503.
- `D2P_RUNNER_MINIMAX_API_KEY` set on Hub env; otherwise 503 with
  `runner_not_configured`.
- `D2P_PATH` resolves to a directory containing `run.py`; otherwise
  500 with `d2p_path_invalid`.
- RunSupervisor.acquire() succeeds; otherwise 409 with
  `run_already_in_flight` (+ the id of the in-flight run).

Response:
```json
{ "run_id": "<uuid>", "pid": 12345, "stdout_log": "<run_id>.log" }
```

200 returns immediately after spawn; the subprocess runs in the
background.

### 6.2 `GET /admin/runs/:id/stdout?from=<bytes>`

Returns:
```json
{ "content": "<utf8 chunk>", "next_offset": 12345, "eof": false }
```

`eof: true` once the subprocess has exited AND we've returned everything
up to current file size. Page stops polling on eof.

Implementation: open file with O_RDONLY, seek to `from`, read up to
1 MB, return. Cheap.

### 6.3 `GET /admin/runs/current`

Read-only sibling of `/admin/runs/start`. Returns the supervisor's current
active run so the page can reattach on reload:

```json
{ "run_id": "<uuid>", "pid": 12345, "project_path": "/abs/path",
  "started_at": "2026-05-25T10:00:00Z" }
```

Returns `{ "run_id": null }` when nothing is in flight. Used by
`stores/runner.ts` on page mount.

### 6.4 `POST /admin/runs/:id/push-github`

Request:
```json
{
  "remote_url": "git@github.com:user/repo.git",
  "branch": "main",
  "commit_message": "feat: d2p iteration 3 (cost $0.34)"
}
```

Validation:
- run exists, run.terminal_state is non-null (refuse if RUNNING).
- `remote_url` matches a permissive whitelist: `git@github.com:.+/.+\.git$`
  or `https://github\.com/.+/.+(\.git)?$`. Refusing wildcards keeps the
  feature scoped to GitHub; other remotes can be a follow-up.
- `branch` is `[A-Za-z0-9._/-]+`, length 1-100.
- `commit_message` is non-empty, max 4 KB.

Response (streaming text or chunked JSON — pick whichever is easier in
Hono; default to one JSON blob since output is small):
```json
{
  "steps": [
    { "cmd": "git init", "exit": 0, "output": "..." },
    { "cmd": "git add -A", "exit": 0, "output": "" },
    { "cmd": "git commit -m ...", "exit": 0, "output": "[main abc1234]..." },
    { "cmd": "git remote set-url origin ...", "exit": 0, "output": "" },
    { "cmd": "git push -u origin main", "exit": 0, "output": "..." }
  ],
  "ok": true,
  "remote_html": "https://github.com/user/repo"
}
```

`ok: false` on any non-zero exit; the page renders steps up to the
failure and surfaces the stderr.

### 6.5 Configuration (env)

| Var | Required | Default | Purpose |
|---|---|---|---|
| `D2P_RUNNER_ENABLED` | yes | unset (off) | Feature gate. Routes 503 when off. |
| `D2P_PATH` | yes when on | none | Absolute path to the d2p repo (containing `run.py`). |
| `D2P_RUNNER_MINIMAX_API_KEY` | yes when on | none | Injected into subprocess env. |
| `D2P_RUNNER_INSTANCE_TOKEN` | yes when on | none | The Hub instance token (`HUB_TOKEN` printed by `pnpm hub:seed`) that d2p uses when pushing events. Operator sets this once during initial setup; Hub does NOT pull from the DB. |
| `HUB_RUNNER_PATH_PREFIX` | no | `$HOME,/tmp` | Comma-separated allowed path prefixes. |
| `HUB_DATA_DIR` | no | dirname(`HUB_DB_PATH`) | Where `runner-logs/` lives. |

## 7. RunSupervisor lifecycle

Singleton class in `src/hub/runner/supervisor.ts`. State:

```ts
interface ActiveRun {
  runId: string;
  pid: number;
  child: ChildProcess;
  stdoutPath: string;
  projectPath: string;
  startedAt: number;
}
```

API:
- `acquire(runId, projectPath, spawnOpts)`: throws if `current != null`.
  Spawns the subprocess, registers `child.on('exit', ...)`, returns the
  ActiveRun.
- `current()`: returns the ActiveRun | null.
- `tryReattach(runId)`: returns the ActiveRun if it matches the currently
  active run; null otherwise. Used by the page when reopening to verify
  "this run is still mine".
- `shutdown()`: called by Hub's signal handler; sends SIGTERM to the
  child.

Child exit handler:
1. Log exit code to stdout.log (appended as `[supervisor] exit=N`).
2. If the corresponding `runs` row has `terminal_state IS NULL` (i.e., d2p
   never pushed `run_terminated` — crashed mid-flight), insert a synthetic
   `run_terminated` event with `terminal_state='crashed'` so the page
   stops polling and the runs list doesn't show a perpetual RUNNING ghost.
3. `current = null`.

## 8. Frontend (Vue 3)

New files in `site/src/`:
- `views/Iterate.vue` — top-level page.
- `composables/useRunner.ts` — wraps the 3 new endpoints + the run-state
  polling logic. Returns reactive `{ status, currentRun, iterations,
  stdoutTail, error }`.
- `stores/runner.ts` (Pinia) — holds the current run id across HMR /
  navigation. Hydrated from `RunSupervisor.current()` on mount via a
  `GET /admin/runs/current` helper route (read-only sibling of
  `/admin/runs/start`).
- Router entry in `site/src/router/index.ts` adding `/iterate` →
  `Iterate.vue` behind the existing admin-token guard.

Polling is plain `setInterval(..., 2000)` cleared on unmount. No SSE
in MVP — events arrive every several seconds anyway and stdout tail
polling at 2 s is plenty.

State machine in the page (reactive `phase` ref):
```
'setup'  ─→ 'starting'  ─→ 'running'  ─→ 'terminal'  ─→ 'pushing'  ─→ 'pushed' | 'push_failed'
                              │
                              └──→ 'crashed'
```

The Setup form's "Run d2p" button is disabled when `phase !== 'setup'`.
The Push panel renders only when `phase === 'terminal'` or later.

## 9. d2p side · the one external change

`d2p/orchestrator.py`:
```python
# Currently:
run_id = str(uuid.uuid4())
# Becomes:
run_id = os.environ.get("D2P_RUN_ID") or str(uuid.uuid4())
```

No other d2p changes. The HubClient already takes `HUB_URL` / `HUB_TOKEN`
from env, the providers already pick up `MINIMAX_API_KEY` from env.

## 10. Security

- All 4 new routes are behind `adminAuth(opts.adminToken)`, same
  middleware as `/admin/learner/*`.
- `D2P_RUNNER_ENABLED` is a hard gate. Default off — a default Hub
  deployment cannot launch subprocesses.
- Path validation rejects `..` after `path.resolve()` and enforces
  prefix whitelist. `/etc`, `/usr`, `/System`, anything outside the
  whitelist is refused.
- API keys never travel through the browser. The frontend can't
  set or read them.
- `remote_url` is whitelist-regex'd to GitHub only. Pushing to arbitrary
  git remotes from a web UI is a footgun.
- The subprocess inherits a minimal env — only `PATH`, `HOME`, `LANG`,
  the d2p-specific keys, and `D2P_RUN_ID`. No `HUB_ADMIN_TOKEN` leak.

## 11. Failure modes & UX

| Failure | Detection | UX |
|---|---|---|
| d2p subprocess crashes | child.exit code != 0, terminal_state still null in DB | Page shows "Run crashed" + stdout tail. Push panel disabled. |
| d2p hangs (no events for >5 min) | Page detects no iteration progress for 5 min | Show a "stuck?" banner with a "Kill run" button → `POST /admin/runs/:id/kill` (SIGTERM the supervisor's child). |
| Hub itself restarts mid-run | Supervisor.shutdown() SIGTERMs child; on restart, supervisor is empty | Reopening page sees no active run; the orphaned `runs` row is detectable (no exit event ever arrived) — future improvement, not MVP. |
| `git push` fails (auth, conflict) | Push route returns `ok: false` | Page shows the failed step's stderr verbatim. User fixes (e.g., adds SSH key, resolves conflict) and clicks Push again. |
| Path outside whitelist | 400 from `/admin/runs/start` | Setup form shows "path not allowed: must start with one of <list>". |
| Run already in flight | 409 from start | Setup form shows "another run is in progress" + link to its progress page. |

## 12. Testing

Backend (vitest, same pattern as existing `routes.admin.*.test.ts`):
- `routes.runs.start.test.ts`: 403 (no token), 503 (runner disabled),
  503 (no MINIMAX key), 400 (bad path), 400 (path escapes whitelist),
  409 (run in flight), 200 happy path with a stubbed spawn that returns
  immediately.
- `routes.runs.stdout.test.ts`: 404 for unknown id, returns content+offset,
  eof=true after child exits.
- `routes.runs.pushgithub.test.ts`: refuse when run still RUNNING, refuse
  bad remote_url, happy path with stubbed `execFile`.
- `runner.supervisor.test.ts`: acquire fails when in-flight, shutdown
  SIGTERMs child, exit handler marks orphaned runs as `crashed`.

Frontend: defer test coverage for v1 (the site/ codebase is tested
lightly today — adding component tests for one new page is out of scope
for this MVP). Manual smoke list documented in v1 acceptance criteria.

## 13. Acceptance criteria

For the PR to merge:
- All new vitest tests pass; full Hub suite stays green.
- Manual smoke (operator runs once on a tiny demo project):
  1. Setup → Run → Progress shows iters incrementing → Push panel
     appears.
  2. Tail shows d2p stdout updating without manual refresh.
  3. Push to a throwaway GitHub repo succeeds; remote_html link opens
     in a new tab.
  4. Killing Hub mid-run is observable: re-opening the page after
     restart shows the orphaned run as crashed, not RUNNING.
- `D2P_RUNNER_ENABLED` unset → all 4 routes 503. (Default-safe.)

## 14. Out of scope (explicit)

- Auto-create GitHub repo via `gh`. Defer to a future "create new" tab.
- Diff preview before push.
- Multi-run queue.
- Verify panel.
- `--no-qa`, `--reanalyze-every`, `--verify-enabled` toggles in UI.
- Auto-prune of `runner-logs/`.
- Cross-platform path handling (Windows). MVP is mac+linux.

## 15. File list (rough)

**New (this repo, MatrixOmnix-Hub):**
- `src/hub/runner/supervisor.ts` (~120 lines)
- `src/hub/routes/runs_runner.ts` (~180 lines — the 4 new routes)
- `site/src/views/Iterate.vue` (~280 lines)
- `site/src/composables/useRunner.ts` (~90 lines)
- `site/src/stores/runner.ts` (~30 lines)
- `tests/hub/routes.runs.start.test.ts`
- `tests/hub/routes.runs.stdout.test.ts`
- `tests/hub/routes.runs.pushgithub.test.ts`
- `tests/hub/runner.supervisor.test.ts`

**Modified (this repo):**
- `src/hub/server.ts` — wire the new route block, add `runner: supervisor`
  to AppOpts.
- `src/hub/index.ts` — instantiate RunSupervisor, register SIGTERM
  handler.
- `src/hub/config.ts` — read the new env vars.
- `site/src/router/index.ts` — `/iterate` route.

**Modified (d2p):**
- `d2p/orchestrator.py` — single line: `run_id = os.environ.get("D2P_RUN_ID") or str(uuid.uuid4())`.

Total: ~700 lines net new code + tests, plus 1 line in d2p.
