<template>
  <div class="app-shell" :style="cursorStyle">
    <div v-if="page === 'home'" class="cursor-capture" aria-hidden="true"></div>
    <div v-if="page === 'home'" class="cursor-core" aria-hidden="true"></div>

    <header class="topbar">
      <button class="brand" type="button" @click="navigate('home')" aria-label="MatrixOmnix home">
        MatrixOmnix
      </button>
      <nav class="nav" aria-label="Primary navigation">
        <button v-for="item in navItems" :key="item.id" type="button" :aria-current="page === item.id ? 'page' : undefined" @click="navigate(item.id)">
          {{ item.label }}
        </button>
      </nav>
    </header>

    <main class="page">
      <template v-if="page === 'home'">
        <section class="hero" id="home">
          <div class="hero-center">
            <div ref="titleStackRef" class="title-stack">
              <div class="title-layer title-layer--en">
                <h1 class="hero-title hero-title--en">
                  <span class="hero-title__intro">HELLO I'M</span>
                  <span class="hero-title__name">MatrixOmnix</span>
                </h1>
              </div>
              <div class="title-layer title-layer--cn">
                <img class="hero-icon" src="./assets/matrixomnix_icon.svg" alt="MatrixOmnix icon - 全域智能矩阵" />
              </div>
            </div>

            <p class="subcopy">
              MatrixOmnix turns a rough demo into a verified product. Two subsystems work together: <strong>MatrixOmnix Forge</strong> drives the demo through analyzer / planner / parallel executors / QA to produce changes, and <strong>MatrixOmnix Hub</strong> observes every run, learns standards drift over time, and surfaces decisions to a human via a 中文 Vue dashboard. Loose-coupled today; the loop is data → learning → distribution. A third sibling, <strong><a class="subcopy-link" href="https://matrixomnixpaper.vercel.app" target="_blank" rel="noopener">MatrixOmnix Paper</a></strong>, applies the same multi-agent philosophy to a different surface — predicting venue-level acceptance for academic papers across every domain.
            </p>
          </div>
        </section>

        <section class="panel-grid" aria-label="MatrixOmnix subsystems">
          <FlipPanel id="do" title="Do · Forge" :active="flippedPanels.has('do')" @open="flipOn" @close="flipOff">
            LLM-driven Python orchestrator: Analyzer searches the web for mature competitor products, Planner diffs them against the demo, parallel Executors fill the gaps, QA emits failing tests as permanent regression guardrails. No hardcoded demo-type detectors.
          </FlipPanel>
          <FlipPanel id="observe" title="Observe · Hub" :active="flippedPanels.has('observe')" @open="flipOn" @close="flipOff">
            Localhost-first multi-project hub (Hono + SQLite). Forge instances push run events here; the learner identifies standards drift via 5 SQL rules + a weekly Opus pass; pending standards changes go into a 中文 inbox where you approve / reject / edit. Forge's verifier polls for the latest approved standards on each run.
          </FlipPanel>
          <FlipPanel id="goal" title="Goal · demo → product" :active="flippedPanels.has('goal')" @open="flipOn" @close="flipOff">
            One slow loop: Forge produces changes → Hub records + learns from many runs → human approves new standards → Forge's verifier picks them up on the next run. Hub down? Forge uses its cached standards and keeps running. Forge down? Hub is just an idle dashboard. Independent but stronger together.
          </FlipPanel>
        </section>

        <section class="sibling-card" aria-label="Two subsystems, one loop">
          <div class="sibling-card__body">
            <div class="sibling-card__kicker">Two subsystems, one loop</div>
            <h2 class="sibling-card__title">
              How <a href="https://github.com/Hosico02/d2p" target="_blank" rel="noopener">MatrixOmnix Forge</a> and the Hub form the loop
            </h2>
            <p class="sibling-card__copy">
              The do-layer (Forge) and the observe-layer (Hub) are deliberately decoupled. Forge reads the demo, plans tasks, runs parallel Executors, generates failing tests as permanent regression guardrails — and pushes <code>run_started</code> / <code>iteration_complete</code> / <code>verdict_emitted</code> / <code>finding_recorded</code> events to the Hub over HTTP. The Hub aggregates events across all projects, runs 5 SQL learner rules + a weekly Opus pass to detect standards drift, and surfaces proposed rule changes into a 中文 inbox. You approve; the new standards land in <code>standard_versions</code>; next time Forge's verifier polls <code>/standards/:archetype</code>, it gets the new version.
            </p>
            <ul class="sibling-card__bullets">
              <li><strong>MatrixOmnix Forge</strong> · ~14k LOC Python · LLM-driven, no hardcoded demo-type detectors · Claude / Codex / MiniMax with per-role model routing</li>
              <li><strong>Hub</strong> · ~13k LOC TypeScript · Hono + SQLite + Drizzle backend · Vue 3 + Pinia + Tailwind dashboard · full vitest + pytest suite green</li>
              <li><strong>integration</strong> · HTTP best-effort with bcrypt-hashed per-instance bearer tokens; ETag/304 on standards pull; lifecycle events stream over <code>/api/events</code></li>
              <li><strong>fail-safe</strong> · Hub down → Forge uses cached or baked standards · Forge down → Hub is just an idle dashboard</li>
              <li><strong>governance</strong> · every standards change goes through human approval; rejections weakly damp future proposals</li>
            </ul>
            <p class="sibling-card__pair">
              Neither subsystem absorbs the other. Forge is the engine; the Hub is the cockpit. Together they form the slow loop that turns one-off productization runs into accumulated knowledge.
            </p>
            <a class="sibling-card__cta" href="https://github.com/Hosico02/d2p" target="_blank" rel="noopener">
              View MatrixOmnix Forge on GitHub →
            </a>
          </div>
        </section>

        <section class="sibling-card sibling-card--paper" aria-label="Sibling project: MatrixOmnix Paper">
          <div class="sibling-card__body">
            <div class="sibling-card__kicker">Sibling project</div>
            <h2 class="sibling-card__title">
              <a href="https://matrixomnixpaper.vercel.app" target="_blank" rel="noopener">MatrixOmnix Paper</a> — multi-agent acceptance predictor for academic papers
            </h2>
            <p class="sibling-card__copy">
              Paper is the third project in the MatrixOmnix family, independent from the Forge ↔ Hub loop. It applies the same multi-agent ethos to a different problem: given a paper and a target venue, a jury of domain-expert critics (Novelty, Methodology, Clarity) debates and produces a calibrated per-venue acceptance probability — with explicit agent disagreements as the explanation, not just a score. Works across every domain (CS, Physics, Bio, Med, Econ, SocSci), not the CS-only narrow box of existing predictors.
            </p>
            <ul class="sibling-card__bullets">
              <li><strong>stack</strong> · FastAPI + Anthropic + MiniMax backend · Vue 3 + Vite + Pinia + Tailwind SPA · SQLite for predictions</li>
              <li><strong>inputs</strong> · arXiv URL or direct PDF upload; wizard-style 5-step submission</li>
              <li><strong>deployment</strong> · hosted frontend at <a href="https://matrixomnixpaper.vercel.app" target="_blank" rel="noopener">matrixomnixpaper.vercel.app</a>; backend self-hostable</li>
              <li><strong>shape today</strong> · ~2k LOC source · CS + Physics experts shipping · Bio / Med experts in progress · pytest green</li>
              <li><strong>relationship</strong> · same brand, same multi-agent philosophy, separate codebase — no shared imports with Forge or Hub</li>
            </ul>
            <div class="sibling-card__ctas">
              <a class="sibling-card__cta" href="https://matrixomnixpaper.vercel.app" target="_blank" rel="noopener">
                Open the hosted UI →
              </a>
              <a class="sibling-card__cta sibling-card__cta--ghost" href="https://github.com/Hosico02/MatrixOmnix-Paper" target="_blank" rel="noopener">
                View on GitHub →
              </a>
            </div>
          </div>
        </section>
      </template>

      <section v-else-if="page === 'about'" class="content-page about-page" id="about">
        <PageHeading kicker="About" title="MatrixOmnix is a goal, not a single tool.">
          The goal: turn a rough demo into a verified product. Current implementation: <strong>MatrixOmnix Forge</strong> (LLM-driven Python orchestrator that produces changes) plus <strong>MatrixOmnix Hub</strong> (TypeScript backend + Vue dashboard that observes runs, learns standards drift, and gates rule changes through human approval). Two repos, deliberately decoupled. Forge is the engine; Hub is the cockpit. A third project, <strong>MatrixOmnix Paper</strong>, lives outside that loop and reuses the multi-agent ethos for a different surface — venue-level acceptance prediction for academic papers across every domain.
        </PageHeading>

        <div class="image-grid" aria-label="MatrixOmnix architecture diagrams">
          <figure>
            <img src="./assets/framework-loop.svg" alt="The MatrixOmnix Forge ↔ Hub loop: Forge posts lifecycle events to the Hub via /api/events; the Hub serves approved standards back via /api/standards with ETag/304." />
            <figcaption>Two subsystems · events flow right, standards flow left</figcaption>
          </figure>
          <figure>
            <img src="./assets/hub-layers.svg" alt="Hub internal stack: three stacked layers — data (SQLite tables), learn (5 SQL rules plus weekly LLM pass produce proposals), decide (human approves proposals which become new standards versions)." />
            <figcaption>3 layers · 数据 → 学习 → 决定</figcaption>
          </figure>
          <figure>
            <img src="./assets/deployment-flow.svg" alt="Deployment topology: many MatrixOmnix Forge instances all point at one self-hosted Hub. Fail-safe: Hub down means Forge uses cached standards and queues events locally; Forge down means the Hub is just an idle dashboard." />
            <figcaption>Deployment · many Forge clients, one Hub process</figcaption>
          </figure>
        </div>

        <section class="project-cards" aria-label="Explore the MatrixOmnix family">
          <article class="project-card">
            <div class="project-card__kicker">Live dashboard</div>
            <h2 class="project-card__title">MatrixOmnix Hub</h2>
            <p class="project-card__copy">
              The observe-layer cockpit — a 中文 Vue dashboard over the Hono + SQLite backend. Browse runs, standards drift, and the human approval inbox in the browser. This live deployment is a seeded demo.
            </p>
            <div class="project-card__ctas">
              <a class="project-card__cta" href="https://matrixomnix-hub.vercel.app" target="_blank" rel="noopener">Open the Hub →</a>
              <a class="project-card__cta project-card__cta--ghost" href="https://github.com/anzy-renlab-ai/MatrixOmnix-Hub" target="_blank" rel="noopener">GitHub →</a>
            </div>
          </article>
          <article class="project-card">
            <div class="project-card__kicker">Live app</div>
            <h2 class="project-card__title">MatrixOmnix Paper</h2>
            <p class="project-card__copy">
              Multi-agent acceptance predictor for academic papers. A jury of domain-expert critics (Novelty, Methodology, Clarity) debates and returns a calibrated per-venue acceptance probability — with their disagreements as the explanation.
            </p>
            <div class="project-card__ctas">
              <a class="project-card__cta" href="https://matrixomnixpaper.vercel.app" target="_blank" rel="noopener">Open Paper →</a>
              <a class="project-card__cta project-card__cta--ghost" href="https://github.com/Hosico02/MatrixOmnix-Paper" target="_blank" rel="noopener">GitHub →</a>
            </div>
          </article>
          <article class="project-card">
            <div class="project-card__kicker">CLI + API · Python</div>
            <h2 class="project-card__title">MatrixOmnix Arena</h2>
            <p class="project-card__copy">
              Multi-competitor evaluation arena. Run multiple LLM/agent competitors against a shared task suite, score them, and get a leaderboard with surfaced judge disagreements. Every agent — sibling projects included — is evaluated as a black box.
            </p>
            <div class="project-card__ctas">
              <a class="project-card__cta" href="https://github.com/Hosico02/MatrixOmnix-Arena" target="_blank" rel="noopener">GitHub →</a>
            </div>
          </article>
        </section>

        <section class="about-narrative" aria-label="MatrixOmnix overview">
          <article>
            <h2>Why two subsystems</h2>
            <p>
              Coding agents are good at producing code; they are systematically bad at remembering yesterday's mistake on tomorrow's project. Forge is great at making one demo into a product — but once the run ends, the lessons evaporate. The Hub is the part of MatrixOmnix that doesn't forget: it captures every run's events, identifies recurring blind spots, proposes standards updates, and (with human approval) feeds them back into Forge's verifier prompt. Two stacks, one slow loop: do → observe → learn → distribute.
            </p>
          </article>
          <article>
            <h2>What MatrixOmnix Forge does</h2>
            <p>
              Forge (the do-layer) is an LLM-driven Python orchestrator. Its Analyzer reads the demo and searches the web for mature competitor products. Its Planner diffs them against the demo and emits a small batch of file-level tasks. Parallel Executors apply changes under a sandbox with health-rollback and baseline-test guards. Its QA agent emits failing tests as bug reports that stay in <code>tests/d2p_qa/</code> as a permanent regression corpus. After each lifecycle event Forge best-effort POSTs to the Hub's <code>/api/events</code>.
            </p>
          </article>
          <article>
            <h2>What the Hub does</h2>
            <p>
              MatrixOmnix Hub is a localhost-first multi-project cockpit. Hono backend serves the <code>/api/*</code> ingest + read surfaces; 10 SQLite tables hold runs / iterations / verdicts / findings / standards / proposals. Five SQL learner rules detect persistent findings, dead checks, severity drift, archetype drift, and repeated residuals; a weekly Opus pass synthesises the rest. All proposed standards changes land in a 中文 inbox where you approve, reject, or edit. Forge's verifier polls <code>/api/standards/:archetype</code> with ETag/304 each run.
            </p>
          </article>
          <article>
            <h2>How they stay loosely coupled</h2>
            <p>
              Both subsystems are independently usable. Forge with no Hub configured falls back to baked standards and runs as before. Hub with no Forge connected is just an idle dashboard. The contract is one HTTP token + a handful of event shapes — no shared imports, no shared state. The split exists because the cockpit's job (memory + governance) is fundamentally different from the engine's job (produce changes now).
            </p>
          </article>
          <article>
            <h2>What MatrixOmnix Paper does</h2>
            <p>
              Paper is the third project in the family, independent from the Forge ↔ Hub loop. It applies the same multi-agent design to academic paper review: a paper plus a target venue goes in, a jury of domain-expert critics (Novelty, Methodology, Clarity) deliberates, and a calibrated per-venue acceptance probability comes out. Explainability-first: the critics' disagreements ARE the explanation, not a derived summary. It covers every domain (CS, Physics, Bio, Med, Econ, SocSci), not just CS like existing predictors. Tech stack: FastAPI + Anthropic + MiniMax on the backend, Vue 3 + Vite + Pinia + Tailwind on the frontend, SQLite for stored predictions, deployed at <a href="https://matrixomnixpaper.vercel.app" target="_blank" rel="noopener">matrixomnixpaper.vercel.app</a>. No shared imports with Forge or Hub — just shared philosophy and brand.
            </p>
          </article>
          <article>
            <h2>What MatrixOmnix Arena does</h2>
            <p>
              Arena is the fourth project in the family — a multi-competitor evaluation harness, also outside the Forge ↔ Hub loop. You define a shared task suite, register competitors (LLMs or whole agents), and Arena runs them all, scores the outputs, and produces a leaderboard with judge disagreements surfaced rather than averaged away. It treats every competitor — including the other MatrixOmnix projects — as a black box reached through CLI/HTTP adapters, so nothing leaks across boundaries. Python stack: a <code>matrixomnix-arena</code> CLI plus a FastAPI service (<code>POST /run</code>, <code>GET /leaderboard</code>); a <code>mock</code> backend runs fully offline, or point it at MiniMax / Anthropic. No shared code, DB, or config with Forge, Hub, or Paper.
            </p>
          </article>
        </section>

        <section class="text-grid" aria-label="Current shape and roadmap">
          <article>
            <h2>Current shape</h2>
            <p>
              Four repos under the MatrixOmnix umbrella: <code>Hosico02/d2p</code> (MatrixOmnix Forge, the do-layer, ~14k LOC Python), <code>anzy-renlab-ai/MatrixOmnix-Hub</code> (the observe-layer, ~13k LOC TypeScript + Vue), <code>Hosico02/MatrixOmnix-Paper</code> (the acceptance predictor, FastAPI backend + Vue SPA, hosted at matrixomnixpaper.vercel.app), and <code>Hosico02/MatrixOmnix-Arena</code> (the evaluation harness, a Python CLI + FastAPI service). All open source; all test suites currently green.
            </p>
          </article>
          <article>
            <h2>Where it's headed</h2>
            <p>
              v0.1 is the foundation: Hub stores events, runs learner rules, gates approvals. The next milestone for the loop is Forge's internal Verifier (calibration harness already lives on a branch in the Forge repo; merge pending real-data tuning) — once shipped, the loop closes end-to-end. In parallel, Paper is expanding its domain-expert roster (Bio and Medicine experts in progress) and working toward calibration against real venue-acceptance data.
            </p>
          </article>
        </section>

        <div class="repo-links">
          <a class="repo-link" href="https://github.com/anzy-renlab-ai/MatrixOmnix-Hub" target="_blank" rel="noreferrer">
            Hub repository: github.com/anzy-renlab-ai/MatrixOmnix-Hub
          </a>
          <a class="repo-link" href="https://github.com/Hosico02/d2p" target="_blank" rel="noreferrer">
            MatrixOmnix Forge repository: github.com/Hosico02/d2p
          </a>
          <a class="repo-link" href="https://github.com/Hosico02/MatrixOmnix-Paper" target="_blank" rel="noreferrer">
            Paper repository: github.com/Hosico02/MatrixOmnix-Paper
          </a>
          <a class="repo-link" href="https://github.com/Hosico02/MatrixOmnix-Arena" target="_blank" rel="noreferrer">
            Arena repository: github.com/Hosico02/MatrixOmnix-Arena
          </a>
        </div>

        <p class="about-footnote">
          The do-layer is named <strong>MatrixOmnix Forge</strong> (formerly <code>d2p</code>). Its repository URL, Python package, env vars (<code>D2P_*</code>) and on-disk paths (<code>.d2p/</code>, <code>tests/d2p_qa/</code>) keep the <code>d2p</code> slug for backward compatibility — same project, the name just moved under the MatrixOmnix brand.
        </p>
      </section>

      <section v-else-if="page === 'produce'" class="content-page produce-page" id="produce">
        <PageHeading kicker="Produce" title="The MatrixOmnix family, as live cards.">
          Every product with a hosted deployment is embedded as a live preview — the card is its real homepage, scaled to fit. Click any preview to open the full site in a new tab. Products that ship as a CLI or library link straight to source.
        </PageHeading>

        <section class="produce-grid" aria-label="Live product previews">
          <article v-for="p in liveProducts" :key="p.id" class="produce-card">
            <a
              class="produce-card__frame"
              :href="p.url"
              target="_blank"
              rel="noopener"
              :data-frame-id="p.id"
              :aria-label="`Open ${p.title} live in a new tab`"
            >
              <iframe
                v-if="visibleFrames.has(p.id)"
                class="produce-card__iframe"
                :src="p.url"
                :title="`${p.title} live preview`"
                loading="lazy"
                tabindex="-1"
                aria-hidden="true"
                scrolling="no"
              ></iframe>
              <span v-else class="produce-card__placeholder" aria-hidden="true">
                <img src="./assets/matrixomnix_icon.svg" alt="" />
              </span>
              <span class="produce-card__overlay">Open live →</span>
            </a>
            <div class="produce-card__meta">
              <div class="project-card__kicker">{{ p.kicker }}</div>
              <h2 class="project-card__title">{{ p.title }}</h2>
              <p class="project-card__copy">{{ p.copy }}</p>
              <div class="project-card__ctas">
                <a class="project-card__cta" :href="p.url" target="_blank" rel="noopener">Open live →</a>
                <a class="project-card__cta project-card__cta--ghost" :href="p.github" target="_blank" rel="noopener">GitHub →</a>
              </div>
            </div>
          </article>
        </section>

        <section class="project-cards produce-source-cards" aria-label="Source-only products">
          <article v-for="p in sourceProducts" :key="p.id" class="project-card">
            <div class="project-card__kicker">{{ p.kicker }}</div>
            <h2 class="project-card__title">{{ p.title }}</h2>
            <p class="project-card__copy">{{ p.copy }}</p>
            <div class="project-card__ctas">
              <a class="project-card__cta" :href="p.github" target="_blank" rel="noopener">GitHub →</a>
            </div>
          </article>
        </section>
      </section>

      <section v-else-if="page === 'service'" class="content-page service-page" id="service">
        <PageHeading kicker="Service" title="How to run MatrixOmnix today.">
          MatrixOmnix is self-host first. The Forge ↔ Hub loop is two open-source repos: run the Hub on one machine (self-host or localhost), run Forge anywhere it has network to the Hub. Forge auto-reports run events; the Hub aggregates, learns, and gates standards changes through a 中文 approval inbox. The sibling, <strong>MatrixOmnix Paper</strong>, ships with a hosted UI at <a href="https://matrixomnixpaper.vercel.app" target="_blank" rel="noopener">matrixomnixpaper.vercel.app</a> — open it in a browser and submit a paper, no install needed.
        </PageHeading>

        <section class="service-layout" data-service-guide>
          <article class="usage-card">
            <h2>Install both subsystems</h2>
            <p>
              Two independent repos. The Hub is Node + SQLite + Vue (one process, one file); Forge is Python. They communicate over HTTP — Hub serves <code>/api/*</code>, Forge uses <code>HUB_URL</code> + <code>HUB_TOKEN</code> env vars.
            </p>
            <code># Hub (self-host once)</code>
            <code>git clone https://github.com/anzy-renlab-ai/MatrixOmnix-Hub</code>
            <code>cd MatrixOmnix-Hub && pnpm install && pnpm hub:build</code>
            <code>HUB_DB_PATH=~/.matrixomnix/hub.db pnpm hub:seed   # one-time: creates token</code>
            <code>HUB_ADMIN_TOKEN=$(openssl rand -hex 16) pnpm hub:start</code>
            <code></code>
            <code># MatrixOmnix Forge (separate clone, separate machine)</code>
            <code>git clone https://github.com/Hosico02/d2p && cd d2p</code>
            <code>python -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt</code>
          </article>

          <ol class="usage-steps">
            <li><strong>1 · Start the Hub</strong><span>From the Hub repo, after seeding once: <code>pnpm hub:start</code> binds <code>127.0.0.1:3030</code> by default. Open <code>http://127.0.0.1:3030</code> for the 中文 dashboard — three tabs: 运行 / 规则 / 待办.</span></li>
            <li><strong>2 · Wire Forge to the Hub</strong><span>On any Forge machine: <code>export HUB_URL=http://hub-host:3030 && export HUB_TOKEN=&lt;hub:seed token&gt;</code>. Forge auto-detects these and starts pushing <code>run_started</code> / <code>iteration_complete</code> / <code>verdict_emitted</code> / <code>finding_recorded</code> / <code>run_terminated</code> events to the Hub.</span></li>
            <li><strong>3 · Run Forge as usual</strong><span><code>python run.py /path/to/your/demo --iter 2 --parallel 2</code>. Everything Forge does — analyze, plan, execute, QA — is unchanged. The only difference: lifecycle events stream to the Hub, and the verifier (once shipped per the design spec) polls <code>/api/standards/:archetype</code> for its evaluation rules.</span></li>
            <li><strong>4 · Watch the dashboard</strong><span>"运行" page shows active + recent Forge runs across all machines. Drill into one to see the iteration timeline + findings + 备注. "规则" lists current standards per archetype + change history. "待办" is the approval inbox where the learner's proposed standards updates wait for your ✓ or ✗.</span></li>
            <li><strong>5 · Hub fails safe</strong><span>If the Hub is unreachable, Forge uses cached or baked-in standards and keeps running — every Hub call is best-effort. Pending events queue locally to <code>~/.d2p/hub_cache/pending_events.jsonl</code> and flush on next successful contact.</span></li>
          </ol>
        </section>

        <code class="command-strip">pnpm hub:start  &amp;&amp;  HUB_URL=http://localhost:3030 python run.py ./your-demo</code>
        <p class="service-footnote">
          Two repos, one slow loop. <a href="https://github.com/Hosico02/d2p" target="_blank" rel="noopener">MatrixOmnix Forge</a> · <a href="https://github.com/anzy-renlab-ai/MatrixOmnix-Hub" target="_blank" rel="noopener">Hub</a>. Plus the hosted sibling: <a href="https://matrixomnixpaper.vercel.app" target="_blank" rel="noopener">MatrixOmnix Paper</a>.
        </p>
      </section>

      <section v-else class="content-page contact-page" id="contact">
        <PageHeading kicker="Contact" title="MatrixOmnix is two repos. Both are open.">
          File issues, share findings that the learner missed, or propose new learner rules. Both subsystems are independently testable.
        </PageHeading>

        <div class="contact-grid">
          <a href="https://github.com/Hosico02/d2p" target="_blank" rel="noreferrer">
            <span>Do-layer · MatrixOmnix Forge</span>
            <strong>github.com/Hosico02/d2p</strong>
          </a>
          <a href="https://github.com/anzy-renlab-ai/MatrixOmnix-Hub" target="_blank" rel="noreferrer">
            <span>Observe-layer · Hub</span>
            <strong>github.com/anzy-renlab-ai/MatrixOmnix-Hub</strong>
          </a>
          <a href="https://github.com/Hosico02/MatrixOmnix-Paper" target="_blank" rel="noreferrer">
            <span>Sibling · MatrixOmnix Paper</span>
            <strong>github.com/Hosico02/MatrixOmnix-Paper</strong>
          </a>
          <a href="https://matrixomnixpaper.vercel.app" target="_blank" rel="noreferrer">
            <span>Try Paper · hosted UI</span>
            <strong>matrixomnixpaper.vercel.app</strong>
          </a>
          <a href="https://github.com/Hosico02" target="_blank" rel="noreferrer">
            <span>Owner</span>
            <strong>github.com/Hosico02</strong>
          </a>
        </div>
      </section>
    </main>
  </div>
</template>

<script setup>
import { computed, defineComponent, h, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const navItems = [
  { id: 'home', label: 'Home' },
  { id: 'about', label: 'About' },
  { id: 'produce', label: 'Produce' },
  { id: 'service', label: 'Service' },
  { id: 'contact', label: 'Contact' },
]

// Products with a hosted homepage get a live iframe preview card; the rest get
// a source-only card. Frame previews load the real site at a large logical
// width and scale it down (see style.css + the frame observers below).
const liveProducts = [
  {
    id: 'envoy',
    kicker: 'Live demo',
    title: 'MatrixOmnix Envoy',
    url: 'https://matrixomnix-envoy.vercel.app',
    github: 'https://github.com/Hosico02/MatrixOmnix-Envoy',
    copy: 'A decentralized task-claim hub — 去中心化任务认领中心. Bosses post tasks, workers\' agents sense load and claim first-come-first-served with an atomic lock, then report back — proxying away the human-to-human coordination while people still do the real work. This card embeds the static demo as a live preview.',
  },
  {
    id: 'elysium',
    kicker: 'Live app',
    title: 'MatrixOmnix Elysium',
    url: 'https://matrixomnix-elysium.vercel.app',
    github: 'https://github.com/Hosico02/MatrixOmnix-Elysium',
    copy: 'The newest sibling in the MatrixOmnix family, shipping with a hosted UI — no install needed. This card embeds the real deployment as a live preview; click through to open the full site.',
  },
  {
    id: 'hub',
    kicker: 'Live dashboard',
    title: 'MatrixOmnix Hub',
    url: 'https://matrixomnix-hub.vercel.app',
    github: 'https://github.com/anzy-renlab-ai/MatrixOmnix-Hub',
    copy: 'The observe-layer cockpit — a 中文 Vue dashboard over the Hono + SQLite backend. Browse runs, standards drift, and the human approval inbox. This live deployment is a seeded demo.',
  },
  {
    id: 'paper',
    kicker: 'Live app',
    title: 'MatrixOmnix Paper',
    url: 'https://matrixomnixpaper.vercel.app',
    github: 'https://github.com/Hosico02/MatrixOmnix-Paper',
    copy: 'Multi-agent acceptance predictor for academic papers. A jury of domain-expert critics debates and returns a calibrated per-venue acceptance probability — with their disagreements as the explanation.',
  },
]

const sourceProducts = [
  {
    id: 'forge',
    kicker: 'CLI · 仅源码',
    title: 'MatrixOmnix Forge',
    github: 'https://github.com/Hosico02/d2p',
    copy: 'The do-layer — an LLM-driven Python orchestrator. Analyzer / Planner / parallel Executors / QA turn a rough demo into a verified product. Self-host first, no hosted UI to embed.',
  },
  {
    id: 'arena',
    kicker: 'CLI + API · 仅源码',
    title: 'MatrixOmnix Arena',
    github: 'https://github.com/Hosico02/MatrixOmnix-Arena',
    copy: 'Multi-competitor evaluation harness. Register competitors against a shared task suite, score them, and get a leaderboard with judge disagreements surfaced. Python CLI + FastAPI service.',
  },
]

const routeFromPath = () => {
  const slug = window.location.pathname.split('/').filter(Boolean).pop()
  return navItems.some((item) => item.id === slug) ? slug : 'home'
}

const page = ref(routeFromPath())
const cursorX = ref(window.innerWidth / 2)
const cursorY = ref(window.innerHeight / 2)
const maskX = ref(window.innerWidth / 2)
const maskY = ref(window.innerHeight / 2)
const titleStackRef = ref(null)
const flippedPanels = ref(new Set())

// Produce page: which live-preview iframes have been given a src yet. Frames
// load lazily when scrolled into view and unload when leaving the page, so we
// never keep two full apps running in the background.
const visibleFrames = ref(new Set())
const FRAME_LOGICAL_WIDTH = 1280
let frameIntersectionObserver = null
let frameResizeObserver = null

// Scale each frame's iframe so the site (rendered at FRAME_LOGICAL_WIDTH) fills
// the card width. CSS reads --frame-scale; this keeps it correct on resize.
const applyFrameScale = (el) => {
  const width = el.clientWidth
  if (width > 0) el.style.setProperty('--frame-scale', String(width / FRAME_LOGICAL_WIDTH))
}

const observeFrames = () => {
  const frames = Array.from(document.querySelectorAll('[data-frame-id]'))
  if (!frames.length) return

  if (typeof ResizeObserver !== 'undefined') {
    frameResizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) applyFrameScale(entry.target)
    })
    frames.forEach((el) => {
      applyFrameScale(el)
      frameResizeObserver.observe(el)
    })
  } else {
    frames.forEach(applyFrameScale)
  }

  if (typeof IntersectionObserver === 'undefined') {
    visibleFrames.value = new Set(liveProducts.map((p) => p.id))
    return
  }
  frameIntersectionObserver = new IntersectionObserver(
    (entries, observer) => {
      let changed = false
      const next = new Set(visibleFrames.value)
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const id = entry.target.dataset.frameId
        if (id && !next.has(id)) {
          next.add(id)
          changed = true
        }
        observer.unobserve(entry.target)
      }
      if (changed) visibleFrames.value = next
    },
    { rootMargin: '200px' },
  )
  frames.forEach((el) => frameIntersectionObserver.observe(el))
}

const teardownFrames = () => {
  frameIntersectionObserver?.disconnect()
  frameResizeObserver?.disconnect()
  frameIntersectionObserver = null
  frameResizeObserver = null
  visibleFrames.value = new Set()
}

watch(page, async (value) => {
  if (value === 'produce') {
    await nextTick()
    observeFrames()
  } else {
    teardownFrames()
  }
})

const cursorStyle = computed(() => ({
  '--cursor-x': `${cursorX.value}px`,
  '--cursor-y': `${cursorY.value}px`,
  '--mask-x': `${maskX.value}px`,
  '--mask-y': `${maskY.value}px`,
}))

const navigate = (id) => {
  page.value = id
  const path = id === 'home' ? '/' : `/${id}`
  window.history.pushState({ page: id }, '', path)
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

const flipOn = (id) => {
  const next = new Set(flippedPanels.value)
  next.add(id)
  flippedPanels.value = next
}

const flipOff = (id) => {
  const next = new Set(flippedPanels.value)
  next.delete(id)
  flippedPanels.value = next
}

let cleanup = () => {}

onMounted(() => {
  let frame = 0
  let latestPoint = { x: window.innerWidth / 2, y: window.innerHeight / 2 }

  const update = (clientX, clientY) => {
    cursorX.value = clientX
    cursorY.value = clientY
    const rect = titleStackRef.value?.getBoundingClientRect()
    if (rect) {
      maskX.value = clientX - rect.left
      maskY.value = clientY - rect.top
    }
  }

  const scheduleUpdate = (clientX, clientY) => {
    latestPoint = { x: clientX, y: clientY }
    if (frame) return
    frame = window.requestAnimationFrame(() => {
      frame = 0
      update(latestPoint.x, latestPoint.y)
    })
  }

  const onPointerMove = (event) => {
    if (event.pointerType !== 'mouse' || page.value !== 'home') return
    scheduleUpdate(event.clientX, event.clientY)
  }

  const onPopState = () => {
    page.value = routeFromPath()
  }

  document.addEventListener('pointermove', onPointerMove, { passive: true })
  window.addEventListener('popstate', onPopState)

  // Direct load on /produce: the page watcher won't fire (no change), so wire
  // up the frame observers here.
  if (page.value === 'produce') {
    nextTick().then(observeFrames)
  }

  cleanup = () => {
    if (frame) window.cancelAnimationFrame(frame)
    document.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('popstate', onPopState)
  }
})

onBeforeUnmount(() => {
  cleanup()
  teardownFrames()
})

const PageHeading = defineComponent({
  props: {
    kicker: { type: String, required: true },
    title: { type: String, required: true },
  },
  setup(props, { slots }) {
    return () => h('section', { class: 'page-heading' }, [
      h('p', { class: 'section-kicker' }, props.kicker),
      h('h1', props.title),
      h('p', slots.default?.()),
    ])
  },
})

const FlipPanel = defineComponent({
  props: {
    id: { type: String, required: true },
    title: { type: String, required: true },
    active: { type: Boolean, required: true },
  },
  emits: ['open', 'close'],
  setup(props, { emit, slots }) {
    const toggle = () => {
      emit(props.active ? 'close' : 'open', props.id)
    }
    const open = () => emit('open', props.id)
    const close = () => emit('close', props.id)
    return () => h('section', {
      class: ['panel', 'flip-panel', props.active ? 'flipped' : ''],
      tabindex: '0',
      role: 'button',
      'aria-label': `Show ${props.title} details`,
      onPointerenter: open,
      onPointerleave: close,
      onFocus: open,
      onBlur: close,
      onTouchstart: open,
      onKeydown: (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          toggle()
        }
        if (event.key === 'Escape') close()
      },
    }, [
      h('div', { class: 'flip-card-inner' }, [
        h('div', { class: 'flip-card-front' }, [h('h2', props.title)]),
        h('div', { class: 'flip-card-back' }, [h('h2', props.title), h('p', slots.default?.())]),
        h('div', { class: 'wipe-line', 'aria-hidden': 'true' }),
      ]),
    ])
  },
})
</script>
