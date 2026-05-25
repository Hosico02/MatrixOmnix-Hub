# Session: Hub polish + repo cleanup (post-implementation)

> **Date:** 2026-05-25 (continuation of `2026-05-25-hub-implementation-session.md`)
> **Branch:** `main`
> **Final tags:** `v0.0.7-verifier-pivot` (Hub baseline) · `v0.1.0-hub` (current)
> **Live:** <https://matrixomnix.vercel.app>
> **GitHub:** `Hosico02/MatrixOmnix-Hub` (renamed from `demo2project`)

## 1. TL;DR

After the Hub was implemented and shipped in the prior session, this
session was polish + aggressive cleanup. Restored the umbrella Vue
landing site (the "HELLO I'M MatrixOmnix" page) with rewritten Hub
framing and new SVG diagrams. Then did 4 cleanup waves removing
everything verifier-pivot left behind — ~217 files / -10k LOC. Repo
went from "Hub on top of verifier-pivot scaffolding" to "Hub only".
Also renamed the GitHub repo and pruned old releases/tags.

## 2. Where we started

The implementation session ended with main at `0dfc6bd` (the Hub merge
commit). Working tree clean, all tests passing (271 then), Hub backend
+ UI + d2p HubClient all functional, but the repo still carried
~12k LOC of verifier-pivot inheritance:

- `src/{agents,cli,core,security,standards,utils}/` — old harness
- `src/qa/*` — failure fingerprint subsystem
- `templates/`, `recipes/`, `examples/`, `benchmarks/` — fixtures
- `config/` — verifier-pivot policy JSON
- `docs/` — ~100 .md files documenting the old architecture
- `tests/` — most tests for the old subsystems
- Various stale tags + GitHub releases from v0.0.1–v0.0.6

## 3. What happened, in order

### 3.1 README + GitHub push (`abfeb27` ← `01fd8de` ← `0dfc6bd`)

- Updated README to reframe as MatrixOmnix Hub (was already mostly done)
- `git push origin main --tags` published the Hub branch + tags

### 3.2 First Vercel deploy

- Realized the public site (still serving the old verifier-pivot Vue
  app on Vercel) was now stale
- Wrote a minimal static `landing/index.html` (single file, dark-themed,
  no JS) introducing the Hub
- Updated `vercel.json` to serve `landing/` directly
- Deployed → live at <https://matrixomnix.vercel.app>

### 3.3 GitHub repo rename

- `gh repo rename MatrixOmnix-Hub --repo Hosico02/demo2project --yes`
- Updated `git remote set-url origin` locally
- Scrubbed `Hosico02/demo2project` URL refs in README, landing, install
  docs (kept the `demo2project` CLI alias unchanged — different concept)
- GitHub auto-301-redirects the old URL

### 3.4 Umbrella page → "HELLO I'M MatrixOmnix" restored (`901f294`)

- User pushed back on the minimal static landing: "previous page was
  the umbrella, this is just one branch"
- First attempt: split static into `/` (umbrella) + `/hub` (detail)
- User: "I mean the previous page — the one with HELLO I'M MatrixOmnix
  big text"
- Solution: restored the full Vue 3 multi-page site from
  `v0.0.7-verifier-pivot` tag into new `landing-app/` directory
  (10 files: App.vue + main.js + style.css + vite.config + index.html
  + 4 SVG/PNG assets)
- Rewrote all content where it mentioned verify-layer → Hub framing
- Dropped the static landing/ entirely

### 3.5 SVG diagrams replace stale PNGs (`16c0294`)

The three architecture diagrams in About page were PNG snapshots of
the old verify-layer architecture. Replaced with hand-written SVGs:

- `framework-loop.svg` — d2p ↔ Hub loop (POST /api/events, GET
  /api/standards with ETag/304)
- `hub-layers.svg` (renamed from `harness-map`) — Hub's 3-tier
  internal stack: Data → Learn → Decide
- `deployment-flow.svg` — many d2p clients → one self-hosted Hub
  process + fail-safe notes

Each SVG uses `prefers-color-scheme: light` media query so it adapts.

**Debugging detour:** `hub-layers.svg` (3761 bytes) was getting inlined
as a base64 data URL in the JS bundle by Vite's default
`assetsInlineLimit: 4096`. Looked like it was "missing" because:
- `dist/assets/` only showed 2 SVGs
- `grep "hub-layers" dist/assets/index-*.js` returned 0
- But the page rendered fine in browsers (because data URLs work)

