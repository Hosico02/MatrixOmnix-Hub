# MatrixOmnix Hub · design spec

> **Status:** design approved, not yet implemented
> **Date:** 2026-05-25
> **Target repo:** this repo (`Hosico02/demo2project`, brand: MatrixOmnix)
> **Companion repo:** `Hosico02/d2p`(parent folder `../d2p`) — minimal client-side changes (~200 LOC), see §5

## 1. Context and rationale

### Where the project just was

The previous pivot (2026-05-22) turned MatrixOmnix into a verify-only MCP
server (`d2p-verify`). On further reflection (this session) we concluded:

- d2p will ship an **internal** Verifier agent (per
  `2026-05-22-d2p-verify-agent-design.md`) that is a strict capability
  superset of what this repo's deterministic gap checks can do.
- Therefore the verifier-MCP role this repo currently occupies has no
  forward-value as a per-iteration component of d2p.
- A "Stage 0 deterministic pre-filter" idea was considered and rejected as
  premature optimization (no data yet on which categories the LLM
  routinely overspends on).

### What this repo still uniquely has

A ~12k LOC TypeScript asset base whose individual subsystems are still
strong, even after the verifier role becomes redundant:

- `core/gapAnalyzer.ts` (~3.8k LOC) — declarative gap rules
- `core/projectArchetypeDetector.ts` — deterministic archetype detection
- `core/projectScorer.ts` + `antiGamingScorer.ts` + `evidenceWeightedScorer.ts`
- `qa/*` (11 files) — failure fingerprint + lifecycle + similarity +
  cross-project transferability subsystem (much richer than d2p's `qa.py`)
- `standards/*` — base + archetype + learned three-tier adaptive standards
- `core/failureTaxonomy.ts`, `evidenceGraph.ts`, `eventStore.ts`,
  `deliverySurfaceDetector.ts`, `docsTruth.ts`
- 4 agent classes (Analyzer / Reviewer / Verifier / Memory) reusable as
  LLM-backed helpers
- A Vue 3 + Vite + Tailwind site scaffold (`site/`)

### What this spec proposes

Repurpose the repo as **MatrixOmnix Hub** — a multi-project PM + mentor
cockpit that sits *outside* d2p's iteration hot path. Multiple d2p
instances report run events to the hub; the hub aggregates, learns
standards drift over time, and surfaces decisions to a human via a Vue
dashboard. The hub holds standards as a single source of truth; d2p
verifier pulls them at run start.

The hub does **not** compete with d2p's internal verifier. It plays a
strictly meta role: observing d2p's behavior across runs, mentoring its
standards, and giving the operator a place to see and steer everything.

## 2. Decision summary (load-bearing choices)

| Decision | Choice | Section |
|---|---|---|
| Repo's role | Meta-cockpit + standards authority for d2p — not a per-iteration component | §1 |
| Scope | Small multi-project hub (self-hosted backend + DB + API + UI) | §3 |
| Coupling with d2p | Active closed-loop: d2p pulls standards from hub, pushes events to hub. Minimal d2p changes (~200 LOC) | §5 |
| Mentor mode | Hub holds standards single source of truth; d2p pulls at verifier start | §3, §5 |
| Learner mechanism | Hybrid: rule-based + weekly LLM summariser, both produce proposals into a human-review queue | §6 |
| Approval gate | All standards changes require human approval (rejection feedback weakly informs future learner) | §6 |
| Storage | SQLite (single file, local) — Drizzle ORM enables zero-cost upgrade to Postgres later | §4 |
| Web framework | Hono (API) + Vue 3 + Vite + Tailwind (UI, reuse existing `site/` scaffold) | §3, §7 |
| Default UI language | Chinese (operator-local tool) — i18n hook reserved, not implemented (YAGNI) | §7 |
| UI design principle | Pages are for humans, not agents. All internal IDs translated via a `humanize.ts` layer at render time | §7 |
| Deployment | Single Node process bound to localhost; single SQLite file; manual start | §8 |
| Naming | Brand "MatrixOmnix" retained; this product is "MatrixOmnix Hub" | §8 |

## 3. System architecture

```
┌─────────────────┐                    ┌──────────────────────────────────┐
│  d2p instance 1 │ ──HTTP push─────►  │      MatrixOmnix Hub             │
└─────────────────┘  /events            │   (single Node process)          │
┌─────────────────┐                    │  ┌────────────────────────────┐  │
│  d2p instance 2 │ ──HTTP push─────►  │  │ HTTP API (Hono)            │  │
└─────────────────┘  /events            │  │  /events  /standards       │  │
       ▲                                │  │  /proposals  /runs         │  │
       │  HTTP GET                     │  └────────────────────────────┘  │
       │  /standards/<archetype>       │  ┌────────────────────────────┐  │
       │  (ETag/304 cacheable)         │  │ Core (existing TS, reused) │  │
       │                                │  │  gapAnalyzer / scorer /    │  │
       └────────────────────────────── │  │  QA subsystem / standards  │  │
                                        │  └────────────────────────────┘  │
                                        │  ┌────────────────────────────┐  │
                                        │  │ Learner (scheduled)        │  │
                                        │  │  rules pass + weekly LLM   │  │
                                        │  └────────────────────────────┘  │
                                        │  ┌────────────────────────────┐  │
                                        │  │ SQLite (single file DB)    │  │
                                        │  └────────────────────────────┘  │
                                        └──────────────────────────────────┘
                                                       ▲
                                                       │ HTTP (Vue static)
                                              ┌────────┴─────────┐
                                              │  Vue Dashboard   │
                                              │  A: 运行 (主页)   │
                                              │  B: 规则          │
                                              │  C: 待办          │
                                              └──────────────────┘
```

### Components

| Component | Tech | New / Reused |
|---|---|---|
| HTTP API | Hono | New (~300 LOC) |
| Core analyzers / scorers / QA / standards subsystems | TypeScript (existing) | Reused, ~12k LOC |
| Learner | TypeScript, scheduled cron | New: rules ~200 LOC + LLM summariser ~150 LOC |
| Storage | SQLite via better-sqlite3 + Drizzle ORM | New: schema + migrations ~200 LOC |
| Web UI | Vue 3 + Vite + Tailwind | Scaffold reused; pages rewritten |

### Lifecycle of one d2p run (end-to-end)

1. d2p run starts → POST `/events` (type=`run_started`)
2. d2p verifier boots → GET `/standards/<archetype>` (cached via ETag) → uses current version's body in its SYSTEM_PROMPT
3. Each d2p iteration ends → POST `/events` (type=`iteration_complete`, includes verdict + findings)
4. d2p run terminates → POST `/events` (type=`run_terminated`, includes terminal state)
5. Hub Learner (rules pass, debounced 60s after events) scans → emits candidate proposals to the `proposals` table
6. Hub Learner (LLM summariser, weekly Sunday 03:00) reads last 7 days of findings → Opus proposes broader changes → emits to `proposals`
7. Both rule and LLM proposals go through a dedup + supersede step to prevent inbox flooding
8. Operator opens UI → C page (待办) shows pending proposals → approves/rejects
9. On approve → new row in `standard_versions` + `standards.is_current` flips → next d2p verifier pull gets the new version

## 4. Data model

SQLite via Drizzle ORM. 10 tables.

```
d2p_instances
  id (uuid)  name  token_hash  created_at  last_seen_at

runs
  id (uuid)  instance_id→d2p_instances  project_path  detected_archetype
  started_at  terminated_at
  terminal_state  ∈ {CLEAN, WITH_RESIDUALS, ESCALATED, TIMEOUT, RUNNING}
  total_cost_usd  total_iterations

iterations
  id  run_id→runs  iter_n  started_at  ended_at
  analyzer_summary  planner_summary  executor_summary  qa_summary

verdicts                                            -- one per Verifier call
  id  iteration_id→iterations
  verdict ∈ {pass, needs_repair, fail, no_new_findings}
  confidence  stability_signal  suggested_next_focus  raw_response
  standards_version_id→standard_versions            -- which standards body was active

findings
  id  verdict_id→verdicts  category  severity  message  evidence
  is_new (bool)                                     -- vs repeated_finding

standards                                            -- one row per archetype (current pointer)
  id  archetype  version  body_md  is_current
  created_at  approved_by  source ∈ {manual, llm, rule}

standard_versions                                    -- append-only history
  id  standards_id→standards  version  body_md
  diff_from_prev_md  created_at

proposals                                            -- learner-emitted candidate changes
  id  archetype
  proposal_type ∈ {add_check, adjust_weight, remove_check, reword}
  body_md  rationale_md  source ∈ {rule, llm}
  status ∈ {pending, approved, rejected, superseded}
  created_at  decided_at  decided_by
  resulting_standard_version_id→standard_versions   -- populated on approve

proposal_evidence                                    -- proposal ↔ supporting findings
  proposal_id→proposals  finding_id→findings        -- composite PK

mentor_notes                                         -- human or LLM notes on a run
  id  run_id→runs  author ∈ {human, llm}
  body_md  created_at

events                                               -- raw append-only audit log
  id  instance_id→d2p_instances  event_type  payload (json)  received_at
  UNIQUE (instance_id, event_type, payload_hash)    -- de-dupes d2p retries
```

### Why these specific design points

- **`standards` + `standard_versions` split**: the `standards` row is just
  the current pointer; the immutable history lives in `standard_versions`.
  Each `verdict` row records the exact `standards_version_id` active at
  verify time, so every past verdict is auditable.
- **`findings.is_new` bool**: preserves d2p's spec §6.2 new-vs-repeated
  distinction at storage time; rules pass and A-page stats both use it.
- **`proposals.status = 'superseded'`**: a new proposal that overlaps an
  existing pending one for the same `(archetype, type)` does not create
  a duplicate inbox item — it absorbs the old one's evidence and the
  old row is marked `superseded`.
- **`events` table as audit log + replay source**: derived tables can be
  rebuilt by re-applying events. Also catches d2p ↔ hub time-ordering
  bugs (events arriving out of order can be replayed once parents
  arrive).

### Storage volume estimate

Assuming 100 runs/week × 5 iterations × 5 findings = ~12.5k findings/week
≈ 650k findings/year. SQLite single-file at this scale stays in the
low-hundreds-of-MB range — well under any practical limit. Upgrade to
Postgres is a Drizzle dialect swap, no schema change.

### Indexes (load-bearing for UI queries)

- `runs(instance_id, started_at)` — A page main list
- `runs(detected_archetype, terminal_state)` — A page filters
- `findings(category, severity)` — Learner rules scan
- `findings(verdict_id)` — drill-down
- `proposals(status, archetype)` — C page default query
- `standards(archetype, is_current)` — d2p verifier pull
- `events(received_at)` — chronological replay

## 5. API surface and d2p-side changes

### Hub HTTP API (Hono, JSON, Bearer-auth on d2p endpoints)

```
─── d2p → hub ─────────────────────────────────────────────────────

POST  /events
      body: { type, run_id, payload }
      type ∈ run_started | iteration_complete | verdict_emitted
            | finding_recorded | run_terminated
      → 200 { event_id }

GET   /standards/:archetype
      → 200 { version, body_md, etag }
      → 304 if-none-match etag matches

─── hub UI → hub ──────────────────────────────────────────────────

GET   /runs?instance=&archetype=&state=&since=&limit=
      → 200 { items: [run_summary], cursor }

GET   /runs/:id
      → 200 { run, iterations, verdicts, findings,
              standards_versions_used, notes }

GET   /standards?archetype=
      → 200 { items: [{ archetype, current_version,
                        version_count, run_hit_count }] }

GET   /standards/:archetype/history
      → 200 { versions, proposals }

GET   /proposals?status=pending&archetype=
      → 200 { items: [proposal_with_evidence_summary] }

GET   /proposals/:id
      → 200 { proposal, evidence: [{ finding, run, iteration }], diff }

POST  /proposals/:id/decision
      body: { decision: 'approve'|'reject', note? }
      → 200 { new_standard_version_id? }

POST  /runs/:id/notes
      body: { body_md, author: 'human' }
      → 200 { note }

─── admin (single token in env) ───────────────────────────────────

POST  /admin/learner/trigger
      → 200 { proposals_created }
GET   /admin/health
      → 200 { db_ok, last_event_at, last_learner_run_at }
```

### Auth model

- `Authorization: Bearer <token>` on all `d2p → hub` writes;
  `d2p_instances.token_hash` stored bcrypt.
- UI side: bound to localhost by default, no per-user auth in v1.
  Single shared `HUB_ADMIN_TOKEN` for `/admin/*`.
- Future LAN/VPS deployment can layer nginx + basic auth without
  schema changes.

### ETag / 304 on `/standards/:archetype`

Response carries `ETag: <version>`. Client (d2p HubClient) caches the
last seen ETag and sends `If-None-Match` on subsequent pulls. 304
responses are 0-byte and let d2p reuse its local cache. Net effect:
every verifier boot calls hub, but bandwidth and parse cost is
essentially nil when standards haven't changed.

### d2p-side changes (~200 LOC)

```python
# new file: d2p/hub_client.py  (~150 LOC)

class HubClient:
    def __init__(self, base_url: str, token: str, cache_dir: Path):
        self.base = base_url
        self.token = token
        self.cache = cache_dir / "hub_cache"
        self._etag_cache: dict[str, str] = {}

    def push_event(self, type: str, run_id: str, payload: dict) -> None:
        # best-effort POST. on failure: append to
        # cache/pending_events.jsonl; flushed on next successful call.
        ...

    def pull_standards(self, archetype: str) -> str:
        # 1. GET with If-None-Match: <cached etag>
        # 2. 304 → read body from cache
        # 3. 200 → write body to cache, update etag
        # 4. network error / 5xx → fallback to last cached body
        # 5. no cache + network error → fallback to BAKED_STANDARDS
        ...

# modify: d2p/agents/verifier.py
class Verifier:
    def __init__(self, llm_client, system_root, hub_client=None):
        self.hub = hub_client
    def verify(self, ...):
        archetype = detect_archetype_quick(project_path)
        standards = (self.hub.pull_standards(archetype)
                     if self.hub else BAKED_STANDARDS)
        system_prompt = SYSTEM_PROMPT_TEMPLATE.format(standards=standards)
        ...

# modify: d2p/orchestrator.py — wrap iteration loop with push_event calls
#         at run_started / iteration_complete / run_terminated

# modify: d2p/config.py — read HUB_URL / HUB_TOKEN env vars
```

**Fail-safe invariant:** if `HUB_URL` is unset or unreachable, d2p runs
exactly as before. Hub never blocks d2p.

## 6. Learner pipeline (rules + LLM + approval queue)

Two parallel emitter paths converge on a single dedup + supersede step,
then write into `proposals`.

```
          ┌──────────────────────────────────────────────┐
          │  events / findings / verdicts (substrate)    │
          └─────────────────┬────────────────────────────┘
                            │
        ┌───────────────────┴────────────────────┐
        │                                         │
┌───────▼────────┐                       ┌────────▼─────────┐
│ Rule pass      │                       │ LLM summariser   │
│ trigger:       │                       │ trigger:         │
│ post-event,    │                       │ weekly cron      │
│ debounced 60s  │                       │ (Sun 03:00)      │
└───────┬────────┘                       └────────┬─────────┘
        │ candidate proposals                     │ candidate proposals
        └───────────────────┬─────────────────────┘
                            │
                  ┌─────────▼──────────┐
                  │ Dedup + supersede   │
                  └─────────┬──────────┘
                            │
                  ┌─────────▼──────────┐
                  │  proposals table    │  →  C page review
                  └────────────────────┘
```

### Initial rule set (5 rules, all pure SQL + threshold)

| Rule ID | Trigger | Emits |
|---|---|---|
| `R1_persistent_finding` | `(archetype, category)` appeared in ≥ 5 of last 10 runs AND no current standards check covers it | `add_check` proposal |
| `R2_check_never_fires` | A current standards check produced 0 findings in last 30 days | `remove_check` proposal |
| `R3_severity_drift` | Same category in last 20 findings has ≥ 80% disagreement with the current standards severity | `adjust_weight` proposal |
| `R4_archetype_drift` | Same `project_path` has had ≥ 3 consecutive runs with differing `detected_archetype` | `mentor_note` (does not alter standards) |
| `R5_repeated_residual` | Same `category` appeared as `is_new=false` ≥ 3 times within a single run (d2p failed to fix despite retries) | `mentor_note` + `reword` proposal pair |

Implementation: `src/hub/learner/rules/<rule_id>.ts`, each file exports
`async (db) => Proposal[]`. `runRulePass()` invokes all, concatenates,
forwards to dedup.

### LLM summariser

- Weekly cron (Sunday 03:00 local time)
- Reads last 7 days of `findings` + `verdicts`, groups by archetype,
  truncates to ~30k token budget
- System prompt: "You review d2p's run data. Propose standards changes.
  **Do not duplicate patterns already caught by rules R1–R5.** Focus on
  semantic-level issues: vague wording, missing key examples, archetype
  boundary judgment errors."
- Each proposal includes `archetype`, `proposal_type`, `body_md`,
  `rationale_md`, `evidence_finding_ids`
- Cost: ~$0.30/week (one Opus call)
- Disabled gracefully if `ANTHROPIC_API_KEY` is unset

### Dedup + supersede

Before inserting a new proposal:

```sql
SELECT id FROM proposals
WHERE archetype = ? AND proposal_type = ?
  AND status = 'pending'
  AND substr(body_md, 1, 200) LIKE ?
```

- Match → mark old as `superseded`, merge its `proposal_evidence` rows
  into the new proposal, insert new
- No match → insert as-is

This prevents the C page inbox from flooding when the same underlying
issue retriggers across many runs.

### Approval flow

C page renders each pending proposal with:

- humanized title (e.g., "Python 后端 API · 想新加一条规则")
- body in markdown
- rationale (plain Chinese, no rule ID exposed by default)
- evidence count + drill link
- Approve / Reject / Edit body buttons

On **Approve**:
- `proposals.status = 'approved'`
- new row in `standard_versions` (version += 1; `body_md = current ⊕ proposal`;
  `diff_from_prev_md` generated)
- `standards.is_current` flips to the new version row
- Next d2p verifier pull picks up the new version

On **Reject**:
- `proposals.status = 'rejected'`
- `decided_by` + optional note recorded
- Future rule passes skip patterns that produced recent rejections
  (`WHERE NOT EXISTS (SELECT 1 FROM proposals WHERE ... AND status='rejected' AND decided_at > now()-30d)`)
- LLM summariser's prompt receives last N rejected proposals as
  negative examples

On **Edit body**:
- inline markdown editor opens (CodeMirror 6)
- on save → behaves like Approve, but `source = 'human'`

### Boundaries and failure modes

- Learner crash → next cron retries; standards never corrupted
- Manual `/admin/learner/trigger` to force-rerun
- Rules emitting too many false positives → operator rejects in bulk;
  rejection feedback dampens future emission
- LLM proposals low quality → flip biweekly, or kill switch via env
  `HUB_DISABLE_LLM_LEARNER=1`
- **Cold start**: zero historical data → learner emits nothing. Initial
  `standards` v1 per archetype is human-authored (seeded from d2p's
  verify spec §8 category list)
- **Rollback**: B page UI offers "revert to vN" → flips `standards.is_current`
  to an older `standard_versions` row. Append-only history guarantees
  no version is ever destroyed.

## 7. UI plan (humanized)

### Design principle

**Pages are for humans, not agents.** All internal IDs — archetype slugs,
finding category snake_case, terminal state enums, proposal types,
severity levels, rule IDs — are translated to plain Chinese at the Vue
render layer. The backend API remains in canonical IDs (d2p talks to it).

### Humanization layer

`src/hub/humanize.ts` exposes lookup maps:

```
archetype  fastapi-api          → "Python 后端 API"
           node-server          → "Node 后端"
           python-library       → "Python 库"
           python-cli           → "Python 命令行"

status     TERMINATE_CLEAN      → "完美交付"
           TERMINATE_WITH_RES   → "基本可用,有问题没修完"
           TERMINATE_ESCALATED  → "需要人介入"
           TERMINATE_TIMEOUT    → "试到上限还没收敛"

severity   blocker              → "严重"
           high                 → "比较严重"
           medium               → "一般"
           low                  → "轻微"

finding    missing_api_error_envelope → "接口出错时没返回标准格式"
           readme_cmd_mismatch        → "README 写的命令跟代码对不上"
           missing_env_example        → "缺 .env.example 模板"
           ...                        (extended over time)

proposal   add_check            → "想新加一条规则"
           remove_check         → "想删一条没用的规则"
           adjust_weight        → "想改一条规则的严重程度"
           reword               → "想改一条规则的措辞"

rule_id    (hidden by default; appears only in debug view)
```

Per-archetype `human_zh` and per-finding-category `human_zh` are also
stored on the `standards.body_md` so each archetype's standards
authoritatively name their own checks. Unknown IDs fall back to raw
slug + a small "待翻译" badge.

### Routes

```
/                          → A 运行 (default landing)
/runs/:id                  → A drill-down
/standards                 → B 列表
/standards/:archetype      → B drill-down (current / history / pending)
/mentor                    → C 待办
/proposals/:id             → C drill-down (also reachable from A drill)
```

### Page A · 运行 (default landing)

Sections, top to bottom:

1. **正在跑** — active runs (status icon + project name + plain-language
   one-liner + cost + iter count)
2. **最近 7 天** — recent terminated runs, each with a one-line outcome
   ("完美交付,6 轮搞定" / "基本可用,但还有 3 处问题 d2p 没修完" /
   "遇到 d2p 修不动的硬骨头")
3. **本周看到的现象** (sidebar) — top-N recurring patterns this week,
   each a one-liner; "→ 去待办里看是否要加成规则" link to C
4. **本周战绩** (sidebar) — counts: total runs / CLEAN / WITH_RES /
   ESCALATED, translated to plain language

Drill-down (`/runs/:id`):

- header: status + one-line summary + cost + time + standards version used
- **d2p 这次都做了什么** — humanized timeline per iteration:
  Analyzer / Planner / Executor / QA in plain sentences;
  Verifier's findings as bulleted plain-language items with severity icons
- **备注** — mentor notes (auto + human), each with author + timestamp
- **这次跑出来的新规则建议** — list of proposals that originated from
  this run's findings, each linking into C drill

### Page B · 规则

List grouped by archetype, each row showing rule count, run hit count,
"上次改: N 天前".

Drill-down (`/standards/:archetype`):

- Tabs: **现在用的** / **改动历史 (N)** / **待决定 (N)**
- 现在用的: human-readable bullet list of all current checks with
  severity icons; the newly-added or recently-modified one annotated
  "← N 天前你新加的"
- 改动历史: chronological log of approved versions; each shows
  rationale + "看具体改了什么" (diff view) + "撤回这次改动" (revert)

### Page C · 待办

Top: status banner "系统观察了最近的项目,建议你做这些决定。"

Tabs: **等你决定 (N)** / **最近决定的 (N)**

Each pending item is a card:

- icon + archetype-humanized + proposal-type-humanized
  ("💡 Python 后端 API · 想新加一条规则")
- the proposed rule body (boxed, monospace-OK)
- **为什么提:** bulleted rationale in plain Chinese
  (rule ID and source are hidden by default)
- evidence count + drill link
- buttons: **✓ 接受,加进去** / **✗ 不要** / **✎ 改下措辞再加**

### Status icons (used consistently across all pages)

- 🟢 active/running
- ✅ clean done
- ⚠️ done with caveats (WITH_RESIDUALS)
- ❌ needs human (ESCALATED)
- ⏱ timed out
- 💡 add proposal
- 🗑 remove proposal
- ✎ edit/adjust proposal
- 🔄 revert action

### State management and refresh

- Pinia stores per page (runs / standards / mentor)
- Active page polls every 30s; backgrounded pages do not poll
- C page badge in nav bar is the closed-loop visibility anchor —
  surfaces pending count from anywhere

### Out of scope (v1)

- User accounts / multi-user roles
- Dark mode toggle (inherits from `site/` current theme)
- Internationalization (Chinese only; i18n hook reserved)
- CSV / PDF export
- Bulk approve in C page (single-decision flow only)
- WebSocket / SSE real-time (polling suffices at this scale)

## 8. Asset reuse, naming, deployment, testing, error handling

### 8.1 Existing 86-file disposition

| Subsystem | Disposition | Notes |
|---|---|---|
| `src/core/gapAnalyzer.ts` | **Reused, imported** | Learner R1 reads finding categories from it; A drill expands evidence |
| `src/core/projectArchetypeDetector.ts` | **Reused, API-exposed** | Hub double-checks archetype on d2p report; humanize layer reverse-looks-up |
| `src/core/projectScorer.ts`, `antiGamingScorer.ts`, `evidenceWeightedScorer.ts` | **Reused** | A page scores; B page before/after standards-change comparison |
| `src/qa/*` (11 files) | **Reused as hub QA memory backbone** | QACaseStore backend swapped to SQLite; QASimilarity / QADeduplicator power R1's category clustering |
| `src/standards/*` | **Reused, persistence switched** | Adaptive standard manager reads from `standards` table instead of JSON files |
| `src/core/failureTaxonomy.ts` | **Reused** | C inbox categorization; auto mentor-note classification |
| `src/core/evidenceGraph.ts` | **Reused** | Foundation of all drill-down views |
| `src/core/eventStore.ts` | **Reused, backend swapped** | Wired to SQLite via Drizzle; backs the `/events` endpoint |
| `src/core/deliverySurfaceDetector.ts`, `docsTruth.ts` | **Reused** | Source material for future learner rules |
| `src/core/redaction.ts`, `safety.ts` | **Reused** | Pre-storage sensitive-data scrub |
| `src/core/commandRunner.ts` | **Reused** | Evidence drill can re-run commands on demand |
| `src/agents/AnalyzerAgent.ts` | **Reused, repurposed** | Backend for learner's weekly LLM summariser |
| `src/agents/MemoryAgent.ts` | **Reused** | Cross-run pattern memory; backs R5 |
| `src/agents/ReviewerAgent.ts` | **Reused** | Auto-generates humanized run notes |
| `src/agents/VerifierAgent.ts` | **Deleted** | d2p has internal verifier now |
| `src/mcp/server.ts`, `tools.ts` | **Deleted** | HTTP `/events` suffices; MCP surface is redundant overhead |
| `src/cli/commands/*` | **Mostly deleted; keep `archetype`, `gap`, `doctor`** | CLI degrades to a debugging/manual-check tool |
| `src/security/*` | **Retained, dormant** | Reserved for future access-control needs |
| `site/src/App.vue` etc. | **Build pipeline retained, pages rewritten** | Vue 3 + Vite + Tailwind kept |

### 8.2 New directories

```
src/hub/
  server.ts                # Hono app, mounts routes + static
  auth.ts                  # Bearer token verification
  humanize.ts              # ID → Chinese translation maps
  routes/
    events.ts
    standards.ts
    runs.ts
    proposals.ts
  db/
    schema.ts              # Drizzle schema
    client.ts              # better-sqlite3 + Drizzle instance
    migrations/0001_init.sql
  learner/
    runner.ts              # scheduling + dedup
    rules/
      r1_persistent_finding.ts
      r2_check_never_fires.ts
      r3_severity_drift.ts
      r4_archetype_drift.ts
      r5_repeated_residual.ts
    llm_summariser.ts

site/src/
  views/
    Runs.vue
    RunDetail.vue
    Standards.vue
    StandardDetail.vue
    Mentor.vue
    ProposalDetail.vue
  components/
    StatusBadge.vue
    HumanLabel.vue
    EvidenceDrawer.vue
  stores/
    runs.ts  standards.ts  mentor.ts
  router.ts
```

### 8.3 Naming

Brand **MatrixOmnix** retained; this product is **MatrixOmnix Hub**.

- d2p is the engine; MatrixOmnix Hub is the cockpit
- `package.json`:
  - `description`: "PM + mentor cockpit for d2p productization runs"
  - `bin`: remove `d2p-verify`; add `matrixomnix-hub` → `dist/hub/server.js`
  - `scripts.start`: `node dist/hub/server.js`
  - `scripts.dev`: `tsx watch src/hub/server.ts`
  - delete `scripts.demo:*`

### 8.4 Deployment (localhost-first, per user constraint "目前在本地进行测试")

```bash
# one-off
pnpm install
pnpm build      # tsup → dist/hub  +  vite → dist/site

# start
HUB_PORT=3030 \
HUB_DB_PATH=~/.matrixomnix/hub.db \
HUB_ADMIN_TOKEN=<random> \
ANTHROPIC_API_KEY=<key>   \      # learner LLM only; omit to disable LLM pass
node dist/hub/server.js

# browser
open http://localhost:3030
```

- Single Node process binds 127.0.0.1 by default (override with
  `HUB_BIND=0.0.0.0` for LAN)
- Single SQLite file at `~/.matrixomnix/hub.db` (auto-created)
- Hono serves `/api/*` and static Vue at `/` from one port
- Future VPS deployment: add nginx + HTTPS in front; no code change

d2p side:

```bash
export HUB_URL=http://localhost:3030
export HUB_TOKEN=<token issued by hub /admin>
python run.py    # d2p as usual; auto-reports to hub
```

### 8.5 Testing strategy

| Layer | Tool | Coverage |
|---|---|---|
| Hub unit | vitest (existing) | Each learner rule (in-memory SQLite mock) · humanize maps · dedup/supersede · API auth · standards versioning |
| Hub integration | vitest + supertest | End-to-end: `POST /events × N` → rule trigger → proposal insert → `POST /decision approve` → new version → `GET /standards` returns new version |
| d2p client | pytest + httpx mock (in d2p repo) | `pull_standards` 3-tier fallback · `push_event` retry / pending_events.jsonl persistence |
| UI | (no e2e in v1) | Local tool; manual smoke acceptable |
| End-to-end smoke | one shell script | Start hub → run d2p on a small fixture → grep DB for run/iter/finding rows → open browser |

Existing ~250 vitest tests are largely tied to the deprecated verifier/CLI;
**expect to cut 60–70% and add 30–50 new tests** during implementation.

### 8.6 Error handling (three classes)

**1. d2p offline (hub down or not started)**
- `pull_standards`: local ETag cache → BAKED_STANDARDS, never throws
- `push_event`: writes to `pending_events.jsonl`, flushed on next
  successful call
- Net: d2p never stalls on hub

**2. Hub data issues**
- Daily SQLite backup to `hub.db.bak.<date>` via internal cron
- Learner LLM call failure: caught, logged to `events` (type=`learner_error`),
  retried next cron
- Learner rule bug causing proposal flood: dedup + supersede absorbs
  most duplicates; remaining excess is handled by operator rejecting
  individually (bulk-reject is out of scope for v1 per §7) or, in
  extreme cases, by toggling the offending rule off via
  `HUB_DISABLE_RULE=R<id>` env var and re-running learner

**3. d2p ↔ hub ordering glitches**
- Out-of-order events (iteration before run_started): the receiving
  route upserts `runs` with placeholders so later parent event fills in
- d2p retries (same event twice): `events` table UNIQUE constraint
  on `(instance_id, event_type, payload_hash)` de-dupes silently

## 9. Implementation outline (gating the writing-plans handoff)

Order of operations for converting the spec into a working hub. The
detailed implementation plan is the responsibility of the writing-plans
skill that follows this brainstorm.

1. **Schema + DB layer** — Drizzle schema + migrations; better-sqlite3
   wired; basic CRUD smoke tests
2. **HTTP API** — Hono app + `/events` POST + `/standards/:archetype` GET
   with ETag; auth middleware; unit tests
3. **Existing-asset adapter layer** — switch `eventStore`, `QACaseStore`,
   `standards/adaptiveStandardManager` backends to read/write SQLite
4. **Learner rules R1–R5** — one file each, vitest each in isolation
5. **Learner LLM summariser** — Opus call + dedup + supersede
6. **Vue UI** — humanize layer + StatusBadge / HumanLabel components,
   then A page, then B page, then C page
7. **d2p HubClient** — Python module in `../d2p/d2p/hub_client.py` +
   verifier/orchestrator wiring + pytest
8. **End-to-end smoke** — shell script
9. **Asset cleanup** — delete deprecated CLI commands, `VerifierAgent`,
   MCP server scaffolding
10. **Tag pre-pivot state** — `git tag v0.0.7-verifier-pivot` before
    starting destructive deletions
11. **README + site copy** — reframe as "MatrixOmnix Hub: the cockpit
    for d2p"
12. **Merge to main**

## 10. Open questions / followups

### Not decided in this brainstorm (defer)

- **Standards versioning beyond linear**: branching (per-team, per-project
  standards) — explicitly out of scope for v1
- **Multi-user accounts and per-user audit trails** — defer until LAN
  deployment becomes a real need
- **Export formats** (CSV runs / Markdown standards bundle) — punt until
  someone asks
- **Visual diff in B history** — first version can ship plain
  monospace diff; rich diff later

### Decisions that may need revisit

- **Learner LLM weekly cadence** — may be too infrequent if d2p run
  volume is high, or too frequent if low. Revisit after 1 month of data.
- **Per-instance bearer token** — sufficient for self-hosted; revisit
  if hub is ever exposed publicly.
- **No bulk-decision UI in C page** — may be needed if learner
  occasionally emits 20+ proposals in one pass; defer until observed.

### Decisions that may render the hub partly obsolete (and that's fine)

- If d2p evolves to subsume cross-run memory itself, the QA-memory role
  of the hub shrinks — but PM and standards-governance roles persist.
- If a richer dashboard product (e.g., commercial) emerges that solves
  the same job, this hub can degrade to "just the standards API".

---

End of design spec. Implementation deferred to the writing-plans skill.
