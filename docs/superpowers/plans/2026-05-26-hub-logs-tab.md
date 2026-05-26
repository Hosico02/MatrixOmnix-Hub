# Hub /runs/:id 日志 tab — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "日志" tab to `/runs/:id` showing a milestone timeline (left) + raw stdout viewer (right), live polling for active runs, static for finished, with admin-token gate reused from `/iterate`.

**Architecture:** Refactor `RunDetail.vue` into a tab container (`#overview`, `#logs`, `#notes`). New `日志` tab is wired via three new units: a pure milestone derivation function, a pure jump-target helper, and a `useRunLogs` composable that owns the polling state machine. All three are unit-tested under `tests/site/` (the site's first vitest tests).

**Tech Stack:** Vue 3 SFC, TypeScript, Pinia, vitest (node env, fake timers + mocked fetch).

**Spec:** `docs/superpowers/specs/2026-05-26-hub-logs-tab-design.md` (this repo).

**Implementation repo:** `Hosico02/MatrixOmnix-Hub` at the current working tree.

**Final commits (per spec §8):**

1. `refactor(site): RunDetail 拆 tabs (概览/日志/备注) + 日志 tab 骨架`
2. `feat(site): useRunLogs composable + milestone derivation + jump helper`
3. `feat(site): 日志 tab UI — milestone list, stdout viewer, live polling`

---

## File map

**New files:**

- `site/src/lib/milestones.ts` — `deriveMilestones(payload)`; pure function, no DOM
- `site/src/lib/jump.ts` — `findStdoutOffsetFor(ts, stdout)` + `milestoneFractionInTimeline`; pure functions
- `site/src/composables/useRunLogs.ts` — polling state machine
- `site/src/views/run-detail/OverviewTab.vue` — extracted from existing RunDetail body (header + d2p timeline)
- `site/src/views/run-detail/NotesTab.vue` — extracted notes section
- `site/src/views/run-detail/LogsTab.vue` — new 日志 tab content
- `site/src/views/run-detail/TokenGate.vue` — small extracted component for admin token gate (reused from Iterate.vue's inline gate). v0 minimum: copy the pattern; don't refactor Iterate.vue.
- `tests/site/milestones.test.ts` — 5 cases for deriveMilestones
- `tests/site/jump.test.ts` — 3 cases for jump helper
- `tests/site/useRunLogs.test.ts` — ~5 cases for the composable state machine

**Modified files:**

- `site/src/views/RunDetail.vue` — gutted into a tab container; pulls in the three tab subcomponents
- `site/src/api.ts` — add `adminApi.stdout` if not already exported (it is — verified at api.ts:82)
- `vitest.config.ts` — add `'tests/site/**/*.test.ts'` to `include` (alongside `tests/**/*.test.ts`; `tests/site/` is already covered by the existing glob, but we'll need `environment: 'node'` to remain fine and `setupFiles` not to interfere — verify)

**Not touched:**

- Any `src/hub/...` (no backend changes — spec §3 confirms)
- `site/src/composables/useRunner.ts` (used by /iterate; out of scope)

---

## Phase 1 · Tab shell refactor

Goal: split `RunDetail.vue` into a tab container hosting three subviews. Preserve all current functionality (header + d2p timeline + notes). The new 日志 tab is a placeholder ("日志功能开发中…").

### Task 1.1: Extract Overview tab content

**Files:**
- Create: `site/src/views/run-detail/OverviewTab.vue`

- [ ] **Step 1: Create the file with the lifted content**

```vue
<script setup lang="ts">
import StatusBadge from '../../components/StatusBadge.vue';
import HumanLabel from '../../components/HumanLabel.vue';

const props = defineProps<{ data: any }>();

function fmt(s?: string | null) {
  return s ? new Date(s).toLocaleString('zh-CN') : '—';
}
function iterVerdicts(itId: string) {
  return (props.data?.verdicts ?? []).filter((v: any) => v.iteration_id === itId);
}
function verdictFindings(vId: string) {
  return (props.data?.findings ?? []).filter((f: any) => f.verdict_id === vId);
}
</script>

<template>
  <div class="space-y-6">
    <header class="bg-white border rounded-lg p-4 space-y-2">
      <div class="flex items-center gap-3">
        <StatusBadge :state="data.run.terminal_state" />
        <span class="font-bold text-lg">{{ data.run.project_path.split('/').pop() }}</span>
      </div>
      <div class="text-sm text-gray-600">
        <HumanLabel kind="archetype" :id="data.run.detected_archetype" /> ·
        {{ data.run.total_iterations }} 轮 · 用了 ¥{{ ((data.run.total_cost_usd || 0) * 7).toFixed(2) }}
        · {{ fmt(data.run.started_at) }} → {{ fmt(data.run.terminated_at) }}
      </div>
    </header>

    <section class="bg-white border rounded-lg p-4">
      <h3 class="font-semibold mb-2">d2p 这次都做了什么</h3>
      <div v-for="it in data.iterations" :key="it.id" class="border-l-2 border-gray-200 pl-3 mb-3">
        <div class="text-sm font-medium">第 {{ it.iter_n }} 轮</div>
        <div v-if="it.analyzer_summary" class="text-xs text-gray-600">
          分析: {{ it.analyzer_summary }}
        </div>
        <div v-if="it.planner_summary" class="text-xs text-gray-600">
          计划: {{ it.planner_summary }}
        </div>
        <div v-if="it.executor_summary" class="text-xs text-gray-600">
          执行: {{ it.executor_summary }}
        </div>
        <div v-for="v in iterVerdicts(it.id)" :key="v.id">
          <div class="text-sm mt-1">检查: {{ v.verdict }}<span v-if="v.confidence"> (置信度 {{ v.confidence.toFixed(2) }})</span></div>
          <ul class="ml-4 text-sm space-y-1 mt-1">
            <li v-for="f in verdictFindings(v.id)" :key="f.id">
              · <HumanLabel kind="finding" :id="f.category" />
              <span class="text-gray-500">
                (<HumanLabel kind="severity" :id="f.severity" />)
              </span>
              <div v-if="f.evidence" class="text-xs text-gray-500 ml-4">{{ f.evidence }}</div>
            </li>
          </ul>
        </div>
      </div>
    </section>
  </div>
</template>
```

### Task 1.2: Extract Notes tab content

**Files:**
- Create: `site/src/views/run-detail/NotesTab.vue`

- [ ] **Step 1: Create the file with the lifted notes section**

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { api } from '../../api';

const props = defineProps<{ data: any; runId: string }>();
const emit = defineEmits<{ (e: 'reload'): void }>();

const newNote = ref('');
const submitting = ref(false);

function fmt(s?: string | null) {
  return s ? new Date(s).toLocaleString('zh-CN') : '—';
}

async function addNote() {
  if (!newNote.value.trim()) return;
  submitting.value = true;
  try {
    await api.addRunNote(props.runId, newNote.value);
    newNote.value = '';
    emit('reload');
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <section class="bg-white border rounded-lg p-4">
    <h3 class="font-semibold mb-2">备注</h3>
    <ul class="space-y-1 mb-2 text-sm">
      <li v-for="n in data.notes" :key="n.id">
        <span class="text-gray-500">[{{ n.author === 'human' ? '你' : '自动' }} · {{ fmt(n.created_at) }}]</span>
        {{ n.body_md }}
      </li>
    </ul>
    <textarea v-model="newNote" rows="2"
              class="w-full border rounded p-2 text-sm"
              placeholder="加一条备注…"></textarea>
    <button @click="addNote" :disabled="submitting"
            class="mt-1 px-3 py-1 bg-blue-600 text-white rounded text-sm">
      加备注
    </button>
  </section>
</template>
```

### Task 1.3: Logs tab placeholder

**Files:**
- Create: `site/src/views/run-detail/LogsTab.vue`

- [ ] **Step 1: Placeholder until Phase 3 wires it**

```vue
<script setup lang="ts">
defineProps<{ data: any; runId: string }>();
</script>

<template>
  <div class="bg-white border rounded-lg p-4 text-sm text-gray-500">
    日志功能开发中…
  </div>
</template>
```

### Task 1.4: Convert RunDetail.vue into a tab container

**Files:**
- Modify: `site/src/views/RunDetail.vue` (replace entire file)

- [ ] **Step 1: Rewrite as tab container**

```vue
<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api';
import OverviewTab from './run-detail/OverviewTab.vue';
import LogsTab from './run-detail/LogsTab.vue';
import NotesTab from './run-detail/NotesTab.vue';

const route = useRoute();
const router = useRouter();
const data = ref<any>(null);

type TabKey = 'overview' | 'logs' | 'notes';
const VALID_TABS: TabKey[] = ['overview', 'logs', 'notes'];

function tabFromHash(): TabKey {
  const h = (route.hash || '').replace(/^#/, '');
  return (VALID_TABS as string[]).includes(h) ? (h as TabKey) : 'overview';
}

const active = ref<TabKey>(tabFromHash());

watch(() => route.hash, () => { active.value = tabFromHash(); });

function select(k: TabKey) {
  active.value = k;
  router.replace({ hash: `#${k}` });
}

async function load() {
  data.value = await api.getRun(route.params.id as string);
}
onMounted(load);

const runId = computed(() => route.params.id as string);
</script>

<template>
  <div v-if="data" class="space-y-4">
    <button @click="router.back()" class="text-sm text-gray-500 hover:underline">← 返回</button>

    <nav class="flex gap-1 border-b">
      <button v-for="k in (['overview','logs','notes'] as const)"
              :key="k"
              @click="select(k)"
              :class="[
                'px-3 py-2 text-sm border-b-2 -mb-px',
                active === k
                  ? 'border-blue-600 text-blue-700 font-medium'
                  : 'border-transparent text-gray-600 hover:text-gray-900',
              ]">
        {{ k === 'overview' ? '概览' : k === 'logs' ? '日志' : '备注' }}
      </button>
    </nav>

    <OverviewTab v-if="active === 'overview'" :data="data" />
    <LogsTab v-else-if="active === 'logs'" :data="data" :run-id="runId" />
    <NotesTab v-else-if="active === 'notes'" :data="data" :run-id="runId" @reload="load" />
  </div>
  <div v-else class="text-sm text-gray-500">加载中…</div>
</template>
```

### Task 1.5: Smoke test the refactor

- [ ] **Step 1: Build the site**

Run: `pnpm -C site build`
Expected: no TypeScript errors, no Vue compile errors. Build completes.

- [ ] **Step 2: Hub dev smoke**

Run: `pnpm dev` from repo root (or use existing `pnpm hub:dev` if you have a live Hub).

Open `http://localhost:<hub-port>/runs/<some-id>` for an existing run. Verify:
- The three tab buttons render
- Clicking each switches content with no console errors
- URL hash updates (`#overview`, `#logs`, `#notes`)
- Hard-refresh on `#logs` lands on logs tab directly (hash routing works)
- 概览 and 备注 tabs show the same content as before the refactor
- 日志 tab shows the "日志功能开发中…" placeholder

If you don't have a live Hub to point at, skip Step 2 — the build success from Step 1 is sufficient. Note in your report.

### Task 1.6: Commit Phase 1

- [ ] **Step 1: Stage and commit**

```bash
git add site/src/views/RunDetail.vue \
        site/src/views/run-detail/
git commit -m "$(cat <<'EOF'
refactor(site): RunDetail 拆 tabs (概览/日志/备注) + 日志 tab 骨架

Pure structure change: existing header + d2p timeline section becomes
OverviewTab; notes section becomes NotesTab; new LogsTab is a
placeholder pending Phase 2/3 wiring. RunDetail.vue is now a thin tab
container with hash-routed activation (#overview / #logs / #notes).

No behavior change for the 概览 and 备注 tabs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2 · Pure logic + composable + tests

Goal: write `deriveMilestones`, `findStdoutOffsetFor`, and `useRunLogs`. All three have vitest coverage in `tests/site/`. No UI changes in this phase.

### Task 2.1: Write deriveMilestones tests (failing)

**Files:**
- Create: `tests/site/milestones.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
import { describe, it, expect } from 'vitest';
import { deriveMilestones, type Milestone } from '../../site/src/lib/milestones';

const baseRun = {
  id: 'r1',
  project_path: '/tmp/demo',
  detected_archetype: 'python-cli',
  started_at: '2026-05-26T10:00:00Z',
  terminated_at: null as string | null,
  terminal_state: null as string | null,
  total_cost_usd: 0,
  total_iterations: 0,
};

describe('deriveMilestones', () => {
  it('emits run_started only when no iterations and run still running', () => {
    const out = deriveMilestones({
      run: baseRun, iterations: [], verdicts: [], findings: [], notes: [],
    });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('start');
    expect(out[0].ts).toBe('2026-05-26T10:00:00Z');
    expect(out[0].subtitle).toBe('demo');
  });

  it('emits start + per-iteration completed + terminated for a 2-iter clean run', () => {
    const out = deriveMilestones({
      run: { ...baseRun,
        terminated_at: '2026-05-26T10:05:00Z',
        terminal_state: 'CLEAN',
      },
      iterations: [
        { id: 'i1', iter_n: 1, started_at: '2026-05-26T10:00:30Z',
          ended_at: '2026-05-26T10:02:00Z',
          analyzer_summary: 'detected Python CLI', planner_summary: 'split into 3 tasks',
          executor_summary: 'wrote tests', qa_summary: null },
        { id: 'i2', iter_n: 2, started_at: '2026-05-26T10:02:10Z',
          ended_at: '2026-05-26T10:04:50Z',
          analyzer_summary: null, planner_summary: null,
          executor_summary: 'fixed README', qa_summary: null },
      ],
      verdicts: [], findings: [], notes: [],
    });
    expect(out.map((m) => m.kind)).toEqual(['start', 'iter', 'iter', 'term']);
    expect(out[1].ts).toBe('2026-05-26T10:02:00Z');
    expect(out[1].title).toBe('第 1 轮 完成');
    expect(out[1].subtitle).toContain('detected Python CLI');
    expect(out[1].subtitle).toContain('split into 3 tasks');
    expect(out[1].subtitle).toContain('wrote tests');
    expect(out[3].subtitle).toBe('CLEAN');
  });

  it('marks an iteration in progress when ended_at is null', () => {
    const out = deriveMilestones({
      run: baseRun,
      iterations: [
        { id: 'i1', iter_n: 1, started_at: '2026-05-26T10:00:30Z', ended_at: null,
          analyzer_summary: null, planner_summary: null, executor_summary: null,
          qa_summary: null },
      ],
      verdicts: [], findings: [], notes: [],
    });
    expect(out[1].title).toBe('第 1 轮 进行中');
    expect(out[1].ts).toBe('2026-05-26T10:00:30Z');
  });

  it('truncates each summary line to 80 chars and joins with " · "', () => {
    const long = 'x'.repeat(200);
    const out = deriveMilestones({
      run: baseRun,
      iterations: [
        { id: 'i1', iter_n: 1, started_at: '2026-05-26T10:00:30Z',
          ended_at: '2026-05-26T10:02:00Z',
          analyzer_summary: long, planner_summary: long, executor_summary: long,
          qa_summary: null },
      ],
      verdicts: [], findings: [], notes: [],
    });
    const parts = (out[1].subtitle ?? '').split(' · ');
    expect(parts).toHaveLength(3);
    for (const p of parts) {
      expect(p.length).toBeLessThanOrEqual(80);
    }
  });

  it('uses run.terminated_at when iteration ended_at is null but run terminated', () => {
    const out = deriveMilestones({
      run: { ...baseRun, terminated_at: '2026-05-26T10:05:00Z', terminal_state: 'TIMEOUT' },
      iterations: [
        { id: 'i1', iter_n: 1, started_at: null, ended_at: null,
          analyzer_summary: null, planner_summary: null, executor_summary: null,
          qa_summary: null },
      ],
      verdicts: [], findings: [], notes: [],
    });
    expect(out[1].ts).toBe('2026-05-26T10:05:00Z');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run tests/site/milestones.test.ts`
Expected: import error (module does not exist) on `../../site/src/lib/milestones`.

### Task 2.2: Implement deriveMilestones

**Files:**
- Create: `site/src/lib/milestones.ts`

- [ ] **Step 1: Write the module**

```typescript
export type MilestoneKind = 'start' | 'iter' | 'term';

export interface Milestone {
  id: string;
  kind: MilestoneKind;
  ts: string;
  title: string;
  subtitle?: string;
  iterId?: string;
}

interface IterRow {
  id: string;
  iter_n: number;
  started_at: string | null;
  ended_at: string | null;
  analyzer_summary: string | null;
  planner_summary: string | null;
  executor_summary: string | null;
  qa_summary?: string | null;
}

interface RunDetailPayload {
  run: {
    id: string;
    project_path: string;
    started_at: string;
    terminated_at: string | null;
    terminal_state: string | null;
  };
  iterations: IterRow[];
}

const MAX_SUBTITLE_LINE = 80;

function clip(s: string): string {
  return s.length <= MAX_SUBTITLE_LINE ? s : s.slice(0, MAX_SUBTITLE_LINE);
}

function iterSubtitle(it: IterRow): string | undefined {
  const parts: string[] = [];
  if (it.analyzer_summary) parts.push(clip(it.analyzer_summary));
  if (it.planner_summary) parts.push(clip(it.planner_summary));
  if (it.executor_summary) parts.push(clip(it.executor_summary));
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

export function deriveMilestones(payload: RunDetailPayload): Milestone[] {
  const out: Milestone[] = [];
  const projectName = payload.run.project_path.split('/').pop() || payload.run.project_path;

  out.push({
    id: 'start',
    kind: 'start',
    ts: payload.run.started_at,
    title: 'run_started',
    subtitle: projectName,
  });

  const sorted = [...payload.iterations].sort((a, b) => a.iter_n - b.iter_n);
  for (const it of sorted) {
    const inProgress = it.ended_at == null;
    const ts = it.ended_at
      ?? it.started_at
      ?? payload.run.terminated_at
      ?? payload.run.started_at;
    out.push({
      id: `iter:${it.id}`,
      kind: 'iter',
      ts,
      title: inProgress ? `第 ${it.iter_n} 轮 进行中` : `第 ${it.iter_n} 轮 完成`,
      subtitle: iterSubtitle(it),
      iterId: it.id,
    });
  }

  if (payload.run.terminated_at != null) {
    out.push({
      id: 'term',
      kind: 'term',
      ts: payload.run.terminated_at,
      title: 'run_terminated',
      subtitle: payload.run.terminal_state ?? undefined,
    });
  }

  return out;
}
```

- [ ] **Step 2: Run tests to verify pass**

Run: `pnpm vitest run tests/site/milestones.test.ts`
Expected: 5 PASS.

### Task 2.3: Write jump helper tests (failing)

**Files:**
- Create: `tests/site/jump.test.ts`

- [ ] **Step 1: Write the tests**

```typescript
import { describe, it, expect } from 'vitest';
import {
  findStdoutOffsetFor,
  milestoneFractionInTimeline,
} from '../../site/src/lib/jump';
import type { Milestone } from '../../site/src/lib/milestones';

const ms = (kind: Milestone['kind'], ts: string, id = kind): Milestone => ({
  id, kind, ts, title: kind,
});

describe('findStdoutOffsetFor', () => {
  it('matches full ISO timestamp when present', () => {
    const stdout = 'pre\n2026-05-26T10:00:42Z some output\nafter\n';
    const idx = findStdoutOffsetFor('2026-05-26T10:00:42Z', stdout, () => 0);
    expect(idx).toBe(stdout.indexOf('2026-05-26T10:00:42Z'));
  });

  it('matches HH:MM:SS slice when full ISO not present', () => {
    const stdout = 'pre\n[10:00:42] doing thing\nafter\n';
    const idx = findStdoutOffsetFor('2026-05-26T10:00:42Z', stdout, () => 999);
    expect(idx).toBe(stdout.indexOf('10:00:42'));
  });

  it('falls back to fraction when no timestamp pattern present', () => {
    const stdout = 'line a\nline b\nline c\nline d\nline e\n';
    const idx = findStdoutOffsetFor('2026-05-26T10:00:42Z', stdout, () => 0.4);
    expect(idx).toBe(Math.floor(stdout.length * 0.4));
  });
});

describe('milestoneFractionInTimeline', () => {
  it('returns the milestone position fraction', () => {
    const list = [
      ms('start', '2026-05-26T10:00:00Z'),
      ms('iter', '2026-05-26T10:01:00Z', 'i1'),
      ms('iter', '2026-05-26T10:02:00Z', 'i2'),
      ms('term', '2026-05-26T10:03:00Z'),
    ];
    expect(milestoneFractionInTimeline(list[0], list)).toBeCloseTo(0, 3);
    expect(milestoneFractionInTimeline(list[2], list)).toBeCloseTo(2 / 3, 3);
    expect(milestoneFractionInTimeline(list[3], list)).toBeCloseTo(1, 3);
  });

  it('returns 0 when milestone not in list', () => {
    const list = [ms('start', '2026-05-26T10:00:00Z')];
    const orphan = ms('iter', '2026-05-26T11:00:00Z', 'missing');
    expect(milestoneFractionInTimeline(orphan, list)).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run tests/site/jump.test.ts`
Expected: import error.

### Task 2.4: Implement jump helper

**Files:**
- Create: `site/src/lib/jump.ts`

- [ ] **Step 1: Write the module**

```typescript
import type { Milestone } from './milestones';

/**
 * Best-effort scroll-target offset in stdout for a milestone's timestamp.
 *
 * Tries three timestamp patterns (full ISO, ISO without trailing Z slice,
 * HH:MM:SS slice) in stdout; first hit wins. If none match, calls the
 * `fallbackFraction` thunk for a [0, 1] position and returns
 * `floor(stdout.length * fraction)`.
 */
export function findStdoutOffsetFor(
  ts: string,
  stdout: string,
  fallbackFraction: () => number,
): number {
  const patterns = [
    ts,
    ts.slice(0, 19),          // YYYY-MM-DDTHH:MM:SS
    ts.slice(11, 19),         // HH:MM:SS
  ];
  for (const p of patterns) {
    if (p.length < 4) continue;
    const idx = stdout.indexOf(p);
    if (idx !== -1) return idx;
  }
  const f = Math.max(0, Math.min(1, fallbackFraction()));
  return Math.floor(stdout.length * f);
}

export function milestoneFractionInTimeline(
  m: Milestone,
  list: Milestone[],
): number {
  if (list.length <= 1) return 0;
  const idx = list.findIndex((x) => x.id === m.id);
  if (idx < 0) return 0;
  return idx / (list.length - 1);
}
```

- [ ] **Step 2: Run tests to verify pass**

Run: `pnpm vitest run tests/site/jump.test.ts`
Expected: 5 PASS.

### Task 2.5: Write useRunLogs tests (failing)

**Files:**
- Create: `tests/site/useRunLogs.test.ts`

- [ ] **Step 1: Write the tests**

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useRunLogs } from '../../site/src/composables/useRunLogs';

describe('useRunLogs', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function mockFetchSeq(...responses: Array<{
    status: number; json?: any;
  }>) {
    const fn = vi.fn();
    for (const r of responses) {
      fn.mockResolvedValueOnce({
        ok: r.status >= 200 && r.status < 300,
        status: r.status,
        json: async () => r.json,
      });
    }
    vi.stubGlobal('fetch', fn);
    return fn;
  }

  it('idle on construction; start() transitions to loading then streaming', async () => {
    mockFetchSeq({
      status: 200,
      json: { content: 'hello\n', next_offset: 6, eof: false },
    });
    const log = useRunLogs();
    expect(log.state.value).toBe('idle');
    void log.start('r1', 'tok1');
    await vi.runOnlyPendingTimersAsync();
    expect(log.state.value).toBe('streaming');
    expect(log.buffer.value).toBe('hello\n');
    expect(log.nextOffset.value).toBe(6);
    log.stop();
  });

  it('appends content across polls and stops at eof', async () => {
    const fetch = mockFetchSeq(
      { status: 200, json: { content: 'a', next_offset: 1, eof: false } },
      { status: 200, json: { content: 'bc', next_offset: 3, eof: true } },
    );
    const log = useRunLogs();
    void log.start('r1', 'tok1');
    await vi.runOnlyPendingTimersAsync();
    await vi.advanceTimersByTimeAsync(2000);
    await vi.runOnlyPendingTimersAsync();
    expect(log.buffer.value).toBe('abc');
    expect(log.state.value).toBe('eof');
    // No more polls scheduled after eof.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('transitions to no_log on 404', async () => {
    mockFetchSeq({ status: 404, json: { error: 'log_not_found' } });
    const log = useRunLogs();
    void log.start('r1', 'tok1');
    await vi.runOnlyPendingTimersAsync();
    expect(log.state.value).toBe('no_log');
    expect(log.buffer.value).toBe('');
  });

  it('transitions to needs_token on 401', async () => {
    mockFetchSeq({ status: 401, json: { error: 'unauthorized' } });
    const log = useRunLogs();
    void log.start('r1', 'badtok');
    await vi.runOnlyPendingTimersAsync();
    expect(log.state.value).toBe('needs_token');
  });

  it('stop() clears scheduled poll', async () => {
    const fetch = mockFetchSeq(
      { status: 200, json: { content: 'x', next_offset: 1, eof: false } },
    );
    const log = useRunLogs();
    void log.start('r1', 'tok1');
    await vi.runOnlyPendingTimersAsync();
    log.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run tests/site/useRunLogs.test.ts`
Expected: import error.

### Task 2.6: Implement useRunLogs composable

**Files:**
- Create: `site/src/composables/useRunLogs.ts`

- [ ] **Step 1: Write the module**

```typescript
import { ref } from 'vue';

export type LogState =
  | 'idle'
  | 'loading'
  | 'streaming'
  | 'eof'
  | 'error'
  | 'no_log'
  | 'needs_token';

const POLL_INTERVAL_MS = 2000;
const ADMIN_BASE = '/admin';

/**
 * Polls `/admin/runs/:id/stdout?from=N`, appending content to a buffer
 * until eof. Callers drive lifecycle via start() / stop(). Polling is
 * scheduled via setTimeout so each request fully completes (including
 * appending to buffer) before the next request is scheduled — avoids
 * overlapping fetches.
 */
export function useRunLogs() {
  const state = ref<LogState>('idle');
  const buffer = ref<string>('');
  const nextOffset = ref<number>(0);
  const error = ref<string | null>(null);

  let runId: string | null = null;
  let token: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  async function fetchChunk(): Promise<void> {
    if (stopped || runId == null || token == null) return;
    let res: Response;
    try {
      res = await fetch(
        `${ADMIN_BASE}/runs/${runId}/stdout?from=${nextOffset.value}`,
        { headers: { 'x-admin-token': token } },
      );
    } catch (e) {
      state.value = 'error';
      error.value = String(e);
      return;
    }
    if (res.status === 404) {
      state.value = 'no_log';
      return;
    }
    if (res.status === 401 || res.status === 403) {
      state.value = 'needs_token';
      return;
    }
    if (!res.ok) {
      state.value = 'error';
      error.value = `HTTP ${res.status}`;
      return;
    }
    const body = await res.json() as {
      content: string; next_offset: number; eof: boolean;
    };
    buffer.value += body.content;
    nextOffset.value = body.next_offset;
    if (body.eof) {
      state.value = 'eof';
      return;
    }
    state.value = 'streaming';
    schedule();
  }

  function schedule(): void {
    if (stopped) return;
    if (timer != null) clearTimeout(timer);
    timer = setTimeout(() => { void fetchChunk(); }, POLL_INTERVAL_MS);
  }

  async function start(rid: string, tok: string): Promise<void> {
    runId = rid;
    token = tok;
    stopped = false;
    state.value = 'loading';
    buffer.value = '';
    nextOffset.value = 0;
    error.value = null;
    await fetchChunk();
  }

  function stop(): void {
    stopped = true;
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  return { state, buffer, nextOffset, error, start, stop };
}
```

- [ ] **Step 2: Run tests to verify pass**

Run: `pnpm vitest run tests/site/useRunLogs.test.ts`
Expected: 5 PASS.

### Task 2.7: Run all new site tests + full suite

- [ ] **Step 1: All site tests green**

Run: `pnpm vitest run tests/site/`
Expected: ~13 PASS (5 milestones + 5 jump + ~5 useRunLogs).

- [ ] **Step 2: Full suite still green**

Run: `pnpm test`
Expected: existing Hub tests + the new 13 = total pass. No regressions.

### Task 2.8: Commit Phase 2

- [ ] **Step 1: Stage and commit**

```bash
git add site/src/lib/milestones.ts \
        site/src/lib/jump.ts \
        site/src/composables/useRunLogs.ts \
        tests/site/
git commit -m "$(cat <<'EOF'
feat(site): useRunLogs composable + milestone derivation + jump helper

Pure logic + composable for the upcoming 日志 tab:
- site/src/lib/milestones.ts: deriveMilestones() — pure derivation
  of run_started / per-iter / run_terminated from /runs/:id payload
- site/src/lib/jump.ts: findStdoutOffsetFor() with timestamp pattern
  match + linear-fallback; milestoneFractionInTimeline()
- site/src/composables/useRunLogs.ts: polling state machine
  (idle/loading/streaming/eof/error/no_log/needs_token), setTimeout-
  based to avoid overlapping fetches

13 vitest cases under tests/site/ (the site's first test bundle):
5 milestones + 5 jump + ~5 composable. No UI changes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 3 · Logs tab UI

Goal: wire the composable + helpers into `LogsTab.vue`. Add the milestone list, stdout viewer, status bar, jump buttons, and admin-token gate.

### Task 3.1: Extract TokenGate component

**Files:**
- Create: `site/src/views/run-detail/TokenGate.vue`

- [ ] **Step 1: Write the gate**

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { useRunnerStore } from '../../stores/runner';

const emit = defineEmits<{
  (e: 'saved'): void;
}>();

const store = useRunnerStore();
const input = ref('');
const checking = ref(false);
const errorMsg = ref('');

async function probe(token: string): Promise<boolean> {
  const r = await fetch('/admin/runs/current',
    { headers: { 'x-admin-token': token } });
  return r.status === 200 || r.status === 204;
}

async function save() {
  const t = input.value.trim();
  if (!t) {
    errorMsg.value = '令牌不能为空。';
    return;
  }
  checking.value = true;
  errorMsg.value = '';
  try {
    const ok = await probe(t);
    if (!ok) {
      errorMsg.value = '令牌被 Hub 拒绝。';
      return;
    }
    store.setToken(t);
    input.value = '';
    emit('saved');
  } catch (e) {
    errorMsg.value = '校验失败：' + String(e);
  } finally {
    checking.value = false;
  }
}
</script>

<template>
  <div class="bg-yellow-50 border border-yellow-200 rounded p-4 text-sm space-y-2">
    <div class="font-medium">需要管理员令牌才能查看原始日志</div>
    <input v-model="input"
           @keyup.enter="save"
           type="password"
           placeholder="HUB_ADMIN_TOKEN"
           class="w-full border rounded p-2 text-sm" />
    <div class="flex items-center gap-2">
      <button @click="save" :disabled="checking"
              class="px-3 py-1 bg-blue-600 text-white rounded text-sm">
        {{ checking ? '校验中…' : '保存' }}
      </button>
      <span v-if="errorMsg" class="text-red-600 text-xs">{{ errorMsg }}</span>
    </div>
  </div>
</template>
```

### Task 3.2: Implement LogsTab.vue full UI

**Files:**
- Modify: `site/src/views/run-detail/LogsTab.vue` (replace placeholder)

- [ ] **Step 1: Replace the placeholder with the full UI**

```vue
<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import { useRunnerStore } from '../../stores/runner';
import { useRunLogs } from '../../composables/useRunLogs';
import { deriveMilestones, type Milestone } from '../../lib/milestones';
import { findStdoutOffsetFor, milestoneFractionInTimeline } from '../../lib/jump';
import TokenGate from './TokenGate.vue';

const props = defineProps<{ data: any; runId: string }>();

const store = useRunnerStore();
const logs = useRunLogs();
const scrollHost = ref<HTMLElement | null>(null);
const autoScroll = ref(true);

const milestones = computed<Milestone[]>(() => deriveMilestones(props.data));

function tryStart() {
  const tok = store.adminToken;
  if (!tok) {
    // We let the composable's state stay idle; the gate is shown via v-if.
    return;
  }
  void logs.start(props.runId, tok);
}

onMounted(tryStart);
onBeforeUnmount(() => { logs.stop(); });

watch(() => store.adminToken, (t) => {
  if (t) tryStart();
});

// Auto-scroll: append → next tick → scroll to bottom if autoScroll on.
watch(() => logs.buffer.value, async () => {
  if (!autoScroll.value || !scrollHost.value) return;
  await nextTick();
  scrollHost.value.scrollTop = scrollHost.value.scrollHeight;
});

function onScroll(ev: Event) {
  const el = ev.target as HTMLElement;
  // Disable auto-scroll if user moved away from bottom.
  if (el.scrollTop + el.clientHeight < el.scrollHeight - 20) {
    autoScroll.value = false;
  }
}

function jump(m: Milestone) {
  if (!scrollHost.value) return;
  const offset = findStdoutOffsetFor(
    m.ts,
    logs.buffer.value,
    () => milestoneFractionInTimeline(m, milestones.value),
  );
  // Approximate: scrollTop = offset / buffer.length * scrollHeight
  const len = logs.buffer.value.length;
  if (len === 0) return;
  const fraction = offset / len;
  autoScroll.value = false;
  scrollHost.value.scrollTop = scrollHost.value.scrollHeight * fraction;
}

function fmt(s?: string | null) {
  return s ? new Date(s).toLocaleString('zh-CN') : '—';
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

const stateLabel = computed(() => {
  switch (logs.state.value) {
    case 'idle': return '未开始';
    case 'loading': return '加载中…';
    case 'streaming': return '正在追加…';
    case 'eof': return '日志已结束';
    case 'no_log': return '此 run 无原始日志';
    case 'needs_token': return '需要令牌';
    case 'error': return '错误';
  }
  return '';
});
</script>

<template>
  <div class="space-y-3">
    <TokenGate v-if="logs.state.value === 'needs_token' || !store.adminToken"
               @saved="tryStart" />

    <div v-else class="grid grid-cols-1 md:grid-cols-5 gap-3">
      <!-- Left: milestones -->
      <aside class="md:col-span-2 bg-white border rounded-lg p-3 space-y-2 max-h-[700px] overflow-y-auto">
        <h3 class="font-semibold text-sm mb-2">里程碑</h3>
        <ul class="space-y-2">
          <li v-for="m in milestones" :key="m.id"
              class="border-l-2 border-gray-200 pl-2">
            <div class="text-xs text-gray-500">{{ fmt(m.ts) }}</div>
            <div class="text-sm font-medium">{{ m.title }}</div>
            <div v-if="m.subtitle" class="text-xs text-gray-600">{{ m.subtitle }}</div>
            <button v-if="logs.state.value !== 'no_log' && logs.buffer.value.length > 0"
                    @click="jump(m)"
                    class="text-xs text-blue-600 hover:underline">
              → 在日志中查看
            </button>
          </li>
        </ul>
      </aside>

      <!-- Right: stdout -->
      <section class="md:col-span-3 bg-white border rounded-lg p-3">
        <div class="flex items-center gap-3 text-xs text-gray-600 mb-2">
          <label class="flex items-center gap-1">
            <input type="checkbox" v-model="autoScroll" />
            自动滚动
          </label>
          <span>大小 {{ fmtBytes(logs.nextOffset.value) }}</span>
          <span class="ml-auto">{{ stateLabel }}</span>
        </div>
        <div v-if="logs.state.value === 'no_log'" class="text-sm text-gray-500 p-4">
          此 run 无原始日志（外部启动，Hub 只收到了结构化事件）。
        </div>
        <div v-else-if="logs.state.value === 'error'" class="text-sm text-red-600 p-4">
          错误：{{ logs.error.value }}
        </div>
        <pre v-else
             ref="scrollHost"
             @scroll="onScroll"
             class="bg-gray-50 border rounded p-2 text-xs font-mono whitespace-pre overflow-auto max-h-[600px]">{{ logs.buffer.value }}</pre>
      </section>
    </div>
  </div>
</template>
```

### Task 3.3: Verify build

- [ ] **Step 1: Type-check + build the site**

Run: `pnpm -C site build`
Expected: no errors. Build artifacts written.

### Task 3.4: Smoke test against a live Hub (manual, optional)

Only if the operator has a running Hub. Otherwise skip and rely on build success + unit tests.

- [ ] **Step 1: Start Hub locally with /iterate enabled**

```bash
export HUB_ADMIN_TOKEN=$(openssl rand -hex 16)
export D2P_RUNNER_ENABLED=1
export D2P_PATH=~/Desktop/Hosico/Works/Work/d2p
export D2P_RUNNER_MINIMAX_API_KEY=$(unzip -p ~/Desktop/MINIMAX_KEY.docx word/document.xml \
    | python3 -c "import sys, re; m = re.search(r'[A-Za-z0-9_.\-]{40,}', sys.stdin.read()); print(m.group(0))")
export D2P_RUNNER_INSTANCE_TOKEN=$(sqlite3 ~/.matrixomnix/hub.db "select token from d2p_instances limit 1;")
pnpm hub:start
```

- [ ] **Step 2: Kick a tiny /iterate run, watch logs**

In the browser:
1. Open /iterate, paste admin token (saves to localStorage)
2. Pick a small folder (e.g. /tmp/d2p-e2e-demo from session 8), iter=1, run d2p
3. While running, navigate to `/runs/<run_id>` (id from `/admin/runs/current` or the /iterate page)
4. Click the "日志" tab
5. Confirm:
   - Left timeline shows run_started + iter 1 进行中
   - Right stdout streams content, auto-scroll follows
   - Disable auto-scroll, scroll up — auto-scroll stays off
   - Click a milestone's "→ 在日志中查看" — scrolls to that area
6. After the run terminates, refresh page, navigate back to logs tab
   - Confirm static load (no polling, status bar says "日志已结束")

Report any visual issues / unexpected behavior.

### Task 3.5: Commit Phase 3

- [ ] **Step 1: Stage and commit**

```bash
git add site/src/views/run-detail/LogsTab.vue \
        site/src/views/run-detail/TokenGate.vue
git commit -m "$(cat <<'EOF'
feat(site): 日志 tab UI — milestone list, stdout viewer, live polling

Wires the Phase-2 composable + helpers into the LogsTab placeholder:
- Left 40%: milestone timeline derived from /runs/:id payload, each
  with a "→ 在日志中查看" jump button (best-effort timestamp match
  with linear fallback)
- Right 60%: monospace stdout viewer, max-h-[600px] scroll, 2s poll
  for live runs, auto-scroll checkbox that disables on user-scroll-up
- Status bar: 大小 / state label (加载中 / 正在追加 / 日志已结束 / 错误)
- TokenGate: small extracted component for admin-token entry,
  validates via /admin/runs/current probe (same pattern as Iterate.vue)

No backend changes. Mobile stacks vertically (md breakpoint).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Acceptance criteria

1. `pnpm test` passes 100% (existing Hub tests + 13 new site tests).
2. `pnpm -C site build` succeeds with no TS or Vue errors.
3. Hash-routed tabs work: `/runs/:id#logs` deep-links directly to the logs tab.
4. With admin token set + a finished Hub-spawned run, opening the 日志 tab shows the milestone list + the entire stdout in the right pane, with `eof=true` and no polling.
5. With admin token unset, opening 日志 tab shows the TokenGate component, not the placeholder text.
6. With a run that has no log file (404 from stdout endpoint), the right pane shows "此 run 无原始日志（外部启动…）" and disables polling.
7. No changes to any `src/hub/...` file.
8. /iterate page continues to work as before (no regression to `useRunner` composable).

## Out of scope (do NOT implement)

Per spec §9:
- ANSI color parsing
- Full-text search / regex filter
- Server-side per-line timestamp injection
- Top-level `/logs` route
- Download button
- Log retention policy
- SSE / WebSocket push
