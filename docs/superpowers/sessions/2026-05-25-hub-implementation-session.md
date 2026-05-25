# Session: MatrixOmnix Hub implementation + landing site

> **Date:** 2026-05-25
> **Branch:** `main` (merged from `hub-implementation`)
> **Tags shipped:** `v0.0.7-verifier-pivot` (baseline), `v0.1.0-hub` (post-merge)
> **Repo renamed:** `Hosico02/demo2project` → `Hosico02/MatrixOmnix-Hub`
> **Live:** <https://matrixomnix.vercel.app>
> **Sister repo:** `../d2p` on branch `hub-integration` (commit `b96b2e6`)

## 1. TL;DR

Took the verifier-pivot project, declared it a dead-end against d2p's
own internal Verifier (per the d2p design spec), brainstormed a new
purpose, settled on **MatrixOmnix Hub** — a PM + mentor cockpit that
observes d2p runs across machines, learns standards drift, and gates
rule changes through a human-approval queue. Spec'd it, planned it,
executed all 35 tasks via subagent-driven dev, deployed it, renamed the
GitHub repo, and rebuilt the public umbrella landing site.

Net: 271 tests passing, end-to-end smoke green, both repos pushed,
Vercel live with a 4-page Vue umbrella site.

## 2. The arc (how we got here)

### Starting state

Session began at commit `ed4e420` on main — the repo had just pivoted
in the prior session to be a **verify-only MCP server** (`d2p-verify`).
The pre-existing untracked file was `docs/superpowers/specs/2026-05-22-d2p-verify-agent-design.md`
— a brainstorm of d2p's internal Verifier that effectively obsoletes
the verifier-MCP role this repo had just adopted.

### The realization

User opened with "this project has become a 废案 (dead end), can it
still help d2p?" After analysis:

- d2p's internal Verifier (per spec §8 categories) is a **strict
  capability superset** of what the verifier-MCP could do.
- A "Stage 0 deterministic pre-filter" was considered and rejected
  as premature optimization.
- The repo's truly unique assets (QA subsystem, standards adapter,
  gapAnalyzer with 3.8k LOC of rules) are valuable **library code**,
  but the verifier-MCP wrapper around them adds nothing forward.

### The pivot

Brainstormed a new role; settled on **MatrixOmnix Hub** — a
sidecar/cockpit that sits *outside* d2p's hot path:

- d2p instances push run events to Hub
- Hub aggregates across many runs + many projects
- Hub's learner identifies standards drift (rule-based + LLM)
- Hub surfaces proposed standards changes to a human-approval queue
- Approved standards are pulled by d2p's verifier on next run

Architecture choices locked in by the user during brainstorm:
1. Audience: still d2p, but in a sidecar role
2. Form: PM + mentor cockpit with a visual dashboard
3. Scope: small multi-project hub (self-hosted backend + DB + UI)
4. Coupling: active closed-loop (Hub holds standards, d2p pulls them)
5. Learner: hybrid rule + weekly LLM, gated by human approval
6. UI: pages are for humans, not agents — every internal ID gets
   translated to plain Chinese at render time

## 3. What got shipped

### This repo (`Hosico02/MatrixOmnix-Hub`)

**Hub backend** — `src/hub/`
- Hono server, single Node process, binds 127.0.0.1:3030 by default
- SQLite + Drizzle ORM, 10 tables, single file at `~/.matrixomnix/hub.db`
- API: `POST /api/events` (d2p ingest), `GET /api/standards/:archetype`
  (d2p pull, ETag/304), `GET /api/runs`, `GET /api/proposals`,
  `POST /api/proposals/:id/decision`, `POST /runs/:id/notes`,
  `POST /admin/learner/trigger`, `GET /admin/health`
- Auth: bcrypt per-instance bearer tokens for d2p; single
  `HUB_ADMIN_TOKEN` for `/admin/*`
- ETag/304 on standards pull keeps bandwidth at ~0 when nothing
  changed

**Learner** — `src/hub/learner/`
- 5 SQL rules: R1 persistent finding · R2 dead check · R3 severity
  drift · R4 archetype drift · R5 repeated residual
- Debounced 60s after each event ingest
- Weekly Opus summariser (Sunday 03:00 cron) for semantic patterns
  the rules can't catch
- Dedup + supersede so the inbox doesn't flood
- Recent-reject suppression damps future re-proposals

