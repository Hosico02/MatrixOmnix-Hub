# Hub `/runs/:id` 日志 tab — v0 design

**Date:** 2026-05-26
**Author:** session 9
**Status:** draft, awaiting user review
**Implementation repo:** `Hosico02/MatrixOmnix-Hub` (this repo)

## 1. Purpose

The operator wants to see the logs of any d2p run, at any time — not only
the live tail visible during an /iterate run. Currently:

- During an /iterate run, the page streams stdout from
  `<hubDataDir>/runner-logs/<run_id>.log`. As soon as the run terminates
  or the operator navigates away, that view is gone.
- After-the-fact, `/runs/:id` shows the structured timeline (analyzer /
  planner / executor summaries, verdicts, findings) but no raw stdout.
- For external d2p runs (Hub receives push_event but didn't spawn the
  process), there is no stdout file at all — only the structured events.

This feature adds a "日志" tab on `/runs/:id` showing a milestone timeline
(left) and the raw stdout viewer (right), live for active runs and
static for finished ones, gracefully degraded for external runs.

## 2. Scope

**In:**

- A new tab on `RunDetail.vue` ("概览" / "日志" / "备注"). 概览 and 备注
  are the current page content split into two of the tabs; 日志 is the
  new content.
- 日志 tab content: 2-column layout (desktop) / stacked (mobile) with
  milestone timeline on the left and raw stdout viewer on the right.
- Milestones derived from the existing `/runs/:id` payload (no new
  endpoint).
- Raw stdout fetched via the existing `/admin/runs/:id/stdout?from=N`
  endpoint.
- 2s polling for live runs (Hub-spawned + `run.terminated_at` null), stop
  on `eof=true`.
- "Jump to log" buttons per milestone — best-effort scroll into the
  right-pane stdout (timestamp pattern match + linear-fallback).
- Admin token re-use: same gate UX as `/iterate`. Logs tab requires
  admin token; if not set or rejected, surface inline re-entry.
- Graceful "no log available" state for external runs.
- ~10 unit tests in `site/`'s vitest suite (composable state machine,
  milestone derivation, jump helper).

**Out (deferred):**

- ANSI color parsing
- Full-text search / regex filter inside stdout
- Per-line server-side timestamp injection (better jump precision)
- A separate top-level `/logs` route browsing across runs
- Log download button
- Log retention policy (deleting old stdout files)
- SSE / WebSocket push (continues to use 2s polling — same as /iterate)

## 3. Backend

**No new endpoints.** Reuse:

- `GET /runs/:id` — already returns `{run, iterations, verdicts,
  findings, notes}` with snake_case JSON keys.
  `iterations[].started_at` / `ended_at` + `iter_n` + `analyzer_summary`
  / `planner_summary` / `executor_summary` cover all the milestone
  fields we need.
- `GET /admin/runs/:id/stdout?from=N` — already returns
  `{content, next_offset, eof}` or 404 `{error: 'log_not_found'}`.
  Already gated behind `adminAuth`.

The 日志 tab uses both. Admin gate state is shared with `/iterate` via
the existing pinia store.

## 4. UI shape

### 4.1 Tab container

`RunDetail.vue` becomes a tab container:

```
┌─────────────────────────────────────────────────┐
│ [概览]  [日志]  [备注]                          │
├─────────────────────────────────────────────────┤
│  (active tab content)                           │
└─────────────────────────────────────────────────┘
```

- "概览": current header (status badge + project + archetype + iteration
  count + cost + timestamps) and the "d2p 这次都做了什么" section (per-iter
  summaries + verdicts + findings). Unchanged content, just relocated
  under this tab.
- "日志": new content (§4.2).
- "备注": current notes section + add-note textarea. Unchanged content,
  relocated.

Default tab on mount: 概览. URL hash (`#logs`, `#notes`) is honored on
direct deep-link so refresh preserves position.

### 4.2 日志 tab content

Desktop (viewport ≥ md): horizontal split, ~40/60 width.
Mobile (< md): vertical stack, milestones on top, stdout below.