Fix: set `assetsInlineLimit: 0` in `landing-app/vite.config.js` to
force all assets out as separate files. Spent ~30 min on this; worth
documenting because it's silently easy to misdiagnose.

### 3.6 Cleanup wave 1 — gitignore + reports (`8e43736` + `f2274a3`)

- Untracked 26 `reports/*` files (eval / generalization-bench /
  long-run / workspace snapshots — all auto-generated)
- Reorganized `.gitignore` with section comments; added `.vite/`,
  `.pytest_cache/`, `*.bak`, `.idea/`, `.vscode/`, `.claude/`,
  `Thumbs.db`. Local files preserved on disk.

### 3.7 Cleanup wave 2 — orphan fixtures (`4d908e5`)

Deleted in one commit:
- `templates/` (17 files: Claude Code hooks + old GH workflow YAMLs)
- `recipes/` (7 archetype-productization JSONs)
- `examples/` (10 files: bad-demo fixtures + SDK examples)
- `benchmarks/` (42 files: generalization-bench fixtures)
- `scripts/smoke-demo-project.ts` (import-broken)
- `scripts/generalization-bench.mjs` (no longer needed)
- 5 test files that depended on the deleted fixtures
- Renamed `.github/workflows/demo2project-ci.yml` → `ci.yml`,
  display name updated to "MatrixOmnix Hub CI"
- Cleaned `copy-assets.mjs` (no more templates/claude copy) and
  `default-security-policy.json` (no more templates/claude/ in the
  high-risk write path list)

Net: -4977 lines.

### 3.8 Cleanup wave 3 — QA subsystem (`82bb904`)

Deleted:
- `qa/specs/` (2 JSON files)
- `src/qa/*` (12 files)
- 2 CLI commands (`qaPreflight.ts`, `qaRegression.ts`)
- 8 `tests/qa*.test.ts` files
- `package.json` scripts (qa:preflight, qa:regression)
- `src/utils/paths.ts` helpers (qaCasesPath, regressionSpecPath)
- Scrubbed `selfCheck.ts` (removed QACaseStore usage, kept analyze/gap)

Spec's "honest scope note" had preserved this for hypothetical future
learner enhancements; in practice R1-R5 don't use it. If a future
learner rule wants `QASimilarity`-style fingerprint clustering,
restore from `v0.0.7-verifier-pivot` tag.

Net: -2301 lines.

### 3.9 Cleanup wave 4 — everything else (`1e4867d`)

The big one. Deleted:
- `src/{agents,cli,core,security,standards,utils}/` — everything
  outside `src/hub`. Audited first: Hub only imports from npm + its
  own subtree, so the rest could go safely.
- `tests/` outside `tests/hub/` (16 files)
- `docs/` outside `docs/superpowers/` (~94 files)
- `config/` (verifier-pivot policy/archetype JSON, 13 files)
- `render.yaml` (stale Render.com deploy)
- `CHANGELOG.md` (verifier-pivot history)
- 4 old `docs/superpowers/{specs,plans}/` files (kept only Hub
  spec/plan/session + d2p Verifier spec)
- Stray `.DS_Store` files

Plus rewrites:
- `package.json`: bumped name to `matrixomnix-hub`, version to
  `0.1.0`, dropped CLI bins (matrixomnix, demo2project) and all CLI
  scripts. Dropped `@modelcontextprotocol/sdk` + `tsup` from deps.
- `scripts/copy-assets.mjs`: only copies `src/hub/db/migrations` now
- `.env.example`: rewritten for `HUB_*` vars
- `README.md`: dropped CLI reference + archetype detection sections

Net: ~10k LOC change. Repo got roughly 10× smaller.

### 3.10 Release + tag cleanup

- `gh release delete` for `v0.0.1`..`v0.0.6` with `--cleanup-tag`
  (removes both the release AND the underlying tag, locally + remote)
- Then `git tag -d` + `git push --delete` for the 3 tag-only
  remnants: `v0.0.6-final`, `v0.0.7`, `v0.0.8`

Final tags: just `v0.0.7-verifier-pivot` + `v0.1.0-hub`.

## 4. Final repo shape

