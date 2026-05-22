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
              MatrixOmnix turns a rough demo into a verified product. Two subsystems work together: <strong>d2p</strong> drives the demo through analyzer / planner / parallel executors / QA to fill the gaps, and an independent <strong>verify-layer</strong> returns an honest archetype detection, evidence-weighted score and gap report after every iteration. Currently two repos by design; eventual merger if the split keeps paying off.
            </p>
          </div>
        </section>

        <section class="panel-grid" aria-label="MatrixOmnix subsystems">
          <FlipPanel id="do" title="Do · d2p" :active="flippedPanels.has('do')" @open="flipOn" @close="flipOff">
            LLM-driven Python orchestrator: Analyzer searches the web for mature competitor products, Planner diffs them against the demo, parallel Executors fill the gaps, QA emits failing tests as permanent regression guardrails. No hardcoded demo-type detectors.
          </FlipPanel>
          <FlipPanel id="verify" title="Verify · this repo" :active="flippedPanels.has('verify')" @open="flipOn" @close="flipOff">
            Read-only MCP server (<code>d2p-verify</code>) that any agent can call between iterations. Returns archetype, evidence-weighted score, verdict (pass / needs_repair / fail), severity-tagged findings and QA preflight in one envelope. Never writes to the project.
          </FlipPanel>
          <FlipPanel id="goal" title="Goal · demo → product" :active="flippedPanels.has('goal')" @open="flipOn" @close="flipOff">
            One closed loop: d2p produces a change, MatrixOmnix verifies it, d2p iterates again if the verdict is <code>needs_repair</code>. The endgame is a single tool that does both — kept split today so the verify-layer can stay genuinely independent.
          </FlipPanel>
        </section>

        <section class="sibling-card" aria-label="Two subsystems, one loop">
          <div class="sibling-card__body">
            <div class="sibling-card__kicker">Two subsystems, one loop</div>
            <h2 class="sibling-card__title">
              How <a href="https://github.com/Hosico02/d2p" target="_blank" rel="noopener">d2p</a> and the verify-layer hand off
            </h2>
            <p class="sibling-card__copy">
              The do-layer and the verify-layer are deliberately kept in separate repos right now. The verify-layer must be able to call the do-layer a liar, so it cannot share code with it. Each iteration: d2p reads the demo, plans a small batch of tasks, runs parallel Executors, generates failing tests as permanent regression guardrails. Then it hands the project state to the verify-layer's <code>verify_project</code> MCP call, which returns an independent verdict. If verdict is <code>pass</code>, the loop terminates; if <code>needs_repair</code>, d2p plans the next iteration; if <code>fail</code>, the run is escalated.
            </p>
            <ul class="sibling-card__bullets">
              <li><strong>d2p</strong> · ~8k LOC Python · LLM-driven, no hardcoded demo-type detectors · MiniMax / Claude / Codex / Claude CLI</li>
              <li><strong>verify-layer</strong> · ~12k LOC TypeScript · 80+ engineered gap detectors · MCP stdio server · deterministic</li>
              <li><strong>integration</strong> · MCP over stdio; <code>.mcp.json</code> wiring or subprocess JSON-RPC</li>
              <li><strong>endgame</strong> · merge into a single MatrixOmnix tool if the split keeps proving valuable across more domains</li>
              <li><strong>or</strong> · drop the verify-layer entirely if d2p's LLM-driven loop closes the demo-to-product gap on its own</li>
            </ul>
            <p class="sibling-card__pair">
              The decision will be data-driven, not aesthetic. Which subsystem catches the bug each repo couldn't catch alone is the question that decides the architecture.
            </p>
            <a class="sibling-card__cta" href="https://github.com/Hosico02/d2p" target="_blank" rel="noopener">
              View d2p on GitHub →
            </a>
          </div>
        </section>
      </template>

      <section v-else-if="page === 'about'" class="content-page about-page" id="about">
        <PageHeading kicker="About" title="MatrixOmnix is a goal, not yet a single tool.">
          The goal: turn a rough demo into a verified product. The current implementation: <strong>d2p</strong> (LLM-driven Python orchestrator that produces changes) plus a separate <strong>verify-layer</strong> (TypeScript MCP server that returns an independent verdict). Two repos today, deliberately. If the split keeps paying off, they merge. If d2p alone closes the gap, the verify-layer is dropped. The decision is empirical, not architectural.
        </PageHeading>

        <div class="image-grid" aria-label="MatrixOmnix architecture diagrams">
          <figure>
            <img src="./assets/framework-loop.png" alt="MatrixOmnix two-subsystem loop: d2p's Analyzer plans changes, Executors apply them, QA emits failing tests; then the project state is handed to the verify-layer's verify_project MCP call which returns archetype, score, verdict and gap findings. d2p reads the verdict to decide whether to iterate again." />
            <figcaption>Two subsystems · d2p produces, verify-layer judges</figcaption>
          </figure>
          <figure>
            <img src="./assets/harness-map.png" alt="MatrixOmnix harness coverage map: every product surface gated across three honest tiers — structural contract (always-on), behavioural runtime (skips when the surface's runtime lib is absent), and productization surface (operational maturity gates above runtime)." />
            <figcaption>3 tiers · structural · behavioural · productization</figcaption>
          </figure>
          <figure>
            <img src="./assets/deployment-flow.png" alt="MatrixOmnix endgame: two repos today, one tool eventually. Either d2p absorbs the verify-layer (if independent verification keeps catching real bugs) or d2p stands alone as MatrixOmnix (if its own QA corpus covers the same failure modes)." />
            <figcaption>Endgame · merge or absorb · decided by which subsystem catches the bug</figcaption>
          </figure>
        </div>

        <section class="about-narrative" aria-label="MatrixOmnix overview">
          <article>
            <h2>Why two subsystems</h2>
            <p>
              Coding agents are good at producing code; they are systematically bad at independently verifying that the code actually became a maintainable project. AI agents skip verification, claim completion without evidence, reintroduce yesterday's bug, and ship READMEs that lie about what runs. The verify-layer is the part of MatrixOmnix that refuses to take the do-layer's word for it — a separate process, with no write access, that says yes or no with evidence. It must not share code with the do-layer it judges. So: two repos, two stacks, one product goal.
            </p>
          </article>
          <article>
            <h2>What d2p does</h2>
            <p>
              d2p (the do-layer) is an LLM-driven Python orchestrator. Its Analyzer reads the demo and searches the web for mature competitor products. Its Planner diffs them against the demo and emits a small batch of file-level tasks. Parallel Executors apply changes under a sandbox with health-rollback and baseline-test guards. Its QA agent emits failing tests as bug reports that stay in <code>tests/d2p_qa/</code> as a permanent regression corpus, so each iteration grows the safety net.
            </p>
          </article>
          <article>
            <h2>What the verify-layer does</h2>
            <p>
              The verify-layer (this repo) is a read-only MCP stdio server (<code>d2p-verify</code>). It exposes two tools: <code>verify_project(path)</code> returns archetype, evidence-weighted score, verdict (pass / needs_repair / fail), severity-tagged findings, evidence summary and QA preflight in one envelope; <code>detect_archetype(path)</code> is a cheaper archetype-only path. Project archetype is decided by a hybrid of declarative JSON probes and built-in TypeScript probes; the real-project bench classifies 13 of 14 unfamiliar GitHub repos correctly.
            </p>
          </article>
          <article>
            <h2>How they will collapse (or not)</h2>
            <p>
              The endgame is a single MatrixOmnix tool. We keep them split today only because we don't yet know which subsystem deserves to absorb the other. If the verify-layer keeps catching bugs that d2p's own QA missed, d2p absorbs the verifier and we ship one combined tool. If d2p's growing regression corpus covers everything the verify-layer was catching, the verify-layer is retired and d2p stands alone as MatrixOmnix. The decision will be data-driven from real cross-project runs.
            </p>
          </article>
        </section>

        <section class="text-grid" aria-label="Current shape and endgame">
          <article>
            <h2>Current shape</h2>
            <p>
              Two repos under the MatrixOmnix umbrella: <code>Hosico02/d2p</code> (the do-layer, ~8k LOC Python) and <code>Hosico02/demo2project</code> (the verify-layer, ~12k LOC TypeScript). Both open source. Both independently testable. The verify-layer's vitest suite reports 219/219 passing; d2p's QA corpus grows per run. They communicate over MCP stdio — no shared state, no shared imports.
            </p>
          </article>
          <article>
            <h2>Endgame</h2>
            <p>
              Merge or absorb, decided by which subsystem catches the bug. The branch <code>v0.0.6-final</code> on the verify-layer preserves the pre-pivot state in case we need to fold do-layer code back in. The path of least regret: keep them honestly independent until real cross-project data shows one approach dominates.
            </p>
          </article>
        </section>

        <a class="repo-link" href="https://github.com/Hosico02/demo2project" target="_blank" rel="noreferrer">
          Verify-layer repository: github.com/Hosico02/demo2project
        </a>
      </section>

      <section v-else-if="page === 'service'" class="content-page service-page" id="service">
        <PageHeading kicker="Service" title="How to run MatrixOmnix today.">
          MatrixOmnix is two open-source repos, not a hosted service. Run d2p locally to drive the demo through analyzer / planner / executors / QA, and run the verify-layer (this repo) as a local MCP stdio server that d2p — or any other agent — calls between iterations.
        </PageHeading>

        <section class="service-layout" data-service-guide>
          <article class="usage-card">
            <h2>Install both subsystems</h2>
            <p>
              Two independent repos, two install steps. d2p is Python; the verify-layer is Node. The verify-layer ships an MCP stdio server (<code>d2p-verify</code>) and a back-compat CLI (<code>matrixomnix archetype</code>, <code>matrixomnix gap</code>, …).
            </p>
            <code># do-layer</code>
            <code>git clone https://github.com/Hosico02/d2p && cd d2p</code>
            <code>python -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt</code>
            <code></code>
            <code># verify-layer (separate clone)</code>
            <code>git clone https://github.com/Hosico02/demo2project</code>
            <code>cd demo2project && pnpm install && pnpm build</code>
            <code>pnpm matrixomnix archetype --project ./your-repo</code>
          </article>

          <ol class="usage-steps">
            <li><strong>1 · Drive the demo with d2p</strong><span>From the <code>d2p</code> repo: <code>python run.py /path/to/your/demo --iter 2 --parallel 2</code>. d2p's Analyzer fetches competitor research, Planner emits file-level Tasks, parallel Executors apply changes, QA emits failing tests as permanent regression guardrails. Artifacts land in <code>&lt;demo&gt;/.d2p/run-&lt;timestamp&gt;/</code>.</span></li>
            <li><strong>2 · Verify between iterations</strong><span>After each d2p iteration, call the verify-layer's <code>verify_project</code> MCP tool. d2p adds a post-iteration hook that spawns <code>node /path/to/demo2project/dist/mcp/server.js</code> over stdio and reads the JSON envelope. If verdict is <code>pass</code>, the loop terminates; if <code>needs_repair</code>, d2p plans the next iteration; if <code>fail</code>, the run is escalated to a human.</span></li>
            <li><strong>3 · Or wire the verifier into your editor</strong><span>The verify-layer is a standalone MCP server — Claude Code, Cursor, or any MCP-aware tool can call it directly. Add to <code>.mcp.json</code>:<br /><code>{"mcpServers":{"d2p-verify":{"command":"node","args":["/abs/path/demo2project/dist/mcp/server.js"]}}}</code><br />Then <code>verify_project</code> and <code>detect_archetype</code> show up as callable tools.</span></li>
            <li><strong>4 · Or just use the CLI</strong><span>For one-off checks or CI without an agent: <code>pnpm matrixomnix archetype --project ./your-repo</code> for the cheap archetype-only path, <code>pnpm matrixomnix gap --project ./your-repo</code> for the full gap report (evidence-weighted by default; add <code>--fast</code> for static-only).</span></li>
            <li><strong>5 · Inspect interactively</strong><span>The MCP Inspector lets you call verify-layer tools by hand to confirm the server is wired up correctly: <code>npx @modelcontextprotocol/inspector node /abs/path/demo2project/dist/mcp/server.js</code>.</span></li>
          </ol>
        </section>

        <code class="command-strip">python run.py ./your-demo --iter 2  &amp;&amp;  node /abs/path/demo2project/dist/mcp/server.js</code>
        <p class="service-footnote">
          Two repos, one product goal. If the split keeps proving valuable, they merge. If d2p's growing QA corpus covers everything the verify-layer catches, the verify-layer is retired. <a href="https://github.com/Hosico02/d2p" target="_blank" rel="noopener">d2p</a> · <a href="https://github.com/Hosico02/demo2project" target="_blank" rel="noopener">verify-layer</a>.
        </p>
      </section>

      <section v-else class="content-page contact-page" id="contact">
        <PageHeading kicker="Contact" title="MatrixOmnix is two repos. Both are open.">
          File issues, share verify_project envelopes that caught real bugs, or argue for or against the eventual merger. Both subsystems are independently testable; both grow per real-project run.
        </PageHeading>

        <div class="contact-grid">
          <a href="https://github.com/Hosico02/d2p" target="_blank" rel="noreferrer">
            <span>Do-layer · d2p</span>
            <strong>github.com/Hosico02/d2p</strong>
          </a>
          <a href="https://github.com/Hosico02/demo2project" target="_blank" rel="noreferrer">
            <span>Verify-layer</span>
            <strong>github.com/Hosico02/demo2project</strong>
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
