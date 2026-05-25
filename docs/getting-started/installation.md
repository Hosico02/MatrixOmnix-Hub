# Installation

```bash
git clone https://github.com/Hosico02/MatrixOmnix-Hub.git
cd MatrixOmnix-Hub
pnpm install
pnpm build
node dist/cli/index.js doctor
```

Requires Node 20+ and pnpm 11+.

## What this gives you

A CLI at `node dist/cli/index.js` and a TypeScript SDK at `src/sdk/index.ts`.

After install:

1. `pnpm demo2project doctor` — environment check
2. `pnpm demo2project init --interactive` — setup wizard
3. `pnpm demo2project quickstart --use-example` — 5-minute demo

## Optional

- **Claude CLI** — required for the `claude-code` / `claude-cli` provider. Other providers work without it.
- **Python 3** — only needed if you want full Python-archetype support (current handler coverage is limited; see roadmap).