```
demo2project/                              (on-disk name, GitHub: MatrixOmnix-Hub)
├── src/hub/                               ← backend, self-contained, 27 files
│   ├── server.ts · index.ts · config.ts
│   ├── auth.ts · instanceLookup.ts
│   ├── routes/   (events, standards, runs, proposals, admin)
│   ├── ingest/   (payloadHash, eventHandlers)
│   ├── db/       (schema, client, migrations)
│   ├── learner/  (rules R1-R5, runner, dedup, llm_summariser)
│   └── cli/seed.ts
├── site/                                  ← Hub UI (Vue 3 + Pinia + Tailwind), 25 files
├── landing-app/                           ← public umbrella (Vue 3), 10 files
├── tests/hub/                             ← 21 files / 55 tests
├── docs/superpowers/
│   ├── sessions/                          ← this doc + implementation session
│   ├── specs/    (Hub design + d2p Verifier design)
│   └── plans/    (Hub implementation plan)
├── scripts/      (copy-assets.mjs, hub-smoke.sh)
├── .github/workflows/ci.yml               ← MatrixOmnix Hub CI
└── (configs: package.json, tsconfig, vercel.json, drizzle.config,
              vitest.config, pnpm-workspace, .env.example,
              .npmrc, .gitignore, LICENSE, README.md)
```

## 5. Cleanup statistics

| Wave | Commit | What | Net lines |
|---|---|---|---:|
| 1 | `8e43736` + `f2274a3` | gitignore + untrack reports/ | -3577 |
| 2 | `4d908e5` | templates / recipes / examples / benchmarks + dead scripts + dead tests | -4977 |
| 3 | `82bb904` | QA subsystem | -2301 |
| 4 | `1e4867d` | everything else not Hub-related | ~-10k (217 files) |
| **Total** | | | **~-20k** |

Other commits this session: README updates, landing-app restoration,
SVG diagrams, repo rename URL scrubs.

## 6. What was preserved + why

- **`src/hub/`** — the whole product.
- **`site/`** — the Hub UI; served by Hono backend from `site/dist`.
- **`landing-app/`** — public Vercel site.
- **`tests/hub/`** — 55 Hub-specific tests.
- **`docs/superpowers/`** — compressed context; future sessions
  pick up from here.
- **`v0.0.7-verifier-pivot` tag** — pre-Hub baseline, in case the QA
  subsystem or other deleted code needs to be revived. Restore with
  `git checkout v0.0.7-verifier-pivot -- src/qa/` etc.
- **`v0.1.0-hub` tag** — current Hub release.

## 7. Verification (all green at session end)

- `pnpm build` clean
- `pnpm exec vitest run` → 21 files / 55 tests passing
- `pnpm --dir landing-app build` OK
- `pnpm --dir site build` OK
- `bash scripts/hub-smoke.sh` → `smoke OK`
- <https://matrixomnix.vercel.app/> → HTTP 200, serves the Vue umbrella site
- GitHub repo + 2 tags pushed

## 8. Open threads (same as prior session)

Nothing new opened. Carried over from the implementation session:

1. **d2p `hub-integration` branch is not merged into d2p main yet.**
   The HubClient + verifier/orchestrator/config wiring is ready;
   commit `b96b2e6` on `../d2p`.
2. **d2p's internal Verifier still a NotImplementedError stub.**
   Until shipped, the standards-update loop has no producer.
3. **No real run data yet** — Hub smoke-tested only.
4. **Weekly LLM summariser cron is wired but un-tested in prod.**

## 9. Quick reference

```bash
# Start Hub
pnpm install
pnpm hub:build
HUB_DB_PATH=~/.matrixomnix/hub.db pnpm hub:seed       # one-time
HUB_ADMIN_TOKEN=$(openssl rand -hex 16) pnpm hub:start
open http://127.0.0.1:3030

# Connect d2p (on any machine with network to Hub)
cd ../d2p && git switch hub-integration
export HUB_URL=http://127.0.0.1:3030
export HUB_TOKEN=<from hub:seed output>
python run.py

# Smoke
bash scripts/hub-smoke.sh                              # → smoke OK

# Public landing
pnpm landing:dev          # local
pnpm landing:deploy       # vercel --prod

# Resurrect deleted code from baseline tag
git checkout v0.0.7-verifier-pivot -- <path>
```

### Key files

- `docs/superpowers/specs/2026-05-25-matrixomnix-hub-design.md` — Hub design spec
- `docs/superpowers/specs/2026-05-22-d2p-verify-agent-design.md` — d2p Verifier design (deferred to d2p)
- `docs/superpowers/plans/2026-05-25-matrixomnix-hub.md` — Hub implementation plan
- `docs/superpowers/sessions/2026-05-25-hub-implementation-session.md` — first session log
- `docs/superpowers/sessions/2026-05-25-hub-cleanup-session.md` — this doc

---

**End of cleanup session.** Repo is now in a clean, focused, deployable
state with only Hub-related code. Future sessions can pick up from this
doc + the implementation session + the design spec + plan.
