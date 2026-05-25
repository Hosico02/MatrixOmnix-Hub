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
              MatrixOmnix turns a rough demo into a verified product. Two subsystems work together: <strong>d2p</strong> drives the demo through analyzer / planner / parallel executors / QA to produce changes, and <strong>MatrixOmnix Hub</strong> observes every run, learns standards drift over time, and surfaces decisions to a human via a 中文 Vue dashboard. Loose-coupled today; the loop is data → learning → distribution.
            </p>
          </div>
        </section>

        <section class="panel-grid" aria-label="MatrixOmnix subsystems">
          <FlipPanel id="do" title="Do · d2p" :active="flippedPanels.has('do')" @open="flipOn" @close="flipOff">
            LLM-driven Python orchestrator: Analyzer searches the web for mature competitor products, Planner diffs them against the demo, parallel Executors fill the gaps, QA emits failing tests as permanent regression guardrails. No hardcoded demo-type detectors.
          </FlipPanel>
          <FlipPanel id="observe" title="Observe · Hub" :active="flippedPanels.has('observe')" @open="flipOn" @close="flipOff">
            Localhost-first multi-project hub (Hono + SQLite). d2p instances push run events here; the learner identifies standards drift via 5 SQL rules + a weekly Opus pass; pending standards changes go into a 中文 inbox where you approve / reject / edit. d2p verifier polls for the latest approved standards on each run.
          </FlipPanel>
          <FlipPanel id="goal" title="Goal · demo → product" :active="flippedPanels.has('goal')" @open="flipOn" @close="flipOff">
            One slow loop: d2p produces changes → Hub records + learns from many runs → human approves new standards → d2p verifier picks them up on the next run. Hub down? d2p uses its cached standards and keeps running. d2p down? Hub is just an idle dashboard. Independent but stronger together.
          </FlipPanel>
        </section>

        <section class="sibling-card" aria-label="Two subsystems, one loop">
          <div class="sibling-card__body">
            <div class="sibling-card__kicker">Two subsystems, one loop</div>
            <h2 class="sibling-card__title">
              How <a href="https://github.com/Hosico02/d2p" target="_blank" rel="noopener">d2p</a> and the Hub form the loop
            </h2>
            <p class="sibling-card__copy">
              The do-layer (d2p) and the observe-layer (Hub) are deliberately decoupled. d2p reads the demo, plans tasks, runs parallel Executors, generates failing tests as permanent regression guardrails — and pushes <code>run_started</code> / <code>iteration_complete</code> / <code>verdict_emitted</code> / <code>finding_recorded</code> events to the Hub over HTTP. The Hub aggregates events across all projects, runs 5 SQL learner rules + a weekly Opus pass to detect standards drift, and surfaces proposed rule changes into a 中文 inbox. You approve; the new standards land in <code>standard_versions</code>; next time d2p's verifier polls <code>/standards/:archetype</code>, it gets the new version.
            </p>
            <ul class="sibling-card__bullets">
              <li><strong>d2p</strong> · ~8k LOC Python · LLM-driven, no hardcoded demo-type detectors · Claude / Codex / MiniMax</li>
              <li><strong>Hub</strong> · ~13k LOC TypeScript · Hono + SQLite + Drizzle backend · Vue 3 + Pinia + Tailwind dashboard · 271 tests</li>
              <li><strong>integration</strong> · HTTP best-effort with bcrypt-hashed per-instance bearer tokens; ETag/304 on standards pull</li>
              <li><strong>fail-safe</strong> · Hub down → d2p uses cached or baked standards · d2p down → Hub is just an idle dashboard</li>
              <li><strong>governance</strong> · every standards change goes through human approval; rejections weakly damp future proposals</li>
            </ul>
            <p class="sibling-card__pair">
              Neither subsystem absorbs the other. d2p is the engine; the Hub is the cockpit. Together they form the slow loop that turns one-off productization runs into accumulated knowledge.
            </p>
            <a class="sibling-card__cta" href="https://github.com/Hosico02/d2p" target="_blank" rel="noopener">
              View d2p on GitHub →
            </a>
          </div>
        </section>
      </template>

      <section v-else-if="page === 'about'" class="content-page about-page" id="about">
        <PageHeading kicker="About" title="MatrixOmnix is a goal, not a single tool.">
          The goal: turn a rough demo into a verified product. Current implementation: <strong>d2p</strong> (LLM-driven Python orchestrator that produces changes) plus <strong>MatrixOmnix Hub</strong> (TypeScript backend + Vue dashboard that observes runs, learns standards drift, and gates rule changes through human approval). Two repos, deliberately decoupled. d2p is the engine; Hub is the cockpit.
        </PageHeading>

        <div class="image-grid" aria-label="MatrixOmnix architecture diagrams">
          <figure>
            <img src="./assets/framework-loop.svg" alt="The d2p ↔ Hub loop: d2p posts lifecycle events to the Hub via /api/events; the Hub serves approved standards back via /api/standards with ETag/304." />
            <figcaption>Two subsystems · events flow right, standards flow left</figcaption>
          </figure>
          <figure>
            <img src="./assets/hub-layers.svg" alt="Hub internal stack: three stacked layers — data (SQLite tables), learn (5 SQL rules plus weekly LLM pass produce proposals), decide (human approves proposals which become new standards versions)." />
            <figcaption>3 layers · 数据 → 学习 → 决定</figcaption>
          </figure>
          <figure>
            <img src="./assets/deployment-flow.svg" alt="Deployment topology: many d2p instances all point at one self-hosted Hub. Fail-safe: Hub down means d2p uses cached standards and queues events locally; d2p down means the Hub is just an idle dashboard." />
            <figcaption>Deployment · many d2p clients, one Hub process</figcaption>
          </figure>
        </div>

        <section class="about-narrative" aria-label="MatrixOmnix overview">
          <article>
            <h2>Why two subsystems</h2>
            <p>
              Coding agents are good at producing code; they are systematically bad at remembering yesterday's mistake on tomorrow's project. d2p is great at making one demo into a product — but once the run ends, the lessons evaporate. The Hub is the part of MatrixOmnix that doesn't forget: it captures every run's events, identifies recurring blind spots, proposes standards updates, and (with human approval) feeds them back into d2p's verifier prompt. Two stacks, one slow loop: do → observe → learn → distribute.
            </p>
          </article>
          <article>
            <h2>What d2p does</h2>
            <p>
              d2p (the do-layer) is an LLM-driven Python orchestrator. Its Analyzer reads the demo and searches the web for mature competitor products. Its Planner diffs them against the demo and emits a small batch of file-level tasks. Parallel Executors apply changes under a sandbox with health-rollback and baseline-test guards. Its QA agent emits failing tests as bug reports that stay in <code>tests/d2p_qa/</code> as a permanent regression corpus. After each lifecycle event d2p best-effort POSTs to the Hub's <code>/api/events</code>.
            </p>
          </article>
          <article>
            <h2>What the Hub does</h2>
            <p>
              MatrixOmnix Hub is a localhost-first multi-project cockpit. Hono backend serves the <code>/api/*</code> ingest + read surfaces; 10 SQLite tables hold runs / iterations / verdicts / findings / standards / proposals. Five SQL learner rules detect persistent findings, dead checks, severity drift, archetype drift, and repeated residuals; a weekly Opus pass synthesises the rest. All proposed standards changes land in a 中文 inbox where you approve, reject, or edit. d2p verifier polls <code>/api/standards/:archetype</code> with ETag/304 each run.
            </p>
          </article>
          <article>
            <h2>How they stay loosely coupled</h2>
            <p>
              Both subsystems are independently usable. d2p with no Hub configured falls back to baked standards and runs as before. Hub with no d2p connected is just an idle dashboard. The contract is one HTTP token + a handful of event shapes — no shared imports, no shared state. The split exists because the cockpit's job (memory + governance) is fundamentally different from the engine's job (produce changes now).
            </p>
          </article>
        </section>

        <section class="text-grid" aria-label="Current shape and roadmap">
          <article>
            <h2>Current shape</h2>
            <p>
              Two repos under the MatrixOmnix umbrella: <code>Hosico02/d2p</code> (the do-layer, ~8k LOC Python) and <code>Hosico02/MatrixOmnix-Hub</code> (the observe-layer, ~13k LOC TypeScript + Vue). Both open source. Hub's vitest + Python HubClient pytest report 271/271 passing.
            </p>
          </article>
          <article>
            <h2>Where it's headed</h2>
            <p>
              v0.1 is the foundation: Hub stores events, runs learner rules, gates approvals. The next milestone is d2p's internal Verifier (see the design spec in the Hub repo) — once shipped, the loop closes end-to-end. Until then, the Hub can already accumulate run data from any d2p execution and surface initial pattern proposals.
            </p>
          </article>
        </section>

        <a class="repo-link" href="https://github.com/Hosico02/MatrixOmnix-Hub" target="_blank" rel="noreferrer">
          Hub repository: github.com/Hosico02/MatrixOmnix-Hub
        </a>
      </section>

      <section v-else-if="page === 'service'" class="content-page service-page" id="service">
        <PageHeading kicker="Service" title="How to run MatrixOmnix today.">
          MatrixOmnix is two open-source repos, not a hosted service. Run the Hub on one machine (self-host or localhost); run d2p anywhere it has network to the Hub. d2p auto-reports run events; the Hub aggregates, learns, and gates standards changes through a 中文 approval inbox.
        </PageHeading>

        <section class="service-layout" data-service-guide>
          <article class="usage-card">
            <h2>Install both subsystems</h2>
            <p>
              Two independent repos. The Hub is Node + SQLite + Vue (one process, one file); d2p is Python. They communicate over HTTP — Hub serves <code>/api/*</code>, d2p uses <code>HUB_URL</code> + <code>HUB_TOKEN</code> env vars.
            </p>
            <code># Hub (self-host once)</code>
            <code>git clone https://github.com/Hosico02/MatrixOmnix-Hub</code>
            <code>cd MatrixOmnix-Hub && pnpm install && pnpm hub:build</code>
            <code>HUB_DB_PATH=~/.matrixomnix/hub.db pnpm hub:seed   # one-time: creates token</code>
            <code>HUB_ADMIN_TOKEN=$(openssl rand -hex 16) pnpm hub:start</code>
            <code></code>
            <code># d2p (separate clone, separate machine)</code>
            <code>git clone https://github.com/Hosico02/d2p && cd d2p</code>
            <code>python -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt</code>
          </article>

          <ol class="usage-steps">
            <li><strong>1 · Start the Hub</strong><span>From the Hub repo, after seeding once: <code>pnpm hub:start</code> binds <code>127.0.0.1:3030</code> by default. Open <code>http://127.0.0.1:3030</code> for the 中文 dashboard — three tabs: 运行 / 规则 / 待办.</span></li>
            <li><strong>2 · Wire d2p to the Hub</strong><span>On any d2p machine: <code>export HUB_URL=http://hub-host:3030 && export HUB_TOKEN=&lt;hub:seed token&gt;</code>. d2p auto-detects these and starts pushing <code>run_started</code> / <code>iteration_complete</code> / <code>verdict_emitted</code> / <code>finding_recorded</code> / <code>run_terminated</code> events to the Hub.</span></li>
            <li><strong>3 · Run d2p as usual</strong><span><code>python run.py /path/to/your/demo --iter 2 --parallel 2</code>. Everything d2p does — analyze, plan, execute, QA — is unchanged. The only difference: lifecycle events stream to the Hub, and the verifier (once shipped per the design spec) polls <code>/api/standards/:archetype</code> for its evaluation rules.</span></li>
            <li><strong>4 · Watch the dashboard</strong><span>"运行" page shows active + recent d2p runs across all machines. Drill into one to see the iteration timeline + findings + 备注. "规则" lists current standards per archetype + change history. "待办" is the approval inbox where the learner's proposed standards updates wait for your ✓ or ✗.</span></li>
            <li><strong>5 · Hub fails safe</strong><span>If the Hub is unreachable, d2p uses cached or baked-in standards and keeps running — every Hub call is best-effort. Pending events queue locally to <code>~/.d2p/hub_cache/pending_events.jsonl</code> and flush on next successful contact.</span></li>
          </ol>
        </section>

        <code class="command-strip">pnpm hub:start  &amp;&amp;  HUB_URL=http://localhost:3030 python run.py ./your-demo</code>
        <p class="service-footnote">
          Two repos, one slow loop. <a href="https://github.com/Hosico02/d2p" target="_blank" rel="noopener">d2p</a> · <a href="https://github.com/Hosico02/MatrixOmnix-Hub" target="_blank" rel="noopener">Hub</a>.
        </p>
      </section>

      <section v-else class="content-page contact-page" id="contact">
        <PageHeading kicker="Contact" title="MatrixOmnix is two repos. Both are open.">
          File issues, share findings that the learner missed, or propose new learner rules. Both subsystems are independently testable.
        </PageHeading>

        <div class="contact-grid">
          <a href="https://github.com/Hosico02/d2p" target="_blank" rel="noreferrer">
            <span>Do-layer · d2p</span>
            <strong>github.com/Hosico02/d2p</strong>
          </a>
          <a href="https://github.com/Hosico02/MatrixOmnix-Hub" target="_blank" rel="noreferrer">
            <span>Observe-layer · Hub</span>
            <strong>github.com/Hosico02/MatrixOmnix-Hub</strong>
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
import { computed, defineComponent, h, onBeforeUnmount, onMounted, ref } from 'vue'

const navItems = [
  { id: 'home', label: 'Home' },
  { id: 'about', label: 'About' },
  { id: 'service', label: 'Service' },
  { id: 'contact', label: 'Contact' },
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

  cleanup = () => {
    if (frame) window.cancelAnimationFrame(frame)
    document.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('popstate', onPopState)
  }
})

onBeforeUnmount(() => cleanup())

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
