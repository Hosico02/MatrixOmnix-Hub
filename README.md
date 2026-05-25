# MatrixOmnix Hub

**The PM + mentor cockpit for d2p productization runs.** d2p instances push events here; this hub aggregates them, learns standards drift over time (rule-based + weekly LLM), and surfaces decisions to a human via a Vue dashboard. d2p verifier pulls its current standards from here.

MatrixOmnix Hub does not run iterations and does not modify projects. It is read-only relative to project code; it is read-write relative to standards (with human approval gates).

`demo2project` remains as a backwards-compatible CLI alias for this repo.

## Quickstart

```bash
pnpm install
pnpm hub:build

# Initialize DB and create the first d2p instance token (one-time)
HUB_DB_PATH=~/.matrixomnix/hub.db pnpm hub:seed

# Start the hub
HUB_ADMIN_TOKEN=$(openssl rand -hex 16) pnpm hub:start

# Open the UI
open http://127.0.0.1:3030
```

Then on each d2p machine:

```bash
export HUB_URL=http://hub-host:3030
export HUB_TOKEN=<the token printed by hub:seed>
python run.py    # d2p auto-reports to hub
```

## How it works

d2p is the **do-layer** — an LLM-driven Python orchestrator
([`Hosico02/d2p`](https://github.com/Hosico02/d2p)) that runs Analyzer → Planner →
parallel Executors → QA and produces the actual code changes.

MatrixOmnix Hub (`Hosico02/demo2project`, this repo) is the **observe + learn layer**:

1. **Ingest** — d2p pushes `run_started`, `iteration_complete`, `verdict_emitted`,
   `finding_recorded`, and `run_terminated` events over HTTP after each action.
2. **Learn** — rule-based learner passes (R1–R5) run after every event batch; a
   weekly LLM pass (Opus) synthesises findings across all instances to propose
   standards updates.
3. **Decide** — a human reviews proposed changes in the Vue dashboard and approves
   or rejects. Approved changes create a new versioned standards entry.
4. **Distribute** — d2p verifier polls `/standards/:archetype` for the latest
   approved standards before each verification pass.

## Architecture

```
  d2p (do-layer, per machine)
        │ POST /api/events
        ▼
  ┌─────────────────────────────────────┐
  │  MatrixOmnix Hub                    │
  │                                     │
  │   Event ingest + dedup              │
  │           │                         │
  │           ▼                         │
  │   Rule-based learner (R1–R5)        │
  │   Weekly LLM summariser (Opus)      │
  │           │                         │
  │           ▼                         │
  │   Proposals (pending human gate)    │
  │           │                         │
  │           ▼                         │
  │   Standards store (versioned)       │
  └─────────────────────────────────────┘
        │ GET /api/standards/:archetype
        ▼
  d2p verifier (pulls latest standards)

  Human dashboard (Vue SPA, port 3030)
  ↔ Mentor notes, run timeline, approve/reject proposals
```

## Standards learning rules

| Rule | Trigger | Effect |
|---|---|---|
| R1 | Finding appears in ≥ 3 runs across ≥ 2 instances | Propose adding a new check |
| R2 | A check never fires across recent 50 runs | Propose removing the check |
| R3 | Median severity of a finding shifts | Propose adjusting severity weight |
| R4 | Archetype mis-detection rate rises | Propose probe threshold tweak |
| R5 | Same finding marked `wont_fix` repeatedly | Propose downgrading severity |

## CLI reference

The CLI is a thin wrapper retained for backwards compatibility and self-inspection:

```bash
matrixomnix init                              # Bootstrap config files
matrixomnix doctor                            # Environment + config diagnose
matrixomnix analyze --project <path>          # ProjectSnapshot + ProjectScore
matrixomnix gap --project <path> [--fast]     # GapReport with evidence verification
matrixomnix archetype --project <path>        # Detect project archetype
matrixomnix qa:preflight --project <path>     # Load active QA cases
matrixomnix qa:regression --project <path>    # Replay QA regression spec
matrixomnix self-check                        # analyze/gap on this repo
```

## Archetype detection

Project archetype is decided by a hybrid of declarative JSON probes
(`config/archetypes/*.json`) and built-in TypeScript probes. Each probe
scores positive and negative signals against a per-archetype threshold;
the detector sorts by ratio, then raw signal weight, then max possible
weight so a strict declarative library probe wins ties against a loose
built-in one.

```bash
pnpm matrixomnix archetype --project /path/to/repo
```

prints the full probe scoresheet — primary archetype, confidence, detected
signals and the top alternatives.

## Web

[`site/`](site/) — Vite/Vue app describing the MatrixOmnix Hub. Live at
<https://matrixomnix.vercel.app>.

## License

MIT. See [LICENSE](LICENSE).
