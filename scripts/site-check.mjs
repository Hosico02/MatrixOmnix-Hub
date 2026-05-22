#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const site = path.join(root, 'site');
const checks = [];

function record(id, ok, detail) {
  checks.push({ id, ok, detail });
}

function read(rel) {
  return readFileSync(path.join(site, rel), 'utf8');
}

for (const rel of [
  'package.json',
  'vite.config.js',
  'index.html',
  'src/main.js',
  'src/App.vue',
  'src/style.css',
]) {
  record(`exists:${rel}`, existsSync(path.join(site, rel)), `${rel} exists`);
}

// Diagram assets: either the SVG source or a rendered PNG is acceptable —
// App.vue references the PNG variants, and PNGs are the canonical source
// when authored externally (e.g. via an image-gen tool) rather than hand-
// written SVG.
for (const stem of ['framework-loop', 'harness-map', 'deployment-flow']) {
  const candidates = ['svg', 'png', 'webp', 'jpg'].map((ext) => path.join(site, 'src', 'assets', `${stem}.${ext}`));
  record(
    `exists:src/assets/${stem}.{svg|png|webp|jpg}`,
    candidates.some((p) => existsSync(p)),
    `src/assets/${stem}.{svg|png|webp|jpg} — at least one variant exists`,
  );
}

const pkg = existsSync(path.join(site, 'package.json')) ? JSON.parse(read('package.json')) : {};
const index = existsSync(path.join(site, 'index.html')) ? read('index.html') : '';
const app = existsSync(path.join(site, 'src/App.vue')) ? read('src/App.vue') : '';
const css = existsSync(path.join(site, 'src/style.css')) ? read('src/style.css') : '';
const vite = existsSync(path.join(site, 'vite.config.js')) ? read('vite.config.js') : '';

record('vite-vue-dependency', Boolean(pkg.dependencies?.vue && pkg.dependencies?.vite && pkg.dependencies?.['@vitejs/plugin-vue']), 'site package uses Vite + Vue');
record('vite-plugin-vue', /@vitejs\/plugin-vue/.test(vite), 'Vite config enables Vue plugin');
record('spa-entry', /<div id="app"><\/div>/.test(index) && /src="\/src\/main\.js"/.test(index), 'index.html is a Vue SPA entry');
record('no-static-pages', !existsSync(path.join(site, 'about.html')) && !existsSync(path.join(site, 'service.html')) && !existsSync(path.join(site, 'contact.html')), 'site no longer ships separate static pages');
record('matrixomnix-brand', /MatrixOmnix/.test(app) && /全域智能矩阵/.test(app), 'MatrixOmnix brand appears in Vue app');
record('nav-pages', /id: 'about'/.test(app) && /id: 'service'/.test(app) && /id: 'contact'/.test(app), 'Vue app defines About, Service and Contact pages');
record('home-hero-panel-separation', /<template v-if="page === 'home'">[\s\S]*<section class="hero"[\s\S]*<\/section>\s*<section class="panel-grid"/.test(app), 'Home hero centers title separately from capability panels');
record('home-only-cursor', /v-if="page === 'home'" class="cursor-capture"/.test(app) && /v-if="page === 'home'" class="cursor-core"/.test(app), 'Custom cursor renders only on Home');
record('about-images', /framework-loop\.(svg|png|webp|jpg)/.test(app) && /harness-map\.(svg|png|webp|jpg)/.test(app) && /deployment-flow\.(svg|png|webp|jpg)/.test(app), 'About page uses framework images');
record('github-url', /https:\/\/github\.com\/Hosico02\/demo2project/.test(app), 'open source URL is present');
record('home-umbrella-copy', /demo into a verified product|two subsystems|do-layer|verify-layer/i.test(app), 'Home copy positions MatrixOmnix as the umbrella project');
record('service-usage-guide', /data-service-guide/.test(app) && /pnpm matrixomnix (analyze|gap|archetype)/.test(app), 'Service page explains verify-layer CLI usage');
record('service-mentions-d2p', /python run\.py|github\.com\/Hosico02\/d2p/.test(app), 'Service page references the d2p do-layer');
record('service-no-upload-form', !/data-upload-form|data-demo-upload|type="file"|data-return-format/.test(app), 'Service page does not present hosted upload or return service');
record('service-no-upload-copy', !/Upload a demo|Receive a product zip|Output:\s*zip|uploaded demo archive|returned product|product zip artifacts/i.test(app + index), 'Service copy does not claim hosted upload/return is available');
record('keyboard-flip', /onKeydown/.test(app) && /Enter/.test(app) && /Escape/.test(app), 'flip panels support keyboard interaction');
record('pointer-raf', /requestAnimationFrame/.test(app) && /pointermove/.test(app), 'cursor effect is throttled through requestAnimationFrame');
record('css-no-hidden-cursor', !/cursor\s*:\s*none/.test(css), 'site does not hide the system cursor globally');
record('css-focus-visible', /:focus-visible/.test(css), 'focus-visible styles exist');
record('css-responsive', /@media\s*\(max-width:\s*720px\)/.test(css), 'responsive breakpoint exists');
record('no-beta-placeholder', !/This is just a BETA|beta version of MatrixOmnix/i.test(app), 'old beta placeholder copy removed');

const failures = checks.filter((check) => !check.ok);
console.log(JSON.stringify({ ok: failures.length === 0, checks, failures }, null, 2));
if (failures.length > 0) process.exit(1);