**Vue UI** — `site/`
- Vue 3 + Pinia + Vue Router + Tailwind
- Three pages: 运行 (Runs, default) / 规则 (Standards) / 待办 (Mentor inbox)
- Plus drill-downs: RunDetail / StandardDetail / ProposalDetail
- All internal IDs humanized to Chinese via `site/src/humanize.ts`
- 30s polling on active page; pending-count badge in nav
- Served by Hono backend from `site/dist`

**d2p HubClient** — in `../d2p/d2p/hub_client.py`
- 3-tier standards fallback: live fetch → local cache → baked-in
- `push_event` queues to `~/.d2p/hub_cache/pending_events.jsonl`
  on failure, flushes on next successful call
- Wired into d2p's orchestrator (run lifecycle events) and verifier
  (standards pull at start). Verifier itself is still a stub —
  awaiting full implementation per the d2p verify-agent design spec.

**Tests**: 271/271 passing across vitest (hub) + pytest (HubClient)
**Smoke**: `bash scripts/hub-smoke.sh` ends with `smoke OK`

### Public landing site (`landing-app/`)

- Restored the Vue 3 multi-page umbrella site from
  `v0.0.7-verifier-pivot` tag (HELLO I'M MatrixOmnix hero, FlipPanel
  cards, cursor effects, About / Service / Contact pages)
- Rewrote all content where it mentioned `verify-layer` → Hub
- Replaced the three architecture diagrams (`framework-loop.png`,
  `harness-map.png`, `deployment-flow.png`) with hand-written SVGs
  that reflect the current d2p ↔ Hub topology
- Deployed to <https://matrixomnix.vercel.app>

## 4. Repo + deploy state

| What | Where | Notes |
|---|---|---|
| GitHub | `Hosico02/MatrixOmnix-Hub` | renamed from `demo2project`; old URL still 301-redirects |
| main branch | `16c0294` | merged from `hub-implementation` |
| tags | `v0.0.7-verifier-pivot`, `v0.1.0-hub` | both pushed |
| Vercel project | linked to `MatrixOmnix-Hub` repo | `vercel.json` deploys `landing-app/dist` |
| Live URL | <https://matrixomnix.vercel.app> | static SPA, no backend |
| Hub UI URL | localhost only | `http://127.0.0.1:3030` after `pnpm hub:start` |
| Sister d2p repo | `../d2p` on branch `hub-integration`, commit `b96b2e6` | HubClient + wiring; NOT yet merged to main in d2p |

## 5. Open threads

### Not yet done

- **d2p `hub-integration` branch is not merged into d2p's main.** The
  HubClient + verifier/orchestrator/config wiring is on its own
  branch. Decide when to merge.
- **d2p's internal Verifier itself is not implemented** — only a
  NotImplementedError stub. The full design lives at
  `docs/superpowers/specs/2026-05-22-d2p-verify-agent-design.md`.
  Until shipped, the Hub can collect d2p run events but the
  standards pull path is one-way (d2p reads, never produces verdicts
  the learner can chew on).
- **No real run data yet.** The Hub has been smoke-tested but never
  fed a real d2p execution. First real run is the next milestone.
- **LLM summariser cron is wired but un-tested in prod.** Will fire
  next Sunday 03:00 local if `ANTHROPIC_API_KEY` is set.

### Existing 12k LOC subsystems left untouched

The hub plan explicitly **did not** wire the existing
`src/core/gapAnalyzer.ts`, `src/qa/*`, `src/standards/*` subsystems
into the Hub backend. They remain in the repo as library code,
available for future learner enhancements (e.g., a richer mentor
critique that calls `QASimilarity` for pattern clustering). The
adapter work would roughly double the plan size and was deferred.

## 6. Key decisions log

| Decision | Choice | Why |
|---|---|---|
| New role for this repo | PM + mentor cockpit, not per-iter verifier | d2p's internal Verifier is a strict superset; competing was hopeless |
| Standards source of truth | Hub holds them; d2p pulls | Closes the learning loop without making the repo a runtime dep |
| Learner gating | Always human-approve | Auto-update was rejected for governance reasons |
| Storage | SQLite single file | Multi-project but local-first; Drizzle lets us swap to Postgres later if needed |
| UI design principle | Pages are for humans, not agents | All internal IDs translated to Chinese at render layer |
| Default language | Chinese | Operator-local tool, single user (you) |
| Two-page split for Vercel | Initially yes, then no | First static umbrella + static hub-detail, then user said "bring back the HELLO hero Vue site" → restored the full Vue app, dropped the static pages |
| Vite asset inlining | Disabled (`assetsInlineLimit: 0`) | Below-4KB SVGs were silently inlined as base64 data URLs; confusing for debugging |