```
┌──────────────────┬────────────────────────────────┐
│ Milestones        │ Raw stdout                     │
│ • 16:00:00        │ ┌────────────────────────────┐ │
│   run_started     │ │ [LLM] analyzer started     │ │
│   project=foo     │ │ ...                        │ │
│   [跳过去]        │ │                            │ │
│ • 16:00:42        │ │                            │ │
│   iter 1 完成     │ │ (mono, scrollable, ~600px) │ │
│   analyzer: …     │ │                            │ │
│   planner:  …     │ │                            │ │
│   executor: …     │ │                            │ │
│   [跳过去]        │ │                            │ │
│ • 16:03:55        │ └────────────────────────────┘ │
│   run_terminated  │  ▸ 自动滚动 ☑  ▸ 大小 1.2 KB    │
│   verdict=CLEAN   │  ▸ 已读 1.2 KB / 1.2 KB        │
└──────────────────┴────────────────────────────────┘
```

### 4.3 Milestone derivation (pure function)

Input: `/runs/:id` payload. Output: ordered list of `Milestone`:

```ts
type Milestone = {
  id: string;             // stable: "start" | "iter:<id>" | "term"
  kind: "start" | "iter" | "term";
  ts: string;             // ISO timestamp
  title: string;          // "run_started" | "第 N 轮 完成" | "run_terminated"
  subtitle?: string;      // project basename / 3-line summary / terminal_state
  iterId?: string;
};
```

Rules:

1. Always emit `{kind: "start", ts: run.started_at, title: "run_started",
   subtitle: project basename}`.
2. For each iteration in `iterations` (ordered by `iter_n` ascending):
   - `ts`: `iteration.ended_at ?? iteration.started_at`
   - `title`: `第 ${iter_n} 轮 完成` if `ended_at` else `第 ${iter_n} 轮 进行中`
   - `subtitle`: first ≤ 80 chars of each of `analyzer_summary` /
     `planner_summary` / `executor_summary` present, joined by ` · `
3. If `run.terminated_at` not null: emit `{kind: "term",
   ts: run.terminated_at, title: "run_terminated",
   subtitle: run.terminal_state}`.

Tests cover empty-iterations, all-fields-present, partial summaries,
in-progress (no endedAt), null terminated_at.

### 4.4 Stdout viewer

- Container: `<div>` with `whiteSpace: pre`, `font-family: monospace`,
  fixed height (`max-h-[600px] overflow-y-auto`), `font-size: 12px`.
- Above: status bar with three indicators:
  - `自动滚动 ☑` checkbox (default on for live; off for finished)
  - `大小 N KB` (= `next_offset` formatted)
  - `已读 N KB / N KB` (loaded vs total size for very large logs)
- Polling state machine (composable `useRunLogs`):
  - States: `idle | loading | streaming | eof | error | no_log | needs_token`
  - `mounted` (tab activated) → `loading`
  - 200 + content → push to buffer, update offset
  - `eof=true` → state `eof`, stop poll
  - `eof=false` + content → schedule next poll in 2000ms
  - 404 → state `no_log`
  - 401/403 → state `needs_token`
  - Other error → state `error`, show inline error + retry button
- Auto-scroll behavior: when checkbox is on and new content arrives,
  scroll container to bottom. If user manually scrolls up (detected by
  `scrollTop + clientHeight < scrollHeight - 20`), auto-uncheck the
  checkbox (no jitter loop).

### 4.5 Jump-to-log

Each milestone has a `[跳过去]` button. Click handler:

```ts
function jumpToMilestone(m: Milestone, stdout: string) {
  // 1. Try timestamp pattern match in stdout
  const tsPatterns = [
    m.ts,                                          // full ISO
    m.ts.slice(11, 19),                            // HH:MM:SS
    m.ts.slice(0, 19),                             // YYYY-MM-DDTHH:MM:SS
  ];
  for (const p of tsPatterns) {
    const idx = stdout.indexOf(p);
    if (idx !== -1) return scrollToCharOffset(idx);
  }
  // 2. Fallback: linear map by milestone position
  const fraction = milestoneFractionInTimeline(m);
  return scrollToCharOffset(Math.floor(stdout.length * fraction));
}
```

`milestoneFractionInTimeline(m)` = milestone's index ÷ total milestones.

Best-effort; acceptable ±5-20 line jitter on fallback. Tests cover
timestamp-present and fallback paths.

## 5. Data flow

