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
              The verifier for demo-to-product pipelines. A read-only MCP server (<code>d2p-verify</code>) any agent — d2p, Claude Code, Cursor, custom — can call to get an honest archetype detection, gap report, evidence-weighted score and QA preflight on a project directory. MatrixOmnix never writes; it only inspects, scores and reports.
            </p>
          </div>
        </section>

        <section class="panel-grid" aria-label="MatrixOmnix capability panels">
          <FlipPanel id="detect" title="Detect" :active="flippedPanels.has('detect')" @open="flipOn" @close="flipOff">
            <code>detect_archetype(path)</code> returns the primary archetype with confidence, detected signals and top-3 alternatives. Hybrid declarative JSON + built-in probes; 13/14 hit rate on unfamiliar GitHub repos.
          </FlipPanel>
          <FlipPanel id="verify" title="Verify" :active="flippedPanels.has('verify')" @open="flipOn" @close="flipOff">
            <code>verify_project(path)</code> returns archetype, evidence-weighted score, verdict (pass / needs_repair / fail), severity-tagged findings, evidence summary and QA preflight in one envelope. Read-only.
          </FlipPanel>
          <FlipPanel id="integrate" title="Integrate" :active="flippedPanels.has('integrate')" @open="flipOn" @close="flipOff">
            Stdio MCP transport. Add to <code>.mcp.json</code> for Claude Code / Cursor, or shell out from any orchestrator. Pair with d2p (recommended do-layer) for a full demo → verified product loop.
          </FlipPanel>
        </section>

        <section class="sibling-card" aria-label="Recommended do-layer d2p">
          <div class="sibling-card__body">
            <div class="sibling-card__kicker">Recommended do-layer</div>
            <h2 class="sibling-card__title">
              <a href="https://github.com/Hosico02/d2p" target="_blank" rel="noopener">d2p</a>
              — produces changes; MatrixOmnix verifies them
            </h2>
            <p class="sibling-card__copy">
              MatrixOmnix is read-only. Pair it with a do-layer that <em>can</em> mutate the project. d2p is an LLM-driven Python orchestrator (Analyzer → Planner → parallel Executors → QA) with <strong>no hardcoded demo-type detectors</strong>: its Analyzer searches the web for mature competitor products, a Planner diffs them against your demo, and parallel Executors fill the gaps. After each iteration, hand the project to MatrixOmnix for an independent archetype + gap + score verdict.
            </p>
            <ul class="sibling-card__bullets">
              <li><strong>~8k LOC Python</strong> with no hardcoded gap detectors or fixture catalogue</li>
              <li>MiniMax, Claude, Codex or Claude CLI via a per-role model router</li>
              <li>Health snapshot + baseline-test rollback prevents silent regressions</li>
              <li>Failing tests stay in <code>tests/d2p_qa/</code> as a permanent regression corpus</li>
              <li>Any MCP client can call MatrixOmnix — d2p, Claude Code, Cursor, custom</li>
            </ul>
            <p class="sibling-card__pair">
              d2p and MatrixOmnix are complementary by design: d2p is the do-layer (changes the project), MatrixOmnix is the verify-layer (returns yes/no with evidence). Neither competes with the other.
            </p>
            <a class="sibling-card__cta" href="https://github.com/Hosico02/d2p" target="_blank" rel="noopener">
              View Hosico02/d2p on GitHub →
            </a>
          </div>
        </section>
      </template>

      <section v-else-if="page === 'about'" class="content-page about-page" id="about">
        <PageHeading kicker="About" title="The verifier for demo-to-product pipelines.">
          MatrixOmnix is the read-only verify-layer of a two-part architecture. A separate do-layer (d2p, Claude Code, Cursor, custom) produces changes; MatrixOmnix gives an independent verdict — archetype, evidence-weighted score, gap findings, QA preflight — via an MCP stdio server any agent can call.
        </PageHeading>

        <div class="image-grid" aria-label="MatrixOmnix verifier diagrams">
          <figure>
            <img src="./assets/framework-loop.png" alt="MatrixOmnix verifier flow: any MCP client calls d2p-verify; the server runs AnalyzerAgent which produces a project snapshot, then ProjectScorer and gapAnalyzer, then a QA preflight." />
            <figcaption>Verifier flow · MCP client → d2p-verify → archetype + gap + score + QA</figcaption>
          </figure>
          <figure>
            <img src="./assets/harness-map.png" alt="MatrixOmnix harness coverage map: every product surface gated across three honest tiers — structural contract (always-on), behavioural runtime (skips when the surface's runtime lib is absent), and productization surface (operational maturity gates above runtime)." />
            <figcaption>3 tiers · structural · behavioural · productization</figcaption>
          </figure>
          <figure>
            <img src="./assets/deployment-flow.png" alt="MatrixOmnix shipping plan: Phase A ships the two MCP tools and the back-compat CLI today; Phase B candidates (trust_check, qa_regression_replay, report_project, compare_runs) wait on real consumer demand." />
            <figcaption>Phase A shipped · Phase B candidates parked</figcaption>
          </figure>
        </div>

        <section class="about-narrative" aria-label="MatrixOmnix overview">
          <article>
            <h2>Why it exists</h2>
            <p>
              Coding agents are good at producing code; they are systematically bad at independently verifying that the code actually became a maintainable project. AI agents skip verification, claim completion without evidence, reintroduce yesterday's bug, and ship READMEs that lie about what runs. MatrixOmnix is the part of the loop that refuses to take the agent's word for it — a separate process, with no write access, that says yes or no with evidence.
            </p>
          </article>
          <article>
            <h2>How it works</h2>
            <p>
              MatrixOmnix exposes two MCP tools over stdio. <code>verify_project(path)</code> returns a single envelope: <code>archetype</code>, <code>score</code> (0..100, evidence-weighted), <code>verdict</code> (pass / needs_repair / fail), <code>findings</code> (severity-sorted), <code>evidence</code> summary, and <code>qa_preflight</code> (known-recurring fingerprints). <code>detect_archetype(path)</code> is a cheaper archetype-only path. The do-layer (d2p, Claude Code, …) calls these between iterations and decides whether to keep going.
            </p>
          </article>
          <article>
            <h2>What it gates</h2>
            <p>
              Every product surface is gated across three honest tiers: tier-1 structural contract (always-on source-shape checks), tier-2 behavioural runtime (exercises the surface end-to-end; honestly skip-with-diagnostic when the runtime lib is absent), tier-3 productization surface (operational gates above runtime — error envelope, prompt-eval harness, provider failure fallback, token budget, prompt template registry, streaming response). Project archetype is decided by a hybrid of declarative JSON probes and built-in TypeScript probes; the real-project bench classifies 13 of 14 unfamiliar GitHub repos correctly.
            </p>
          </article>
          <article>
            <h2>What it explicitly does not do</h2>
            <p>
              No writes to the project under verification. No HTTP transport — stdio only. No multi-tenancy, auth or billing. No hosted upload-and-return service. No claim that a high internal score replaces human review. Those boundaries are the design's point: a verifier that mutates state or speaks a richer protocol is not independent.
            </p>
          </article>
        </section>

        <section class="text-grid" aria-label="Phase A and Phase B">
          <article>
            <h2>Phase A · shipped</h2>
            <p>
              Two MCP tools (<code>verify_project</code>, <code>detect_archetype</code>) plus a thin back-compat CLI. Built on the existing archetype detector, gap analyzer (80+ finding categories), evidence-weighted scorer, and QA case store. The do-layer (RuleBasedExecutor, iterate command, long-horizon autonomy, advisory agents, ~60 do-layer CLI commands) was surgically removed in the pivot: ~41k LOC → ~12k LOC, 752 vitest tests → 219, all passing. Pre-pivot state preserved at git tag <code>v0.0.6-final</code>.
            </p>
          </article>
          <article>
            <h2>Phase B · parking lot</h2>
            <p>
              Not pre-built. Each candidate has a graduation criterion driven by real consumer signal: <code>trust_check</code> (when verify passes but README lies, observed ≥ 2×), <code>qa_regression_replay</code> (when cross-project fingerprint reuse occurs), <code>report_project</code> (when JSON isn't enough for a consumer), <code>compare_runs</code> (when a downstream orchestrator wants the verifier to drive termination). HTTP transport, multi-tenancy, hosted upload — explicitly never.
            </p>
          </article>
        </section>

        <a class="repo-link" href="https://github.com/Hosico02/demo2project" target="_blank" rel="noreferrer">
          Open source repository: github.com/Hosico02/demo2project
        </a>
      </section>

      <section v-else-if="page === 'service'" class="content-page service-page" id="service">
        <PageHeading kicker="Service" title="How to integrate MatrixOmnix.">
          MatrixOmnix is a read-only verifier that runs as a local MCP stdio server (<code>d2p-verify</code>) plus a back-compat CLI. There is no hosted service. Pick the path that matches your client.
        </PageHeading>

        <section class="service-layout" data-service-guide>
          <article class="usage-card">
            <h2>Install</h2>
            <p>
              MatrixOmnix is a single Node package. Clone, install, build — that's it. The server is invoked over stdio so there's no port to configure and no daemon to keep alive.
            </p>
            <code>git clone https://github.com/Hosico02/demo2project</code>
            <code>cd demo2project && pnpm install</code>
            <code>pnpm build</code>
            <code>pnpm matrixomnix archetype --project ./your-repo</code>
          </article>

          <ol class="usage-steps">
            <li><strong>Path A · MCP client</strong><span>Add to your MCP client config (Claude Code's <code>.mcp.json</code>, Cursor's settings, etc.):<br /><code>{"mcpServers":{"d2p-verify":{"command":"node","args":["/abs/path/dist/mcp/server.js"]}}}</code><br />The client discovers <code>verify_project</code> and <code>detect_archetype</code> automatically.</span></li>
            <li><strong>Path B · subprocess</strong><span>Any orchestrator (d2p, custom Python/Go/Rust) can spawn <code>node dist/mcp/server.js</code> and talk JSON-RPC over its stdio. The MCP protocol is documented at <code>spec.modelcontextprotocol.io</code>. d2p's optional post-iteration hook is downstream — not bundled here.</span></li>
            <li><strong>Path C · CLI</strong><span>For one-off checks or CI: <code>pnpm matrixomnix archetype --project ./your-repo</code> for the cheap path, <code>pnpm matrixomnix gap --project ./your-repo</code> for the full gap report (evidence-weighted by default; add <code>--fast</code> for static-only).</span></li>
            <li><strong>verify_project envelope</strong><span>Returns <code>{archetype, score, verdict, findings, evidence, qa_preflight}</code>. Verdict is <code>fail</code> if any finding is <code>blocker</code> severity, <code>needs_repair</code> if any <code>high</code>, else <code>pass</code>. Drive your do-layer's next iteration from this single value.</span></li>
            <li><strong>Inspect interactively</strong><span>The MCP Inspector lets you call tools by hand to confirm the server is wired up correctly: <code>npx @modelcontextprotocol/inspector node dist/mcp/server.js</code>.</span></li>
          </ol>
        </section>

        <code class="command-strip">node dist/mcp/server.js  # d2p-verify stdio server</code>
        <p class="service-footnote">
          Verifier never writes to the project under verification. Pair with a do-layer (<a href="https://github.com/Hosico02/d2p" target="_blank" rel="noopener">d2p</a> recommended) to produce changes, then call <code>verify_project</code> again.
        </p>
      </section>

      <section v-else class="content-page contact-page" id="contact">
        <PageHeading kicker="Contact" title="Pair MatrixOmnix with your do-layer.">
          MatrixOmnix is open source. File issues, propose Phase B graduations, or share verify_project envelopes that surfaced real bugs in your pipeline. The recommended do-layer is d2p — link your demo there, verify here.
        </PageHeading>

        <div class="contact-grid">
          <a href="https://github.com/Hosico02/demo2project" target="_blank" rel="noreferrer">
            <span>Verifier · this repo</span>
            <strong>github.com/Hosico02/demo2project</strong>
          </a>
          <a href="https://github.com/Hosico02/d2p" target="_blank" rel="noreferrer">
            <span>Recommended do-layer</span>
            <strong>github.com/Hosico02/d2p</strong>
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