## 7. Surprises (worth remembering)

- **pnpm `allowBuilds`** — `better-sqlite3` install was blocked because
  `pnpm-workspace.yaml` had `better-sqlite3: set this to true or false`
  as a literal TODO marker. Flipped to `true`. Without this, all hub
  tests fail at the install step.
- **Vite asset inline threshold** — by default any asset < 4096 bytes
  is inlined as a base64 data URL in the JS bundle. My
  `hub-layers.svg` was 3761 bytes → silently inlined → looked missing
  from `dist/assets/`. Fix: set `assetsInlineLimit: 0` in
  `landing-app/vite.config.js`. Spent ~30 min debugging this.
- **Vue Router 5 vs 4** — the subagent reported installing
  `vue-router 5.0.7` which doesn't actually exist (Vue Router 4.x is
  for Vue 3). Build worked anyway so probably a typo in the report;
  actual installed version is what's in `site/package.json` after
  `pnpm add vue-router` (which resolves to v4.x).
- **zod v4 arity** — `z.record(z.any())` is invalid in zod v4 — it
  requires `z.record(z.string(), z.any())`. The subagent on Task 7.2
  caught and fixed this in `src/hub/routes/events.ts` as a side fix.
- **GitHub URL redirects** — renaming
  `demo2project` → `MatrixOmnix-Hub` left GitHub automatically
  301-redirecting the old URL. Did not break any deep links in
  external systems, but did update README + landing + d2p references
  for canonical accuracy.

## 8. Quick reference

### Run the Hub locally

```bash
pnpm install
pnpm hub:build

HUB_DB_PATH=~/.matrixomnix/hub.db pnpm hub:seed       # one-time, prints HUB_TOKEN
HUB_ADMIN_TOKEN=$(openssl rand -hex 16) pnpm hub:start

open http://127.0.0.1:3030
```

### Connect d2p

```bash
cd ../d2p
git switch hub-integration         # branch not yet merged to d2p main
export HUB_URL=http://127.0.0.1:3030
export HUB_TOKEN=<the token from hub:seed>
python run.py /path/to/demo
```

### Smoke test

```bash
bash scripts/hub-smoke.sh          # ends with `smoke OK`
```

### Landing site

```bash
pnpm landing:dev                   # local dev (5173)
pnpm landing:build                 # build to landing-app/dist
pnpm landing:deploy                # build + vercel --prod
```

### Useful files

- `docs/superpowers/specs/2026-05-25-matrixomnix-hub-design.md` — full design spec
- `docs/superpowers/specs/2026-05-22-d2p-verify-agent-design.md` — d2p Verifier spec (deferred to d2p track)
- `docs/superpowers/plans/2026-05-25-matrixomnix-hub.md` — implementation plan (4906 lines, 7 phases, ~35 tasks)
- `src/hub/` — backend (server, routes, db, learner, auth, config)
- `site/` — Hub UI (Vue 3, served by Hono backend)
- `landing-app/` — public umbrella site (Vue 3, deployed to Vercel)
- `scripts/hub-smoke.sh` — end-to-end smoke
- `../d2p/d2p/hub_client.py` — Python client in d2p

## 9. What to do next (when this session resumes or hands off)

1. **First real d2p run with Hub connected.** Pick a real demo,
   `pnpm hub:start` here, `export HUB_URL+HUB_TOKEN` on d2p side,
   run d2p, watch the dashboard populate.
2. **Decide on d2p `hub-integration` branch merge timing.** It's
   ready; just hasn't been merged to d2p main yet.
3. **Implement d2p's internal Verifier** (see `2026-05-22-d2p-verify-agent-design.md`)
   — this is the upstream blocker for the standards-update loop
   to actually mean something. Until then, the learner has nothing
   to learn from.
4. **Iterate on landing page copy / SVG diagrams** as the
   architecture evolves. Current SVGs assume d2p's Verifier exists;
   if delayed, may want to soften that framing.
5. **Add monitoring / backup story** for the SQLite file once real
   data starts accumulating. Spec mentions daily rsync backups but
   no cron is set up yet.

## 10. Session statistics

- ~80+ commits on `hub-implementation` branch before merge
- 1 merge commit + ~5 follow-up commits on main for landing site
- 1 GitHub repo rename
- 4 Vercel production deploys
- ~35 subagent dispatches (one implementer per plan task)
- All in one session, no plan revisions needed mid-execution

---

**End of session compression.** Future sessions should be able to pick
up by reading this doc plus the design spec + plan. The current
working tree is clean; everything is committed and pushed.