```
RunDetail mounts
  │
  ├─ load() → fetch /runs/:id ──► render 概览 tab + derive milestones
  │
  ├─ user clicks 日志 tab
  │    │
  │    ├─ check store.adminToken
  │    │    │
  │    │    ├─ unset → state needs_token, show token gate (same component
  │    │    │           used in /iterate)
  │    │    │
  │    │    └─ set → useRunLogs.start(runId, token)
  │    │             │
  │    │             ├─ fetch /admin/runs/:id/stdout?from=0
  │    │             │   ├─ 200 → append, schedule next if !eof
  │    │             │   ├─ 404 → state no_log
  │    │             │   └─ 401/403 → state needs_token, store.resetToken()
  │    │             │
  │    │             └─ if !eof → repeat every 2s with from=next_offset
  │    │
  │    └─ also: if !run.terminated_at, every 30s refetch /runs/:id to
  │       refresh milestones (so "iter N 进行中" → "iter N 完成" updates)
  │
  └─ leave tab or unmount → useRunLogs.stop() (clear interval)
```

## 6. Edge cases

| Case | Behavior |
|---|---|
| Run not found | `/runs/:id` 404 already handled, sticks with current behavior |
| Hub restart, live run becomes orphan | `eof=true` returned by stdout endpoint (supervisor no longer tracks this run); auto-stop polling; status bar shows "日志已结束" |
| stdout file > 10MB | First fetch returns 1MB chunk per existing chunkSize cap. Composable keeps requesting until `next_offset >= size` before idle. Status bar shows progress |
| User has /iterate streaming the same run AND opens /runs/:id 日志 tab | Two independent polls, no shared buffer. Redundant but safe |
| Finished run, then user opens 日志 tab | First fetch returns all content with `eof=true`; no polling started |
| Wrong admin token | poll request returns 401/403 → state `needs_token`, store.resetToken(), inline re-entry |
| Iteration's `ended_at` is null but run terminated (orphan iter) | Use `started_at` for `ts`; if both null, use `run.terminated_at` |
| ANSI escape sequences in stdout | v0 displays raw (e.g. `[31m` visible as text). Spec'd explicitly |
| Fallback jump jitter | Accept ±5-20 line miss. Not corrected |

## 7. Tests

`site/` vitest tests, all pure / mocked:

- `useRunLogs` state machine: idle → loading → streaming → eof; 404 → no_log; 401 → needs_token; offset advance; 2s schedule
- `deriveMilestones(/runs/:id payload)`: 5 cases (empty iters; full; partial summaries; in-progress; missing ended_at fallback)
- `jumpToMilestone(...)`: timestamp-match path + linear-fallback path

~10 tests total. No new backend tests (no new backend code).

Manual smoke (not automated):

- Open /iterate, kick off a tiny run, navigate to /runs/:id 日志 tab mid-run, verify left timeline updates, right stdout streams, jump-to-log buttons land in reasonable vicinity.
- After run terminates, refresh page, verify static load + no polling.
- Open a run that Hub received via push_event only (no spawn — could simulate by inserting a runs row via DB tool), verify the "no log" empty state.

## 8. Commit plan

3 commits:

1. `refactor(site): RunDetail tabs (概览/日志/备注) shell` — pure
   structure change; existing sections move under tabs; new 日志 tab is
   empty placeholder. No new logic. Hash routing on tab activation.
2. `feat(site): useRunLogs composable + milestone derivation + jump helper` —
   the three pure-ish units + their vitest tests.
3. `feat(site): 日志 tab UI — milestone list, stdout viewer, live polling` —
   wires the composable + helpers into the 日志 tab; reuses /iterate's
   admin token gate component.

## 9. Out of scope (explicit non-goals)

- ANSI color parsing
- Full-text search / regex filter
- Server-side per-line timestamp injection
- A separate top-level `/logs` page browsing across runs
- Log download button (operator copies via browser select)
- Log retention policy (when to delete old runner-logs/*.log files)
- SSE / WebSocket push

## 10. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Linear-fallback jump lands far from the right place on long logs | medium | low | Accept; clearly best-effort; better fix needs server-side line timestamps which is deferred |
| Stdout files grow unbounded under heavy /iterate usage | high (long term) | medium | Out of scope for v0; track as separate ops ticket |
| Pinia store admin token already used by /iterate — race if both pages open and token rotates | low | low | Both pages use same store; rotation invalidates both consistently |
| Hash-based tab routing collides with future deep-link patterns (e.g. anchors inside sections) | low | low | Reserve `#overview`, `#logs`, `#notes` as tab anchors; document explicitly |
| 2-column layout cramped on mid-width screens (768-1024px) | medium | low | Mobile breakpoint at md = 768px keeps it stacked; desktop ≥ md gets the split |

---

End of design. Ready for user review; on approval, advance to writing-plans.

---

**Follow-up**: external (non-Hub-spawned) d2p runs are made visible by
`2026-05-27-hub-d2p-log-integration-design.md`. No frontend changes;
backend-only.

