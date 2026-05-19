import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { AnalyzerAgent } from '../src/agents/AnalyzerAgent.js';
import { analyzeGaps, auditAgentMisjudgments } from '../src/core/gapAnalyzer.js';
import { writeMarketResearchReport } from '../src/research/MarketResearchAgent.js';
import type { MarketResearchReport } from '../src/research/types.js';
import { takeSnapshot } from '../src/core/projectSnapshot.js';
import type { ProjectScore, ProjectSnapshot } from '../src/core/types.js';
import { selectStandardForSnapshot } from '../src/standards/standardsLibrary.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const badDemo = path.resolve(here, '..', 'examples', 'bad-demo');

describe('gapAnalyzer', () => {
  it('flags missing README, missing tests, and missing test/build commands for bad-demo', async () => {
    const agent = new AnalyzerAgent();
    const { gap } = await agent.fullAnalyze(badDemo);
    const categories = gap.findings.map((f) => f.category);
    expect(categories).toContain('missing_readme');
    expect(categories).toContain('no_tests');
    expect(gap.findings.some((f) => f.category === 'missing_required_command' && /test/.test(f.message))).toBe(true);
    expect(gap.blockers.length).toBeGreaterThan(0);
  });

  it('flags Python projects with Node-only validation scaffolding', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-py-gap-'));
    await fs.mkdir(path.join(dir, '.github', 'workflows'), { recursive: true });
    await fs.writeFile(path.join(dir, 'README.md'), '# Demo\n\n' + 'x'.repeat(220));
    await fs.writeFile(path.join(dir, 'app.py'), 'print("hi")\n');
    await fs.writeFile(path.join(dir, 'requirements.txt'), 'flask>=3.0.0\n');
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({
      scripts: {
        test: 'node --test tests',
        build: 'node -e "console.log(\'build ok\')"',
      },
    }));
    await fs.writeFile(path.join(dir, '.github', 'workflows', 'ci.yml'), 'name: CI\njobs:\n  test:\n    steps:\n      - run: npm test\n');

    const { gap, standard_name } = await new AnalyzerAgent().fullAnalyze(dir);
    const categories = gap.findings.map((f) => f.category);

    expect(standard_name).toBe('flask-web-app');
    expect(categories).toContain('no_python_tests');
    expect(categories).not.toContain('no_tests');
    expect(categories).not.toContain('missing_required_command');
    expect(categories).toContain('fake_build_command');
    expect(categories).toContain('misaligned_node_scaffold');
    expect(categories).toContain('misaligned_ci');
  });

  it('flags Flask demos that are not ready for public deployment', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-flask-prod-gap-'));
    await fs.mkdir(path.join(dir, 'templates'), { recursive: true });
    await fs.mkdir(path.join(dir, 'tests'), { recursive: true });
    await fs.writeFile(path.join(dir, 'README.md'), '# Flask Demo\n\nRun with python app.py.\n' + 'x'.repeat(220));
    await fs.writeFile(path.join(dir, 'app.py'), [
      'from flask import Flask, jsonify',
      'app = Flask(__name__)',
      '@app.route("/config")',
      'def config():',
      '    return jsonify({"ok": True})',
      '@app.route("/start", methods=["POST"])',
      'def start():',
      '    return jsonify({"game_id": "demo"})',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(dir, 'requirements.txt'), 'flask>=3.0.0\npytest>=8.0\n');
    await fs.writeFile(path.join(dir, 'pyproject.toml'), '[project]\nname = "flask-demo"\n');
    await fs.writeFile(path.join(dir, 'tests', 'test_smoke.py'), 'def test_smoke():\n    assert True\n');

    const { gap, standard_name } = await new AnalyzerAgent().fullAnalyze(dir);
    const categories = gap.findings.map((f) => f.category);

    expect(standard_name).toBe('flask-web-app');
    expect(categories).toContain('missing_healthcheck');
    expect(categories).toContain('missing_config_guard');
    expect(categories).toContain('missing_wsgi_entrypoint');
    expect(categories).toContain('missing_python_production_server');
    expect(categories).toContain('missing_deployment_artifact');
    expect(categories).toContain('missing_api_tests');
    expect(categories).toContain('missing_deployment_docs');
  });

  it('flags pure UI demos without browser-level product verification', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-ui-product-gap-'));
    await fs.mkdir(path.join(dir, 'src'), { recursive: true });
    await fs.writeFile(path.join(dir, 'README.md'), '# UI Demo\n\nRun the Vite app.\n' + 'x'.repeat(420));
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({
      name: 'ui-demo',
      scripts: {
        dev: 'vite',
        build: 'vite build',
        test: 'vitest run',
      },
      dependencies: {
        '@vitejs/plugin-react': '^5.0.0',
        vite: '^6.0.0',
        react: '^19.0.0',
        'react-dom': '^19.0.0',
      },
      devDependencies: {
        vitest: '^2.0.0',
      },
    }, null, 2));
    await fs.writeFile(path.join(dir, 'index.html'), '<div id="root"></div><script type="module" src="/src/App.jsx"></script>\n');
    await fs.writeFile(path.join(dir, 'src', 'App.jsx'), [
      'export default function App() {',
      '  return <div><h1>Matrix Dashboard</h1><button onClick={() => {}}>Launch</button></div>;',
      '}',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(dir, 'src', 'App.test.jsx'), 'import { expect, test } from "vitest"; test("ok", () => expect(true).toBe(true));\n');

    const { gap, standard_name } = await new AnalyzerAgent().fullAnalyze(dir);
    const categories = gap.findings.map((f) => f.category);

    expect(standard_name).toBe('react-app');
    expect(categories).toContain('missing_ui_product_verification');
    expect(categories).toContain('below_web_ui_product_maturity');
    expect(categories).not.toContain('below_social_deduction_market_parity');
    expect(gap.product_maturity?.domain).toBe('web_ui_app');
    expect(gap.score.score_gate?.failures.some((f) => f.gate === 'product_maturity')).toBe(true);
  });

  it('flags UI projects whose browser harness lacks runtime render smoke checks', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-ui-render-gap-'));
    await fs.mkdir(path.join(dir, 'src'), { recursive: true });
    await fs.mkdir(path.join(dir, 'tests', 'ui'), { recursive: true });
    await fs.writeFile(path.join(dir, 'README.md'), '# UI Demo\n\nRun the Vite app.\n' + 'x'.repeat(420));
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({
      name: 'ui-render-demo',
      scripts: {
        dev: 'vite',
        build: 'vite build',
        test: 'vitest run',
        'ui:e2e': 'playwright test',
      },
      dependencies: {
        '@vitejs/plugin-react': '^5.0.0',
        vite: '^6.0.0',
        react: '^19.0.0',
        'react-dom': '^19.0.0',
      },
      devDependencies: {
        '@playwright/test': '^1.52.0',
        vitest: '^2.0.0',
      },
    }, null, 2));
    await fs.writeFile(path.join(dir, 'index.html'), '<div id="root"></div><script type="module" src="/src/App.jsx"></script>\n');
    await fs.writeFile(path.join(dir, 'playwright.config.ts'), 'export default {};\n');
    await fs.writeFile(path.join(dir, 'tests', 'ui', 'smoke.spec.ts'), 'import { test } from "@playwright/test"; test("loads", async ({ page }) => { await page.goto("/"); });\n');
    await fs.writeFile(path.join(dir, 'src', 'App.jsx'), [
      'import "./style.css";',
      'export default function App() { return <main aria-label="Console"><h1>Matrix Dashboard</h1><button>Launch</button></main>; }',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(dir, 'src', 'style.css'), [
      ':root { --accent: #38bdf8; font-family: Inter, sans-serif; }',
      'main { display: grid; gap: 16px; }',
      '@media (max-width: 640px) { main { padding: 12px; } }',
      'button:hover, button:focus-visible { outline: 2px solid var(--accent); }',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(dir, 'src', 'App.test.jsx'), 'import { expect, test } from "vitest"; test("ok", () => expect(1 + 1).toBe(2));\n');

    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    const categories = gap.findings.map((f) => f.category);

    expect(categories).not.toContain('missing_ui_product_verification');
    expect(categories).toContain('missing_ui_runtime_render_smoke');
  });

  it('flags single-file demos without an intake/runtime contract harness', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-single-file-gap-'));
    await fs.writeFile(path.join(dir, 'demo.py'), [
      'def main():',
      '    print("hello demo")',
      '',
      'if __name__ == "__main__":',
      '    main()',
      '',
    ].join('\n'));

    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    const categories = gap.findings.map((f) => f.category);

    expect(categories).toContain('single_file_demo_without_intake_harness');
  });

  it('does not flag single-file demos after the intake/runtime contract harness exists', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-single-file-harnessed-gap-'));
    await fs.mkdir(path.join(dir, 'scripts'), { recursive: true });
    await fs.mkdir(path.join(dir, 'docs'), { recursive: true });
    await fs.writeFile(path.join(dir, 'demo.py'), 'print("hello demo")\n');
    await fs.writeFile(path.join(dir, 'scripts', 'demo-runtime-check.mjs'), 'console.log("ok")\n');
    await fs.writeFile(path.join(dir, 'docs', 'demo-intake.md'), '# Demo Intake\n\nEntry: demo.py\n');
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({
      scripts: {
        test: 'python3 -m pytest -q',
        build: 'python3 -m py_compile demo.py',
        'demo:intake-check': 'node scripts/demo-runtime-check.mjs',
      },
    }, null, 2));

    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    const categories = gap.findings.map((f) => f.category);

    expect(categories).not.toContain('single_file_demo_without_intake_harness');
    expect(categories).not.toContain('misaligned_node_scaffold');
  });

  it('does not flag Python projects for contract harness aliases that run Node checks', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-py-contract-alias-gap-'));
    await fs.mkdir(path.join(dir, 'scripts'), { recursive: true });
    await fs.mkdir(path.join(dir, 'tests'), { recursive: true });
    await fs.writeFile(path.join(dir, 'README.md'), '# Flask Demo\n\nRun the Flask service.\n' + 'x'.repeat(420));
    await fs.writeFile(path.join(dir, 'app.py'), 'print("hi")\n');
    await fs.writeFile(path.join(dir, 'requirements.txt'), 'flask>=3.0.0\npytest>=8.0\n');
    await fs.writeFile(path.join(dir, 'tests', 'test_smoke.py'), 'def test_smoke():\n    assert True\n');
    await fs.writeFile(path.join(dir, 'scripts', 'api-contract-check.mjs'), 'console.log("ok")\n');
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({
      scripts: {
        test: 'python3 -m pytest -q',
        build: 'python3 -m py_compile app.py',
        'api:contract-check': 'node scripts/api-contract-check.mjs',
        'contract:check': 'node scripts/api-contract-check.mjs',
      },
    }, null, 2));

    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    const categories = gap.findings.map((f) => f.category);

    expect(categories).not.toContain('misaligned_node_scaffold');
  });

  it('flags CLI projects without an executable contract harness', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-cli-contract-gap-'));
    await fs.mkdir(path.join(dir, 'bin'), { recursive: true });
    await fs.mkdir(path.join(dir, 'tests'), { recursive: true });
    await fs.writeFile(path.join(dir, 'README.md'), '# CLI Demo\n\nRun the CLI.\n' + 'x'.repeat(420));
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({
      name: 'cli-demo',
      bin: './bin/cli.js',
      scripts: {
        test: 'node --test tests/smoke.test.mjs',
        build: 'node --check bin/cli.js',
      },
    }, null, 2));
    await fs.writeFile(path.join(dir, 'bin', 'cli.js'), '#!/usr/bin/env node\nif (process.argv.includes("--help")) console.log("Usage: cli-demo");\n');
    await fs.writeFile(path.join(dir, 'tests', 'smoke.test.mjs'), 'import test from "node:test"; test("ok", () => {});\n');

    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    const categories = gap.findings.map((f) => f.category);

    expect(categories).toContain('missing_cli_contract_harness');
  });

  it('does not flag CLI projects after an executable contract harness exists', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-cli-contract-ready-gap-'));
    await fs.mkdir(path.join(dir, 'bin'), { recursive: true });
    await fs.mkdir(path.join(dir, 'tests'), { recursive: true });
    await fs.mkdir(path.join(dir, 'scripts'), { recursive: true });
    await fs.mkdir(path.join(dir, 'docs'), { recursive: true });
    await fs.writeFile(path.join(dir, 'README.md'), '# CLI Demo\n\nRun the CLI.\n' + 'x'.repeat(420));
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({
      name: 'cli-demo',
      bin: './bin/cli.js',
      scripts: {
        test: 'node --test tests/smoke.test.mjs',
        build: 'node --check bin/cli.js',
        'cli:contract-check': 'node scripts/cli-contract-check.mjs',
      },
    }, null, 2));
    await fs.writeFile(path.join(dir, 'bin', 'cli.js'), '#!/usr/bin/env node\nif (process.argv.includes("--help")) console.log("Usage: cli-demo");\n');
    await fs.writeFile(path.join(dir, 'tests', 'smoke.test.mjs'), 'import test from "node:test"; test("ok", () => {});\n');
    await fs.writeFile(path.join(dir, 'scripts', 'cli-contract-check.mjs'), 'console.log("ok")\n');
    await fs.writeFile(path.join(dir, 'docs', 'cli-contract.md'), '# CLI Contract\n');

    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    const categories = gap.findings.map((f) => f.category);

    expect(categories).not.toContain('missing_cli_contract_harness');
  });

  it('flags contract-only productization shells without executable product core', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-demo-shell-gap-'));
    await fs.mkdir(path.join(dir, 'bin'), { recursive: true });
    await fs.mkdir(path.join(dir, 'tests'), { recursive: true });
    await fs.mkdir(path.join(dir, 'scripts'), { recursive: true });
    await fs.mkdir(path.join(dir, 'docs'), { recursive: true });
    await fs.writeFile(path.join(dir, 'README.md'), '# CLI Demo\n\nRun the CLI.\n' + 'x'.repeat(420));
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({
      name: 'cli-demo',
      bin: './bin/cli.js',
      scripts: {
        test: 'node --test tests/smoke.test.mjs',
        build: 'node --check bin/cli.js',
        'cli:contract-check': 'node scripts/cli-contract-check.mjs',
      },
    }, null, 2));
    await fs.writeFile(path.join(dir, 'bin', 'cli.js'), '#!/usr/bin/env node\nif (process.argv.includes("--help")) console.log("Usage: cli-demo");\n');
    await fs.writeFile(path.join(dir, 'tests', 'smoke.test.mjs'), 'import test from "node:test"; test("ok", () => {});\n');
    await fs.writeFile(path.join(dir, 'scripts', 'cli-contract-check.mjs'), 'console.log("ok")\n');
    await fs.writeFile(path.join(dir, 'docs', 'cli-contract.md'), '# CLI Contract\n');

    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    const categories = gap.findings.map((f) => f.category);

    expect(categories).toContain('demo_shell_without_product_core');
  });

  it('accepts productized demos with a tested product core spine', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-product-core-gap-'));
    await fs.mkdir(path.join(dir, 'bin'), { recursive: true });
    await fs.mkdir(path.join(dir, 'src'), { recursive: true });
    await fs.mkdir(path.join(dir, 'tests'), { recursive: true });
    await fs.mkdir(path.join(dir, 'scripts'), { recursive: true });
    await fs.mkdir(path.join(dir, 'docs'), { recursive: true });
    await fs.writeFile(path.join(dir, 'README.md'), '# CLI Demo\n\nRun the CLI.\n' + 'x'.repeat(420));
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({
      name: 'cli-demo',
      bin: './bin/cli.js',
      scripts: {
        test: 'node --test tests/product-core.test.mjs',
        build: 'node --check src/product-core.mjs',
        'cli:contract-check': 'node scripts/cli-contract-check.mjs',
        'product:core-check': 'node --test tests/product-core.test.mjs',
      },
    }, null, 2));
    await fs.writeFile(path.join(dir, 'bin', 'cli.js'), '#!/usr/bin/env node\nimport { createProductCore } from "../src/product-core.mjs";\nif (process.argv.includes("--help")) console.log(createProductCore().usage);\n');
    await fs.writeFile(path.join(dir, 'src', 'product-core.mjs'), 'export function createProductCore() { return { usage: "Usage: cli-demo", capabilities: ["cli"], workflows: ["help"] }; }\n');
    await fs.writeFile(path.join(dir, 'tests', 'product-core.test.mjs'), 'import test from "node:test"; import assert from "node:assert/strict"; import { createProductCore } from "../src/product-core.mjs"; test("product core", () => assert.ok(createProductCore().workflows.length));\n');
    await fs.writeFile(path.join(dir, 'scripts', 'cli-contract-check.mjs'), 'console.log("ok")\n');
    await fs.writeFile(path.join(dir, 'docs', 'cli-contract.md'), '# CLI Contract\n');
    await fs.writeFile(path.join(dir, 'docs', 'product-core.md'), '# Product Core\n');

    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    const categories = gap.findings.map((f) => f.category);

    expect(categories).not.toContain('demo_shell_without_product_core');
  });

  it('flags specialized visual demos that have product contracts but no runnable product entry', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-runtime-entry-gap-'));
    await fs.mkdir(path.join(dir, 'src'), { recursive: true });
    await fs.mkdir(path.join(dir, 'tests'), { recursive: true });
    await fs.mkdir(path.join(dir, 'scripts'), { recursive: true });
    await fs.mkdir(path.join(dir, 'docs'), { recursive: true });
    await fs.writeFile(path.join(dir, 'README.md'), '# Game Demo\n\n## Usage\n\nRun the product game.\n' + 'x'.repeat(420));
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({
      name: 'game-demo',
      type: 'module',
      dependencies: { phaser: '^3.90.0' },
      scripts: {
        test: 'node --test',
        build: 'node --check src/product-core.mjs',
        'surface:contract-check': 'node scripts/surface-contract-check.mjs',
        'game:contract-check': 'node scripts/game-contract-check.mjs',
        'product:core-check': 'node --test tests/product-core.test.mjs',
      },
    }, null, 2));
    await fs.writeFile(path.join(dir, 'src', 'game.js'), 'new Phaser.Game({ scene: { create() {} } });\n');
    await fs.writeFile(path.join(dir, 'src', 'product-core.mjs'), 'export function createProductCore() { return { capabilities: ["game_demo"], workflows: [{ id: "game", capability: "game_demo", status: "implemented" }] }; }\n');
    await fs.writeFile(path.join(dir, 'tests', 'product-core.test.mjs'), 'import test from "node:test"; import assert from "node:assert/strict"; import { createProductCore } from "../src/product-core.mjs"; test("product core", () => assert.ok(createProductCore().workflows.length));\n');
    await fs.writeFile(path.join(dir, 'scripts', 'surface-contract-check.mjs'), 'console.log("ok")\n');
    await fs.writeFile(path.join(dir, 'scripts', 'game-contract-check.mjs'), 'console.log("ok")\n');
    await fs.writeFile(path.join(dir, 'docs', 'productization-surface-map.md'), '# Surface Map\n');
    await fs.writeFile(path.join(dir, 'docs', 'game-contract.md'), '# Game Contract\n');
    await fs.writeFile(path.join(dir, 'docs', 'product-core.md'), '# Product Core\n');

    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    const categories = gap.findings.map((f) => f.category);

    expect(categories).toContain('missing_product_runtime_entry');
  });

  it('flags ML and media product cores that have no runnable product entry', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-pipeline-runtime-gap-'));
    await fs.mkdir(path.join(dir, 'src'), { recursive: true });
    await fs.mkdir(path.join(dir, 'tests'), { recursive: true });
    await fs.mkdir(path.join(dir, 'scripts'), { recursive: true });
    await fs.mkdir(path.join(dir, 'docs'), { recursive: true });
    await fs.writeFile(path.join(dir, 'README.md'), '# Media Pipeline\n\n## Usage\n\nRun the pipeline product.\n' + 'x'.repeat(420));
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({
      name: 'media-pipeline',
      type: 'module',
      dependencies: { sharp: '^0.34.0' },
      scripts: {
        test: 'node --test',
        build: 'node --check src/product-core.mjs',
        'surface:contract-check': 'node scripts/surface-contract-check.mjs',
        'media:contract-check': 'node scripts/media-pipeline-contract-check.mjs',
        'product:core-check': 'node --test tests/product-core.test.mjs',
      },
    }, null, 2));
    await fs.writeFile(path.join(dir, 'src', 'process-media.js'), 'import sharp from "sharp"; export async function resize(input, output) { return sharp(input).resize(128).toFile(output); }\n');
    await fs.writeFile(path.join(dir, 'src', 'product-core.mjs'), 'export function createProductCore() { return { capabilities: ["media_pipeline"], workflows: [{ id: "media", capability: "media_pipeline", status: "implemented" }] }; }\n');
    await fs.writeFile(path.join(dir, 'tests', 'product-core.test.mjs'), 'import test from "node:test"; import assert from "node:assert/strict"; import { createProductCore } from "../src/product-core.mjs"; test("product core", () => assert.ok(createProductCore().workflows.length));\n');
    await fs.writeFile(path.join(dir, 'scripts', 'surface-contract-check.mjs'), 'console.log("ok")\n');
    await fs.writeFile(path.join(dir, 'scripts', 'media-pipeline-contract-check.mjs'), 'console.log("ok")\n');
    await fs.writeFile(path.join(dir, 'docs', 'productization-surface-map.md'), '# Surface Map\n');
    await fs.writeFile(path.join(dir, 'docs', 'media-pipeline-contract.md'), '# Media Contract\n');
    await fs.writeFile(path.join(dir, 'docs', 'product-core.md'), '# Product Core\n');

    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    const categories = gap.findings.map((f) => f.category);

    expect(categories).toContain('missing_product_runtime_entry');
  });

  it('does not apply generic web UI maturity gates to game and mobile product surfaces', async () => {
    const gameDir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-game-maturity-scope-'));
    await fs.mkdir(path.join(gameDir, 'src'), { recursive: true });
    await fs.mkdir(path.join(gameDir, 'tests'), { recursive: true });
    await fs.writeFile(path.join(gameDir, 'README.md'), '# Game Product\n\n## Usage\n\nRun `npm start`.\n' + 'x'.repeat(420));
    await fs.writeFile(path.join(gameDir, 'package.json'), JSON.stringify({
      name: 'game-product',
      type: 'module',
      dependencies: { phaser: '^3.90.0' },
      devDependencies: { vite: '^6.0.0' },
      scripts: {
        start: 'vite --host 0.0.0.0',
        test: 'node --test',
        build: 'node --check src/product-core.mjs',
        'product:core-check': 'node --test tests/product-core.test.mjs',
      },
    }, null, 2));
    await fs.writeFile(path.join(gameDir, 'index.html'), '<main id="app"></main><script type="module" src="/src/product-runtime.mjs"></script>\n');
    await fs.writeFile(path.join(gameDir, 'src', 'game.js'), 'new Phaser.Game({ scene: { create() {} } });\n');
    await fs.writeFile(path.join(gameDir, 'src', 'product-runtime.mjs'), 'import Phaser from "phaser"; globalThis.Phaser = Phaser; await import("./game.js");\n');
    await fs.writeFile(path.join(gameDir, 'src', 'product-core.mjs'), 'export function createProductCore() { return { capabilities: ["game_demo"], workflows: [{ id: "game", capability: "game_demo", status: "implemented" }] }; }\n');
    await fs.writeFile(path.join(gameDir, 'tests', 'product-core.test.mjs'), 'import test from "node:test"; import assert from "node:assert/strict"; import { createProductCore } from "../src/product-core.mjs"; test("product core", () => assert.ok(createProductCore().workflows.length));\n');

    const mobileDir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-mobile-maturity-scope-'));
    await fs.mkdir(path.join(mobileDir, 'src'), { recursive: true });
    await fs.mkdir(path.join(mobileDir, 'tests'), { recursive: true });
    await fs.writeFile(path.join(mobileDir, 'README.md'), '# Mobile Product\n\n## Usage\n\nRun `npm start`.\n' + 'x'.repeat(420));
    await fs.writeFile(path.join(mobileDir, 'app.json'), JSON.stringify({ expo: { name: 'Mobile Product', slug: 'mobile-product' } }, null, 2));
    await fs.writeFile(path.join(mobileDir, 'App.js'), 'import React from "react"; import { Text } from "react-native"; export default function App() { return <Text>Ready</Text>; }\n');
    await fs.writeFile(path.join(mobileDir, 'package.json'), JSON.stringify({
      name: 'mobile-product',
      dependencies: { expo: '^54.0.0', react: '^19.0.0', 'react-native': '^0.81.0' },
      scripts: {
        start: 'expo start',
        test: 'node --test',
        build: 'node --check src/product-core.mjs',
        'product:core-check': 'node --test tests/product-core.test.mjs',
      },
    }, null, 2));
    await fs.writeFile(path.join(mobileDir, 'src', 'product-core.mjs'), 'export function createProductCore() { return { capabilities: ["mobile_app"], workflows: [{ id: "mobile", capability: "mobile_app", status: "implemented" }] }; }\n');
    await fs.writeFile(path.join(mobileDir, 'tests', 'product-core.test.mjs'), 'import test from "node:test"; import assert from "node:assert/strict"; import { createProductCore } from "../src/product-core.mjs"; test("product core", () => assert.ok(createProductCore().workflows.length));\n');

    for (const dir of [gameDir, mobileDir]) {
      const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
      const categories = gap.findings.map((f) => f.category);
      expect(categories).not.toContain('below_web_ui_product_maturity');
      expect(gap.product_maturity?.domain).not.toBe('web_ui_app');
    }
  });

  it('flags common UI interaction, accessibility and polish risks across UI projects', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-ui-hardening-gap-'));
    await fs.mkdir(path.join(dir, 'src'), { recursive: true });
    await fs.mkdir(path.join(dir, 'example'), { recursive: true });
    await fs.writeFile(path.join(dir, 'README.md'), '# UI Demo\n\nRun the Vite app.\n' + 'x'.repeat(420));
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({
      name: 'ui-hardening-demo',
      scripts: { dev: 'vite', build: 'vite build', test: 'node --test tests/smoke.test.mjs' },
      dependencies: { vue: '^3.5.0', vite: '^6.0.0' },
      devDependencies: { '@vitejs/plugin-vue': '^5.0.0' },
    }, null, 2));
    await fs.writeFile(path.join(dir, 'index.html'), '<div id="app"></div><script type="module" src="/src/App.vue"></script>\n');
    await fs.writeFile(path.join(dir, 'src', 'App.vue'), [
      '<template>',
      '  <nav class="nav"><a href="#about">About</a></nav>',
      '  <section id="about" class="panel flip-panel" @mouseenter="flipOn(\'about\')" @mouseleave="flipOff(\'about\')">',
      '    <p>Welcome to my website.</p>',
      '  </section>',
      '</template>',
      '<script setup>',
      "import { ref, onMounted } from 'vue'",
      'const cursorX = ref(0)',
      'const cursorY = ref(0)',
      'onMounted(() => {',
      '  document.addEventListener("mousemove", (event) => {',
      '    cursorX.value = event.clientX',
      '    cursorY.value = event.clientY',
      '  })',
      '})',
      '</script>',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(dir, 'src', 'style.css'), [
      'body { cursor: none; }',
      '.topbar { position: sticky; top: 0; }',
      '.brand { letter-spacing: 0.22em; }',
      '.hero-title__name { font-size: 7.25rem; }',
      '.cursor-core { width: 168px; }',
      '.cursor-core { width: 168px; }',
      '.eyebrow, .subcopy { margin: 0; }',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(dir, 'example', 'index.html'), '<section class="panel flip-panel" id="about" data-flip-panel><p>Panel</p></section>\n');
    await fs.writeFile(path.join(dir, 'example', 'style.css'), '.brand { letter-spacing: 0; }\n.hero-title__name { font-size: 7.25rem; }\n');

    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    const categories = gap.findings.map((f) => f.category);

    expect(categories).toContain('ui_pointer_only_interaction');
    expect(categories).toContain('ui_hidden_system_cursor');
    expect(categories).toContain('ui_reactive_mousemove_cursor');
    expect(categories).toContain('ui_fixed_title_scale');
    expect(categories).toContain('ui_sticky_anchor_overlap');
    expect(categories).toContain('ui_placeholder_copy');
    expect(categories).toContain('ui_navigation_semantics');
    expect(categories).toContain('ui_css_cleanup_needed');
    expect(categories).toContain('ui_variant_style_drift');
  });

  it('flags UI pages that promise hosted file processing without backend evidence', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-ui-service-claim-gap-'));
    await fs.mkdir(path.join(dir, 'src'), { recursive: true });
    await fs.writeFile(path.join(dir, 'README.md'), '# UI Service Demo\n\nRun the Vite app.\n' + 'x'.repeat(420));
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({
      name: 'ui-service-claim-demo',
      scripts: { dev: 'vite', build: 'vite build', test: 'vitest run' },
      dependencies: { vue: '^3.5.0', vite: '^6.0.0' },
      devDependencies: { '@vitejs/plugin-vue': '^5.0.0', vitest: '^2.0.0' },
    }, null, 2));
    await fs.writeFile(path.join(dir, 'index.html'), '<div id="app"></div><script type="module" src="/src/App.vue"></script>\n');
    await fs.writeFile(path.join(dir, 'src', 'App.vue'), [
      '<template>',
      '  <main>',
      '    <h1>Upload a demo. Receive a product zip.</h1>',
      '    <form data-upload-form data-return-format="zip">',
      '      <input type="file" data-demo-upload accept=".zip,.7z,.rar,.tar,.tar.gz,.tgz" />',
      '      <p>MatrixOmnix will process the archive and return a productized zip artifact.</p>',
      '    </form>',
      '  </main>',
      '</template>',
      '',
    ].join('\n'));

    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    const serviceClaim = gap.findings.find((f) => f.category === 'ui_unimplemented_hosted_service_claim');

    expect(serviceClaim?.severity).toBe('high');
    expect(serviceClaim?.related_files).toContain('src/App.vue');
  });

  it('does not flag explicit beta usage guides as hosted service claims', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-ui-beta-guide-gap-'));
    await fs.mkdir(path.join(dir, 'src'), { recursive: true });
    await fs.writeFile(path.join(dir, 'README.md'), '# UI Beta Guide\n\nRun the Vite app.\n' + 'x'.repeat(420));
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({
      name: 'ui-beta-guide-demo',
      scripts: { dev: 'vite', build: 'vite build', test: 'vitest run' },
      dependencies: { vue: '^3.5.0', vite: '^6.0.0' },
      devDependencies: { '@vitejs/plugin-vue': '^5.0.0', vitest: '^2.0.0' },
    }, null, 2));
    await fs.writeFile(path.join(dir, 'index.html'), '<div id="app"></div><script type="module" src="/src/App.vue"></script>\n');
    await fs.writeFile(path.join(dir, 'src', 'App.vue'), [
      '<template>',
      '  <main>',
      '    <h1>How to use MatrixOmnix beta.</h1>',
      '    <p>MatrixOmnix is not a hosted file-processing service yet. Use the beta locally from the CLI.</p>',
      '    <code>pnpm matrixomnix analyze --project ./demo</code>',
      '  </main>',
      '</template>',
      '',
    ].join('\n'));

    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    const categories = gap.findings.map((f) => f.category);

    expect(categories).not.toContain('ui_unimplemented_hosted_service_claim');
  });

  it('flags a missing Flask start guard even when API key text appears elsewhere', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-flask-guard-gap-'));
    await fs.mkdir(path.join(dir, 'tests'), { recursive: true });
    await fs.writeFile(path.join(dir, 'README.md'), '# Flask Demo\n\nDocker gunicorn healthz\n' + 'x'.repeat(220));
    await fs.writeFile(path.join(dir, 'app.py'), [
      '"""Set DEEPSEEK_API_KEY before running publicly."""',
      'from flask import Flask, jsonify',
      'from config import has_api_key, missing_api_key_payload, public_config',
      'app = Flask(__name__)',
      '@app.route("/healthz")',
      'def healthz():',
      '    return jsonify({"ok": True, "llm_configured": public_config()["has_key"]})',
      '@app.route("/start", methods=["POST"])',
      'def start():',
      '    return jsonify({"game_id": "demo"})',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(dir, 'config.py'), [
      'import os',
      'def has_api_key():',
      '    return bool(os.environ.get("DEEPSEEK_API_KEY") or os.environ.get("OPENAI_API_KEY"))',
      'def missing_api_key_payload():',
      '    return {"error": "missing_api_key"}',
      'def public_config():',
      '    return {"has_key": has_api_key()}',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(dir, 'requirements.txt'), 'flask>=3.0.0\npytest>=8.0\ngunicorn>=22.0.0\n');
    await fs.writeFile(path.join(dir, 'pyproject.toml'), '[project]\nname = "flask-demo"\n');
    await fs.writeFile(path.join(dir, 'Dockerfile'), 'FROM python:3.11-slim\nHEALTHCHECK CMD curl http://127.0.0.1:5001/healthz\n');
    await fs.writeFile(path.join(dir, 'wsgi.py'), 'from app import app\n');
    await fs.writeFile(path.join(dir, 'tests', 'test_app.py'), 'def test_api(client):\n    assert "/start"\n');

    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    const categories = gap.findings.map((f) => f.category);

    expect(categories).toContain('missing_config_guard');
  });

  it('flags Flask Dockerfiles that still start the development server', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-flask-docker-dev-cmd-'));
    await fs.mkdir(path.join(dir, 'tests'), { recursive: true });
    await fs.writeFile(path.join(dir, 'README.md'), '# Flask Demo\n\nDocker gunicorn healthz deployment notes.\n' + 'x'.repeat(260));
    await fs.writeFile(path.join(dir, 'app.py'), [
      'from flask import Flask, jsonify',
      'app = Flask(__name__)',
      '@app.route("/healthz")',
      'def healthz():',
      '    return jsonify({"status": "ok"})',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(dir, 'requirements.txt'), 'flask>=3.0.0,<4.0.0\npytest>=8.0.0,<9.0.0\ngunicorn>=22.0.0,<23.0.0\n');
    await fs.writeFile(path.join(dir, 'constraints.txt'), 'flask>=3.0.0,<4.0.0\npytest>=8.0.0,<9.0.0\ngunicorn>=22.0.0,<23.0.0\n');
    await fs.writeFile(path.join(dir, 'pyproject.toml'), '[project]\nname = "flask-demo"\n');
    await fs.writeFile(path.join(dir, 'Dockerfile'), 'FROM python:3.11-slim\nCMD ["python", "app.py"]\n');
    await fs.writeFile(path.join(dir, 'wsgi.py'), 'from app import app\n');
    await fs.writeFile(path.join(dir, 'tests', 'test_app.py'), 'def test_health_contract():\n    assert True\n');

    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    const categories = gap.findings.map((f) => f.category);

    expect(categories).toContain('flask_docker_uses_dev_server');
  });

  it('does not apply game start-route hardening gaps to generic Flask chat APIs', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-flask-chat-no-start-gap-'));
    await fs.mkdir(path.join(dir, 'tests'), { recursive: true });
    await fs.writeFile(path.join(dir, 'README.md'), '# Flask Chat Demo\n\nDocker gunicorn healthz\n' + 'x'.repeat(220));
    await fs.writeFile(path.join(dir, 'app.py'), [
      'from flask import Flask, jsonify, request',
      'from llm_config import public_provider_config, resolve_llm_config',
      'from openai import OpenAI',
      'app = Flask(__name__)',
      '@app.route("/healthz")',
      'def healthz():',
      '    return jsonify({"ok": True})',
      '@app.get("/config")',
      'def config():',
      '    return jsonify(public_provider_config())',
      '@app.post("/chat")',
      'def chat():',
      '    body = request.get_json(silent=True) or {}',
      '    llm_config = resolve_llm_config(body)',
      '    if not llm_config["ok"]:',
      '        return jsonify({"error": llm_config["error"], "providers": public_provider_config()}), 400',
      '    return jsonify({"reply": "ok"})',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(dir, 'llm_config.py'), [
      'def public_provider_config():',
      '    return {"providers": [{"id": "deepseek", "label": "DeepSeek", "models": ["deepseek-chat"], "default_model": "deepseek-chat"}]}',
      'def resolve_llm_config(payload):',
      '    return {"ok": bool(payload.get("api_key")), "error": "missing_api_key", "config": {"api_key": payload.get("api_key"), "base_url": "https://api.deepseek.com", "model": "deepseek-chat"}}',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(dir, 'requirements.txt'), 'flask>=3.0.0,<4.0.0\nopenai>=1.0.0,<2.0.0\npytest>=8.0.0,<9.0.0\ngunicorn>=22.0.0,<23.0.0\n');
    await fs.writeFile(path.join(dir, 'constraints.txt'), 'flask>=3.0.0,<4.0.0\nopenai>=1.0.0,<2.0.0\npytest>=8.0.0,<9.0.0\ngunicorn>=22.0.0,<23.0.0\n');
    await fs.writeFile(path.join(dir, 'pyproject.toml'), '[project]\nname = "flask-chat-demo"\n');
    await fs.writeFile(path.join(dir, 'Dockerfile'), 'FROM python:3.11-slim\nHEALTHCHECK CMD curl http://127.0.0.1:5001/healthz\n');
    await fs.writeFile(path.join(dir, 'wsgi.py'), 'from app import app\n');
    await fs.writeFile(path.join(dir, 'tests', 'test_app.py'), 'def test_chat():\n    assert True\n');

    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    const categories = gap.findings.map((f) => f.category);

    expect(categories).not.toContain('missing_config_guard');
    expect(categories).not.toContain('missing_start_input_validation');
    expect(categories).not.toContain('missing_active_game_limit');
  });

  it('accepts Flask start guards that call require_api_key and return 400 on failure', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-flask-require-guard-'));
    await fs.mkdir(path.join(dir, 'tests'), { recursive: true });
    await fs.writeFile(path.join(dir, 'README.md'), '# Flask Demo\n\nDocker gunicorn healthz\n' + 'x'.repeat(220));
    await fs.writeFile(path.join(dir, 'app.py'), [
      'from flask import Flask, jsonify',
      'from config import require_api_key',
      'app = Flask(__name__)',
      '@app.route("/healthz")',
      'def healthz():',
      '    return jsonify({"status": "ok"})',
      '@app.route("/start", methods=["POST"])',
      'def start():',
      '    has_key, error_msg = require_api_key()',
      '    if not has_key:',
      '        return jsonify({"error": error_msg}), 400',
      '    return jsonify({"game_id": "demo"})',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(dir, 'config.py'), [
      'def require_api_key():',
      '    return False, "missing"',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(dir, 'requirements.txt'), 'flask>=3.0.0\npytest>=8.0\ngunicorn>=22.0.0\n');
    await fs.writeFile(path.join(dir, 'pyproject.toml'), '[project]\nname = "flask-demo"\n');
    await fs.writeFile(path.join(dir, 'Dockerfile'), 'FROM python:3.11-slim\nHEALTHCHECK CMD curl http://127.0.0.1:5001/healthz\n');
    await fs.writeFile(path.join(dir, 'wsgi.py'), 'from app import app\n');
    await fs.writeFile(path.join(dir, 'tests', 'test_app.py'), 'def test_api(client):\n    assert "/start"\n');

    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    const categories = gap.findings.map((f) => f.category);

    expect(categories).not.toContain('missing_config_guard');
  });

  it('flags Flask demos missing industrial runtime controls', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-flask-industrial-gap-'));
    await fs.mkdir(path.join(dir, 'tests'), { recursive: true });
    await fs.writeFile(path.join(dir, 'README.md'), '# Flask Demo\n\nDocker gunicorn healthz\n' + 'x'.repeat(220));
    await fs.writeFile(path.join(dir, 'app.py'), [
      'from flask import Flask, jsonify, request',
      'from config import require_api_key',
      'GAME_MODES = {"m6": {"name": "six"}}',
      'DEFAULT_MODE = "m6"',
      '_games = {}',
      'app = Flask(__name__)',
      '@app.route("/healthz")',
      'def healthz():',
      '    return jsonify({"status": "ok"})',
      '@app.route("/start", methods=["POST"])',
      'def start():',
      '    has_key, error_msg = require_api_key()',
      '    if not has_key:',
      '        return jsonify({"error": error_msg}), 400',
      '    body = request.get_json(silent=True) or {}',
      '    mode = body.get("mode", DEFAULT_MODE)',
      '    speed = body.get("speed", 1.0)',
      '    _games["x"] = {"queue": None}',
      '    return jsonify({"game_id": "x", "mode": mode, "speed": speed})',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(dir, 'config.py'), [
      'def require_api_key():',
      '    return True, ""',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(dir, 'requirements.txt'), 'flask>=3.0.0\npytest>=8.0\ngunicorn>=22.0.0\n');
    await fs.writeFile(path.join(dir, 'pyproject.toml'), '[project]\nname = "flask-demo"\n');
    await fs.writeFile(path.join(dir, 'Dockerfile'), 'FROM python:3.11-slim\nHEALTHCHECK CMD curl http://127.0.0.1:5001/healthz\n');
    await fs.writeFile(path.join(dir, 'wsgi.py'), 'from app import app\n');
    await fs.writeFile(path.join(dir, 'tests', 'test_app.py'), 'def test_healthz():\n    assert True\n');

    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    const categories = gap.findings.map((f) => f.category);

    expect(categories).toContain('missing_security_headers');
    expect(categories).toContain('missing_start_input_validation');
    expect(categories).toContain('missing_active_game_limit');
    expect(categories).toContain('missing_structured_logging');
    expect(categories).toContain('missing_industrial_api_tests');
  });

  it('accepts industrial Flask chat route validation and logging tests', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-flask-chat-industrial-gap-'));
    await fs.mkdir(path.join(dir, 'tests'), { recursive: true });
    await fs.writeFile(path.join(dir, 'README.md'), '# Flask Chat Demo\n\nDocker gunicorn healthz chat endpoint\n' + 'x'.repeat(220));
    await fs.writeFile(path.join(dir, 'app.py'), [
      'import logging',
      'from flask import Flask, jsonify, request',
      'app = Flask(__name__)',
      'logger = logging.getLogger(__name__)',
      '@app.after_request',
      'def add_security_headers(response):',
      '    response.headers.setdefault("X-Content-Type-Options", "nosniff")',
      '    response.headers.setdefault("X-Frame-Options", "DENY")',
      '    response.headers.setdefault("Referrer-Policy", "no-referrer")',
      '    return response',
      '@app.route("/healthz")',
      'def healthz():',
      '    return jsonify({"status": "ok"})',
      '@app.post("/chat")',
      'def chat():',
      '    body = request.get_json(silent=True) or {}',
      '    message = body.get("message", "")',
      '    if not isinstance(message, str) or not message.strip():',
      '        logger.warning("invalid chat request", extra={"reason": "missing_message"})',
      '        return jsonify({"error": "invalid_message"}), 400',
      '    logger.info("chat request", extra={"message_length": len(message)})',
      '    return jsonify({"reply": message})',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(dir, 'requirements.txt'), 'flask>=3.0.0,<4.0.0\npytest>=8.0.0,<9.0.0\ngunicorn>=22.0.0,<23.0.0\n');
    await fs.writeFile(path.join(dir, 'pyproject.toml'), '[project]\nname = "flask-chat-demo"\n');
    await fs.writeFile(path.join(dir, 'Dockerfile'), 'FROM python:3.11-slim\nHEALTHCHECK CMD curl http://127.0.0.1:5001/healthz\n');
    await fs.writeFile(path.join(dir, 'wsgi.py'), 'from app import app\n');
    await fs.writeFile(path.join(dir, 'tests', 'test_app.py'), [
      'import pytest',
      '@pytest.fixture()',
      'def client():',
      '    import app as app_module',
      '    app_module.app.config.update(TESTING=True)',
      '    yield app_module.app.test_client()',
      'def test_security_headers_present(client):',
      '    response = client.get("/healthz")',
      '    assert response.headers["X-Content-Type-Options"] == "nosniff"',
      'def test_chat_rejects_missing_message(client):',
      '    response = client.post("/chat", json={})',
      '    assert response.status_code == 400',
      '    assert response.get_json()["error"] == "invalid_message"',
      '',
    ].join('\n'));

    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    const categories = gap.findings.map((f) => f.category);

    expect(categories).not.toContain('missing_structured_logging');
    expect(categories).not.toContain('missing_industrial_api_tests');
  });

  it('caps a production score when high-severity gaps remain open', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-flask-gap-gated-score-'));
    await fs.mkdir(path.join(dir, 'tests'), { recursive: true });
    await fs.writeFile(path.join(dir, 'README.md'), '# Flask Demo\n\nDocker gunicorn healthz\n' + 'x'.repeat(500));
    await fs.writeFile(path.join(dir, 'app.py'), [
      'from flask import Flask, jsonify, request',
      'from config import require_api_key',
      'GAME_MODES = {"m6": {"name": "six"}}',
      'DEFAULT_MODE = "m6"',
      '_games = {}',
      'app = Flask(__name__)',
      '@app.route("/healthz")',
      'def healthz():',
      '    return jsonify({"status": "ok"})',
      '@app.route("/start", methods=["POST"])',
      'def start():',
      '    has_key, error_msg = require_api_key()',
      '    if not has_key:',
      '        return jsonify({"error": error_msg}), 400',
      '    body = request.get_json(silent=True) or {}',
      '    mode = body.get("mode", DEFAULT_MODE)',
      '    speed = body.get("speed", 1.0)',
      '    _games["x"] = {"queue": None}',
      '    return jsonify({"game_id": "x", "mode": mode, "speed": speed})',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(dir, 'config.py'), [
      'def require_api_key():',
      '    return True, ""',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(dir, 'requirements.txt'), 'flask>=3.0.0\npytest>=8.0\ngunicorn>=22.0.0\n');
    await fs.writeFile(path.join(dir, 'pyproject.toml'), '[project]\nname = "flask-demo"\n');
    await fs.writeFile(path.join(dir, 'Dockerfile'), 'FROM python:3.11-slim\nHEALTHCHECK CMD curl http://127.0.0.1:5001/healthz\n');
    await fs.writeFile(path.join(dir, 'wsgi.py'), 'from app import app\n');
    await fs.writeFile(path.join(dir, 'tests', 'test_app.py'), 'def test_healthz():\n    assert True\n');

    const snapshot = await takeSnapshot(dir);
    const { standard } = await selectStandardForSnapshot(snapshot);
    const optimisticScore: ProjectScore = {
      total: 92,
      grade: 'production_ready_baseline',
      breakdown: {
        structure_score: 10,
        test_score: 18,
        build_score: 12,
        runtime_score: 10,
        docs_score: 10,
        config_score: 8,
        maintainability_score: 10,
        safety_score: 8,
        agent_process_score: 14,
      },
      notes: [],
      score_evidence: [],
      score_gate: { status: 'passed', cap: 100, failures: [] },
    };

    const gap = await analyzeGaps(snapshot, optimisticScore, standard);

    expect(gap.findings.some((f) => f.severity === 'high')).toBe(true);
    expect(gap.score.score_gate?.status).toBe('failed');
    expect(gap.score.score_gate?.failures.some((f) => f.gate === 'gap')).toBe(true);
    expect(gap.score.total).toBeLessThanOrEqual(79);
    expect(gap.score.grade).not.toBe('production_ready_baseline');
    expect(gap.score.notes.join('\n')).toMatch(/high-severity gap/i);
  });

  it('returns the gap-gated score from full analysis', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-full-analysis-gap-gated-score-'));
    await fs.mkdir(path.join(dir, 'tests'), { recursive: true });
    await fs.writeFile(path.join(dir, 'README.md'), '# Flask Demo\n\nDocker gunicorn healthz\n' + 'x'.repeat(500));
    await fs.writeFile(path.join(dir, 'app.py'), [
      'from flask import Flask, jsonify, request',
      'from config import require_api_key',
      'GAME_MODES = {"m6": {"name": "six"}}',
      'DEFAULT_MODE = "m6"',
      '_games = {}',
      'app = Flask(__name__)',
      '@app.route("/healthz")',
      'def healthz():',
      '    return jsonify({"status": "ok"})',
      '@app.route("/start", methods=["POST"])',
      'def start():',
      '    has_key, error_msg = require_api_key()',
      '    if not has_key:',
      '        return jsonify({"error": error_msg}), 400',
      '    body = request.get_json(silent=True) or {}',
      '    mode = body.get("mode", DEFAULT_MODE)',
      '    speed = body.get("speed", 1.0)',
      '    _games["x"] = {"queue": None}',
      '    return jsonify({"game_id": "x", "mode": mode, "speed": speed})',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(dir, 'config.py'), [
      'def require_api_key():',
      '    return True, ""',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(dir, 'requirements.txt'), 'flask>=3.0.0\npytest>=8.0\ngunicorn>=22.0.0\n');
    await fs.writeFile(path.join(dir, 'pyproject.toml'), '[project]\nname = "flask-demo"\n');
    await fs.writeFile(path.join(dir, 'Dockerfile'), 'FROM python:3.11-slim\nHEALTHCHECK CMD curl http://127.0.0.1:5001/healthz\n');
    await fs.writeFile(path.join(dir, 'wsgi.py'), 'from app import app\n');
    await fs.writeFile(path.join(dir, 'tests', 'test_app.py'), 'def test_healthz():\n    assert True\n');

    const { score, gap } = await new AnalyzerAgent().fullAnalyze(dir);

    expect(score.total).toBe(gap.score.total);
    expect(score.grade).toBe(gap.score.grade);
    expect(score.score_gate?.failures.some((f) => f.gate === 'gap')).toBe(true);
  });

  it('turns failed verification evidence into blocker gap findings', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-verification-gap-'));
    await fs.mkdir(path.join(dir, 'tests'), { recursive: true });
    await fs.writeFile(path.join(dir, 'README.md'), '# Demo\n\n' + 'x'.repeat(240));
    await fs.writeFile(path.join(dir, 'app.py'), 'print("demo")\n');
    await fs.writeFile(path.join(dir, 'tests', 'test_app.py'), 'def test_fail():\n    assert False\n');
    await fs.writeFile(path.join(dir, 'requirements.txt'), 'pytest>=8.0\n');
    const snapshot = await takeSnapshot(dir);
    const { standard } = await selectStandardForSnapshot(snapshot);
    const failedScore: ProjectScore = {
      total: 49,
      grade: 'working_demo',
      breakdown: {
        structure_score: 5,
        test_score: 10,
        build_score: 0,
        runtime_score: 4,
        docs_score: 5,
        config_score: 0,
        maintainability_score: 8,
        safety_score: 8,
        agent_process_score: 0,
      },
      notes: ['score gate failed: test command failed (cap 49)'],
      score_evidence: [
        {
          dimension: 'test_score',
          claimed: true,
          verified: true,
          evidence_command: 'python3 -m pytest -q',
          result: 'failed',
          confidence: 'high',
        },
      ],
      score_gate: {
        status: 'failed',
        cap: 49,
        failures: [
          {
            gate: 'test',
            cap: 49,
            reason: 'test command failed',
            evidence_command: 'python3 -m pytest -q',
            stdout_summary: [
              'tests/test_contract_harness.py:13: in test_config_contract_harness_passes',
              'scripts/config_contract_check.py:52: AssertionError',
              'E AssertionError: Expected env vars no longer read from source: WW_ALLOW_SERVER_LLM_KEY_FALLBACK',
            ].join('\n'),
            failure_reason: 'exit_code_1',
          },
        ],
      },
    };

    const gap = await analyzeGaps(snapshot, failedScore, standard);
    const verificationFinding = gap.findings.find((f) => f.category === 'failed_test_verification');

    expect(verificationFinding?.severity).toBe('blocker');
    expect(verificationFinding?.message).toContain('python3 -m pytest -q');
    expect(verificationFinding?.suggested_fix).toContain('WW_ALLOW_SERVER_LLM_KEY_FALLBACK');
    expect(verificationFinding?.related_files).toContain('scripts/config_contract_check.py');
    expect(gap.blockers.map((f) => f.category)).toContain('failed_test_verification');
  });

  it('flags Python products without dependency constraint policy', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-python-dep-policy-gap-'));
    await fs.mkdir(path.join(dir, 'tests'), { recursive: true });
    await fs.writeFile(path.join(dir, 'README.md'), '# Python Demo\n\nInstall with pip install -r requirements.txt.\n' + 'x'.repeat(260));
    await fs.writeFile(path.join(dir, 'app.py'), 'print("demo")\n');
    await fs.writeFile(path.join(dir, 'requirements.txt'), 'flask>=3.0.0\nopenai>=1.0.0\npytest>=8.0.0\n');
    await fs.writeFile(path.join(dir, 'pyproject.toml'), '[project]\nname = "demo"\ndependencies = ["flask>=3.0.0"]\n');
    await fs.writeFile(path.join(dir, 'tests', 'test_smoke.py'), 'def test_smoke():\n    assert True\n');

    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    const categories = gap.findings.map((f) => f.category);

    expect(categories).toContain('missing_python_dependency_constraints');
    expect(categories).toContain('unbounded_python_dependencies');
  });

  it('flags Python CI that ignores an existing constraints policy', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-python-ci-constraints-gap-'));
    await fs.mkdir(path.join(dir, 'tests'), { recursive: true });
    await fs.mkdir(path.join(dir, '.github', 'workflows'), { recursive: true });
    await fs.writeFile(path.join(dir, 'README.md'), '# Python Demo\n\nInstall with pip install -r requirements.txt -c constraints.txt.\n' + 'x'.repeat(260));
    await fs.writeFile(path.join(dir, 'app.py'), 'print("demo")\n');
    await fs.writeFile(path.join(dir, 'requirements.txt'), 'pytest>=8.0.0\n');
    await fs.writeFile(path.join(dir, 'constraints.txt'), 'pytest>=8.0.0,<9.0.0\n');
    await fs.writeFile(path.join(dir, 'pyproject.toml'), '[project]\nname = "demo"\n');
    await fs.writeFile(path.join(dir, 'tests', 'test_smoke.py'), 'def test_smoke():\n    assert True\n');
    await fs.writeFile(path.join(dir, '.github', 'workflows', 'ci.yml'), [
      'name: CI',
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/setup-python@v5',
      '      - run: pip install -r requirements.txt',
      '      - run: python -m pytest -q',
      '',
    ].join('\n'));

    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    const categories = gap.findings.map((f) => f.category);

    expect(categories).toContain('ci_ignores_python_constraints');
  });

  it('flags Flask products without regression tests and operational docs', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-flask-regression-docs-gap-'));
    await fs.mkdir(path.join(dir, 'tests'), { recursive: true });
    await fs.writeFile(path.join(dir, 'README.md'), '# Flask Demo\n\nDocker gunicorn healthz\n' + 'x'.repeat(260));
    await fs.writeFile(path.join(dir, 'app.py'), [
      'from flask import Flask, jsonify',
      'app = Flask(__name__)',
      '@app.route("/healthz")',
      'def healthz():',
      '    return jsonify({"status": "ok"})',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(dir, 'requirements.txt'), 'flask>=3.0.0,<4.0.0\npytest>=8.0.0,<9.0.0\n');
    await fs.writeFile(path.join(dir, 'constraints.txt'), 'flask>=3.0.0,<4.0.0\npytest>=8.0.0,<9.0.0\n');
    await fs.writeFile(path.join(dir, 'pyproject.toml'), '[project]\nname = "flask-demo"\n');
    await fs.writeFile(path.join(dir, 'Dockerfile'), 'FROM python:3.11-slim\nHEALTHCHECK CMD curl http://127.0.0.1:5001/healthz\n');
    await fs.writeFile(path.join(dir, 'wsgi.py'), 'from app import app\n');
    await fs.writeFile(path.join(dir, 'tests', 'test_app.py'), 'def test_healthz():\n    assert True\n');

    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    const categories = gap.findings.map((f) => f.category);

    expect(categories).toContain('missing_regression_tests');
    expect(categories).toContain('missing_operational_docs');
  });

  it('flags social deduction demos that still keep game rules as untested demo logic', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-werewolf-content-gap-'));
    await fs.mkdir(path.join(dir, 'tests'), { recursive: true });
    await fs.writeFile(path.join(dir, 'README.md'), '# Werewolf Demo\n\n## Quick Start\n\nRun the game.\n' + 'x'.repeat(260));
    await fs.writeFile(path.join(dir, 'requirements.txt'), 'pytest>=8.0.0,<9.0.0\n');
    await fs.writeFile(path.join(dir, 'constraints.txt'), 'pytest>=8.0.0,<9.0.0\n');
    await fs.writeFile(path.join(dir, 'game.py'), [
      'import random',
      'from collections import Counter',
      'GAME_MODES = {"m6": {"roles": ["werewolf", "seer", "witch", "villager"]}}',
      'class GameMaster:',
      '    def alive(self):',
      '        return []',
      '    def _balance(self):',
      '        return 1, 1',
      '    def winner(self):',
      '        wolves, goods = self._balance()',
      '        if wolves == 0:',
      '            return "好人"',
      '        if wolves >= goods:',
      '            return "狼人"',
      '        return None',
      '    def day_phase(self):',
      '        tally = Counter({1: 2, 2: 2})',
      '        cands = [1, 2]',
      '        executed = random.choice(cands)',
      '        return executed',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(dir, 'tests', 'test_smoke.py'), 'def test_smoke():\n    assert True\n');

    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    const categories = gap.findings.map((f) => f.category);

    expect(categories).toContain('missing_social_deduction_rules_engine');
    expect(categories).toContain('random_social_deduction_tie_breaker');
    expect(categories).toContain('missing_social_deduction_rule_tests');
  });

  it('flags social deduction projects whose rule engine does not validate game modes', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-werewolf-mode-gap-'));
    await fs.mkdir(path.join(dir, 'tests'), { recursive: true });
    await fs.writeFile(path.join(dir, 'README.md'), '# Werewolf Demo\n\n狼人杀 product candidate.\n' + 'x'.repeat(260));
    await fs.writeFile(path.join(dir, 'requirements.txt'), 'pytest>=8.0.0,<9.0.0\n');
    await fs.writeFile(path.join(dir, 'constraints.txt'), 'pytest>=8.0.0,<9.0.0\n');
    await fs.writeFile(path.join(dir, 'game.py'), [
      'from rules import resolve_vote_result, winner_from_alive_roles',
      'GAME_MODES = {"m6": {"roles": ["werewolf", "seer", "witch", "villager", "villager", "werewolf"]}}',
      'class GameMaster:',
      '    def alive(self):',
      '        return []',
      '    def winner(self):',
      '        return winner_from_alive_roles([])',
      '    def day_phase(self):',
      '        return resolve_vote_result({1: {"target": 2}})',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(dir, 'rules.py'), [
      'from collections import Counter',
      'def role_distribution(roles):',
      '    return dict(Counter(roles))',
      'def winner_from_alive_roles(roles):',
      '    return None',
      'def resolve_vote_result(votes):',
      '    return {"outcome": "none"}',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(dir, 'tests', 'test_rules.py'), 'from rules import resolve_vote_result\n\ndef test_vote():\n    assert resolve_vote_result({})["outcome"] == "none"\n');

    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    const categories = gap.findings.map((f) => f.category);

    expect(categories).toContain('missing_social_deduction_mode_validation');
    expect(categories).toContain('missing_social_deduction_mode_tests');
  });

  it('flags social deduction projects that define mode validation but do not enforce it at startup', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-werewolf-startup-mode-gap-'));
    await fs.mkdir(path.join(dir, 'tests'), { recursive: true });
    await fs.writeFile(path.join(dir, 'README.md'), '# Werewolf Demo\n\n狼人杀 product candidate.\n' + 'x'.repeat(260));
    await fs.writeFile(path.join(dir, 'requirements.txt'), 'pytest>=8.0.0,<9.0.0\n');
    await fs.writeFile(path.join(dir, 'constraints.txt'), 'pytest>=8.0.0,<9.0.0\n');
    await fs.writeFile(path.join(dir, 'game.py'), [
      'from rules import resolve_vote_result, validate_game_modes, winner_from_alive_roles',
      'GAME_MODES = {"m6": {"roles": ["werewolf", "seer", "witch", "villager", "villager", "werewolf"]}}',
      'class GameMaster:',
      '    def alive(self):',
      '        return []',
      '    def winner(self):',
      '        return winner_from_alive_roles([])',
      '    def day_phase(self):',
      '        return resolve_vote_result({1: {"target": 2}})',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(dir, 'rules.py'), [
      'def role_distribution(roles):',
      '    return {}',
      'def validate_mode_config(mode_id, roles):',
      '    return {"ok": "werewolf" in roles, "distribution": role_distribution(roles)}',
      'def validate_game_modes(modes):',
      '    return {"ok": True, "modes": {}}',
      'def winner_from_alive_roles(roles):',
      '    return None',
      'def resolve_vote_result(votes):',
      '    return {"outcome": "none"}',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(dir, 'tests', 'test_rules.py'), [
      'from rules import validate_mode_config, validate_game_modes',
      'def test_mode_config_validation_rejects_wolf_majority():',
      '    assert validate_mode_config("x", ["werewolf"])',
      '',
    ].join('\n'));

    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    const categories = gap.findings.map((f) => f.category);

    expect(categories).toContain('missing_social_deduction_mode_startup_guard');
  });

  it('separates engineering baseline from mature social deduction market parity', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-werewolf-market-gap-'));
    await fs.mkdir(path.join(dir, 'docs'), { recursive: true });
    await fs.mkdir(path.join(dir, 'tests'), { recursive: true });
    await fs.mkdir(path.join(dir, '.github', 'workflows'), { recursive: true });
    await fs.writeFile(path.join(dir, 'README.md'), '# Werewolf Product Candidate\n\nA tested狼人杀 social deduction game.\n' + 'x'.repeat(420));
    await fs.writeFile(path.join(dir, 'docs', 'market-parity.md'), [
      '# Market Parity Roadmap',
      'Future work: account profile login lobby room matchmaking voice chat websocket moderation report mute block ranked season leaderboard match history replay shop cosmetics admin metrics custom host controls.',
      'This is only a roadmap; it must not satisfy implementation capabilities.',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(dir, 'requirements.txt'), 'flask>=3.0.0,<4.0.0\npytest>=8.0.0,<9.0.0\ngunicorn>=22.0.0,<23.0.0\n');
    await fs.writeFile(path.join(dir, 'constraints.txt'), 'flask>=3.0.0,<4.0.0\npytest>=8.0.0,<9.0.0\ngunicorn>=22.0.0,<23.0.0\n');
    await fs.writeFile(path.join(dir, 'pyproject.toml'), '[project]\nname = "werewolf-product-candidate"\n');
    await fs.writeFile(path.join(dir, 'Dockerfile'), 'FROM python:3.11-slim\nCMD ["gunicorn", "wsgi:app"]\n');
    await fs.writeFile(path.join(dir, 'wsgi.py'), 'from app import app\n');
    await fs.writeFile(path.join(dir, '.github', 'workflows', 'ci.yml'), 'name: CI\njobs:\n  test:\n    steps:\n      - run: python3 -m pytest -q\n');
    await fs.writeFile(path.join(dir, 'app.py'), [
      'from flask import Flask, jsonify',
      'app = Flask(__name__)',
      '@app.route("/healthz")',
      'def healthz():',
      '    return jsonify({"status": "ok"})',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(dir, 'game.py'), [
      'from rules import resolve_vote_result, validate_game_modes, winner_from_alive_roles',
      'GAME_MODES = {"m6": {"roles": ["werewolf", "werewolf", "seer", "witch", "villager", "villager"]}}',
      '_MODE_VALIDATION = validate_game_modes(GAME_MODES)',
      'if not _MODE_VALIDATION["ok"]:',
      '    raise ValueError("bad modes")',
      'class GameMaster:',
      '    def winner(self):',
      '        return winner_from_alive_roles(["werewolf", "villager"])',
      '    def day_phase(self):',
      '        return resolve_vote_result({1: {"target": 2}})',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(dir, 'rules.py'), [
      'from collections import Counter',
      'def role_distribution(roles):',
      '    return dict(Counter(roles))',
      'def validate_mode_config(mode_id, roles):',
      '    return {"ok": "werewolf" in roles, "distribution": role_distribution(roles)}',
      'def validate_game_modes(modes):',
      '    return {"ok": True, "modes": {}}',
      'def winner_from_alive_roles(roles):',
      '    return None',
      'def resolve_vote_result(votes):',
      '    return {"outcome": "executed", "executed": 2}',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(dir, 'tests', 'test_rules.py'), [
      'from rules import resolve_vote_result, validate_mode_config',
      'def test_tied_vote_has_no_random_execution():',
      '    assert resolve_vote_result({})["outcome"] == "executed"',
      'def test_mode_config_validation_rejects_wolf_majority():',
      '    assert validate_mode_config("x", ["werewolf"])',
      '',
    ].join('\n'));

    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    const categories = gap.findings.map((f) => f.category);

    expect(gap.product_maturity?.domain).toBe('social_deduction_game');
    expect(gap.product_maturity?.level).not.toBe('market_ready');
    expect(gap.product_maturity?.score).toBeLessThanOrEqual(25);
    expect(gap.product_maturity?.missing_capabilities).toContain('Account identity and player profiles');
    expect(categories).toContain('below_social_deduction_market_parity');
    expect(gap.score.score_gate?.failures.some((f) => f.gate === 'product_maturity')).toBe(true);
    expect(gap.score.total).toBeLessThanOrEqual(gap.product_maturity?.score ?? 100);
    const confidenceAdjusted = (gap.score as typeof gap.score & { confidence_adjusted_score?: number }).confidence_adjusted_score;
    if (confidenceAdjusted !== undefined) expect(confidenceAdjusted).toBeLessThanOrEqual(gap.score.total);
  });

  it('uses an agent-facing maturity model for LLM werewolf theaters instead of human matchmaking parity', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-agent-werewolf-maturity-'));
    await fs.mkdir(path.join(dir, 'templates'), { recursive: true });
    await fs.writeFile(path.join(dir, 'README.md'), '# 狼人杀 Multi-Agent Theater\n\nLLM agents play werewolf for human observers with prompts, model providers and replay summaries.\n' + 'x'.repeat(320));
    await fs.writeFile(path.join(dir, 'requirements.txt'), 'flask>=3.0.0\nopenai>=1.0.0\n');
    await fs.writeFile(path.join(dir, 'app.py'), [
      'from flask import Flask, jsonify',
      'app = Flask(__name__)',
      '@app.route("/config")',
      'def config():',
      '    return jsonify({"model": "demo", "has_key": False})',
      '@app.route("/stream/<gid>")',
      'def stream(gid):',
      '    return "SSE EventSource observer timeline"',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(dir, 'game.py'), [
      'GAME_MODES = {"m9": {"roles": ["werewolf", "seer", "witch", "villager"]}}',
      'class GameMaster:',
      '    def winner(self):',
      '        return None',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(dir, 'player.py'), 'from openai import OpenAI\nclass Player:\n    def speak(self):\n        return "LLM agent model provider call"\n');
    await fs.writeFile(path.join(dir, 'prompts.py'), 'def build_system_prompt():\n    return "prompt: strictly play your secret werewolf role"\n');
    await fs.writeFile(path.join(dir, 'templates', 'index.html'), '<script>new EventSource("/stream/demo");</script><button id="start">start</button>\n');

    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    const categories = gap.findings.map((f) => f.category);

    expect(gap.product_maturity?.domain).toBe('agent_social_deduction_theater');
    expect(gap.product_maturity?.missing_capabilities).toContain('Per-session agent model and provider configuration');
    expect(categories).toContain('below_agent_social_deduction_theater_maturity');
    expect(categories).not.toContain('below_social_deduction_market_parity');
    expect(gap.product_maturity?.missing_capabilities).not.toContain('Account identity and player profiles');
    expect(gap.score.score_gate?.failures.some((f) => f.reason.includes('agent_social_deduction_theater'))).toBe(true);
  });

  it('does not count scattered provider strings as per-session agent model configuration', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-agent-werewolf-scattered-config-'));
    await fs.mkdir(path.join(dir, 'templates'), { recursive: true });
    await fs.writeFile(path.join(dir, 'README.md'), '# 狼人杀 Multi-Agent Theater\n\nLLM agents play werewolf for observers with model provider settings.\n' + 'x'.repeat(320));
    await fs.writeFile(path.join(dir, 'requirements.txt'), 'flask>=3.0.0\nopenai>=1.0.0\n');
    await fs.writeFile(path.join(dir, 'app.py'), [
      'from flask import Flask, jsonify, request',
      'app = Flask(__name__)',
      '@app.route("/config")',
      'def config():',
      '    return jsonify({"provider": "deepseek", "model": "deepseek-chat", "base_url": "https://api.deepseek.com"})',
      '@app.route("/start", methods=["POST"])',
      'def start():',
      '    body = request.get_json(silent=True) or {}',
      '    return jsonify({"api_key": body.get("api_key"), "provider": body.get("provider"), "model": body.get("model")})',
      '@app.route("/stream/<gid>")',
      'def stream(gid): return "SSE observer timeline"',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(dir, 'game.py'), 'GAME_MODES = {"m6": {"roles": ["werewolf", "seer", "villager"]}}\nclass GameMaster:\n    def winner(self):\n        return "werewolf"  # night day vote win condition\n');
    await fs.writeFile(path.join(dir, 'player.py'), 'from openai import OpenAI\nclass Player:\n    def speak(self):\n        return "LLM agent provider model call"\n');
    await fs.writeFile(path.join(dir, 'prompts.py'), 'def build_system_prompt(): return "role secrecy prompt"\n');
    await fs.writeFile(path.join(dir, 'templates', 'index.html'), '<select id="llmProvider"></select><input id="apiKey"><script>fetch("/start", {body: JSON.stringify({provider:"deepseek", model:"deepseek-chat", api_key:"sk"})}); new EventSource("/stream/demo");</script>\n');

    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);

    expect(gap.product_maturity?.domain).toBe('agent_social_deduction_theater');
    expect(gap.product_maturity?.missing_capabilities).toContain('Per-session agent model and provider configuration');
  });

  it('counts player-supplied provider config evidence toward agent-facing maturity', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-agent-werewolf-player-config-maturity-'));
    await fs.mkdir(path.join(dir, 'templates'), { recursive: true });
    await fs.writeFile(path.join(dir, 'README.md'), '# 狼人杀 Multi-Agent Theater\n\nLLM agents play werewolf with per-session provider configuration for observer-facing simulations.\n' + 'x'.repeat(320));
    await fs.writeFile(path.join(dir, 'requirements.txt'), 'flask>=3.0.0\nopenai>=1.0.0\n');
    await fs.writeFile(path.join(dir, 'llm_config.py'), [
      'PROVIDER_PRESETS = {"deepseek": {"default_model": "deepseek-chat", "models": ["deepseek-chat"], "base_url": "https://api.deepseek.com"}}',
      'def public_provider_config(): return {"providers": [], "requires_player_key": True}',
      'def resolve_llm_config(payload):',
      '    return {"provider": payload.get("llm_provider"), "model": payload.get("llm_model"), "api_key": payload.get("llm_api_key"), "base_url": payload.get("base_url")}',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(dir, 'app.py'), [
      'from flask import Flask, request, jsonify',
      'from llm_config import public_provider_config, resolve_llm_config',
      'app = Flask(__name__)',
      '@app.route("/config")',
      'def config(): return jsonify(public_provider_config())',
      '@app.route("/start", methods=["POST"])',
      'def start():',
      '    player_config = resolve_llm_config(request.get_json(silent=True) or {})',
      '    return jsonify({"game_config": player_config})',
      '@app.route("/stream/<gid>")',
      'def stream(gid): return "SSE observer timeline"',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(dir, 'game.py'), 'GAME_MODES = {"m6": {"roles": ["werewolf", "seer", "villager"]}}\nclass GameMaster:\n    def winner(self):\n        return "werewolf"  # night day vote win condition\n');
    await fs.writeFile(path.join(dir, 'player.py'), 'from openai import OpenAI\nclass Player:\n    def speak(self):\n        return "LLM agent model provider call"\n');
    await fs.writeFile(path.join(dir, 'prompts.py'), 'def build_system_prompt(): return "role secrecy guardrail invalid action"\n');
    await fs.writeFile(path.join(dir, 'templates', 'index.html'), '<script>fetch("/start", {body: JSON.stringify({llm_provider:"deepseek", llm_model:"deepseek-chat", llm_api_key:"sk"})}); new EventSource("/stream/demo");</script>\n');

    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);

    expect(gap.product_maturity?.domain).toBe('agent_social_deduction_theater');
    expect(gap.product_maturity?.missing_capabilities).not.toContain('Per-session agent model and provider configuration');
  });

  it('does not count isolated social deduction product backbone modules as market ready', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-werewolf-isolated-backbone-'));
    await fs.mkdir(path.join(dir, 'tests'), { recursive: true });
    await fs.mkdir(path.join(dir, '.github', 'workflows'), { recursive: true });
    await fs.writeFile(path.join(dir, 'README.md'), '# Werewolf Product\n\nA mature 狼人杀 social deduction product.\n' + 'x'.repeat(420));
    await fs.writeFile(path.join(dir, 'Dockerfile'), 'FROM python:3.11-slim\nCMD ["gunicorn", "wsgi:app"]\n');
    await fs.writeFile(path.join(dir, 'wsgi.py'), 'from app import app\n');
    await fs.writeFile(path.join(dir, '.github', 'workflows', 'ci.yml'), 'name: CI\njobs:\n  test:\n    steps:\n      - run: python3 -m pytest -q\n');
    await fs.writeFile(path.join(dir, 'app.py'), 'def healthz():\n    return {"status": "ok"}\n');
    await fs.writeFile(path.join(dir, 'game.py'), 'GAME_MODES = {"classic": {"roles": ["werewolf", "seer", "witch", "villager"]}}\nclass GameMaster:\n    def winner(self):\n        return "wolves"\n');
    await fs.writeFile(path.join(dir, 'rules.py'), 'def resolve_vote_result(votes):\n    return {"outcome": "vote"}\ndef winner_from_alive_roles(roles):\n    return None\n# night day alive dead kill save check guard winner werewolf seer witch villager\n');
    await fs.writeFile(path.join(dir, 'tests', 'test_rules.py'), 'from rules import resolve_vote_result\n\ndef test_rules():\n    assert resolve_vote_result({})["outcome"] == "none"\n');
    await fs.writeFile(path.join(dir, 'accounts.py'), 'class AccountStore:\n    def login(self):\n        return "session"\n# account profile password_hash session\n');
    await fs.writeFile(path.join(dir, 'lobby.py'), 'class LobbyManager:\n    pass\n# lobby room matchmaking match_queue ready_check invite party\n');
    await fs.writeFile(path.join(dir, 'communication.py'), 'class WebSocketPresenceHub:\n    pass\n# websocket voice chat presence\n');
    await fs.writeFile(path.join(dir, 'moderation.py'), 'def report_player():\n    pass\n# moderation mute block_user ban anti_abuse grief afk\n');
    await fs.writeFile(path.join(dir, 'ranking.py'), 'class RankedSeasonLeaderboard:\n    pass\n# ranked season leaderboard rating mmr elo division tier\n');
    await fs.writeFile(path.join(dir, 'history.py'), 'import sqlite3\n# database match_history replay_store\n');
    await fs.writeFile(path.join(dir, 'roles_catalog.py'), [
      'ROLE_REGISTRY = {',
      '    "werewolf": {}, "alpha_wolf": {}, "seer": {}, "witch": {},',
      '    "hunter": {}, "guard": {}, "medium": {}, "villager": {},',
      '    "cupid": {}, "thief": {}, "idiot": {}, "wolf_king": {},',
      '}',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(dir, 'liveops.py'), 'class LiveOpsStore:\n    pass\n# shop skin avatar item cosmetic currency battle pass quest reward track inventory\n');
    await fs.writeFile(path.join(dir, 'admin.py'), 'class AdminConsole:\n    pass\n# admin metrics prometheus tracing audit analytics dashboard incident rate_limit\n');
    await fs.writeFile(path.join(dir, 'host_controls.py'), 'class HostControls:\n    pass\n# custom game host controls private room room settings spectator anonymous players\n');

    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    const categories = gap.findings.map((f) => f.category);

    expect(gap.product_maturity?.level).not.toBe('market_ready');
    expect(gap.product_maturity?.missing_capabilities).toContain('Runtime integration of product systems');
    expect(gap.product_maturity?.missing_capabilities).toContain('User-facing product workflows');
    expect(gap.product_maturity?.missing_capabilities).toContain('End-to-end product workflow verification');
    expect(categories).toContain('disconnected_social_product_backbone');
    expect(categories).toContain('below_social_deduction_market_parity');
    expect(gap.score.score_gate?.failures.some((f) => f.gate === 'product_maturity')).toBe(true);
  });

  it('does not count generated product status endpoints as real social deduction workflows', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-werewolf-product-status-stubs-'));
    await fs.mkdir(path.join(dir, 'tests'), { recursive: true });
    await fs.mkdir(path.join(dir, '.github', 'workflows'), { recursive: true });
    await fs.writeFile(path.join(dir, 'README.md'), '# Werewolf Product\n\nA mature 狼人杀 social deduction product.\n' + 'x'.repeat(420));
    await fs.writeFile(path.join(dir, 'Dockerfile'), 'FROM python:3.11-slim\nCMD ["gunicorn", "wsgi:app"]\n');
    await fs.writeFile(path.join(dir, 'wsgi.py'), 'from app import app\n');
    await fs.writeFile(path.join(dir, '.github', 'workflows', 'ci.yml'), 'name: CI\njobs:\n  test:\n    steps:\n      - run: python3 -m pytest -q\n');
    await fs.writeFile(path.join(dir, 'game.py'), 'from rules import validate_game_modes\nGAME_MODES = {"classic": {"roles": ["werewolf", "seer", "witch", "villager"]}}\nvalidate_game_modes(GAME_MODES)\nclass GameMaster:\n    def winner(self):\n        return "wolves"\n');
    await fs.writeFile(path.join(dir, 'rules.py'), [
      'def role_distribution(roles): return {role: roles.count(role) for role in roles}',
      'def validate_mode_config(mode_id, roles): return {"ok": True, "role_distribution": role_distribution(roles)}',
      'def validate_game_modes(modes): return {"ok": True, "modes": modes}',
      'def resolve_vote_result(votes): return {"outcome": "vote"}',
      'def winner_from_alive_roles(roles): return None',
      '# night day alive dead kill save check guard winner werewolf seer witch villager',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(dir, 'tests', 'test_rules.py'), [
      'from rules import resolve_vote_result, validate_mode_config',
      'def test_rules(): assert resolve_vote_result({})["outcome"] == "vote"',
      'def test_mode_config_validation_rejects_wolf_majority(): assert validate_mode_config("balanced mode", ["werewolf", "villager"])["ok"]',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(dir, 'accounts.py'), 'class AccountStore:\n    pass\n# account profile login session password_hash\n');
    await fs.writeFile(path.join(dir, 'lobby.py'), 'class LobbyManager:\n    pass\n# lobby room matchmaking match_queue ready_check invite party\n');
    await fs.writeFile(path.join(dir, 'communication.py'), 'class WebSocketPresenceHub:\n    pass\n# websocket voice chat presence\n');
    await fs.writeFile(path.join(dir, 'moderation.py'), 'def report_player():\n    pass\n# moderation mute block_user ban anti_abuse grief afk\n');
    await fs.writeFile(path.join(dir, 'ranking.py'), 'class RankedSeasonLeaderboard:\n    pass\n# ranked season leaderboard rating mmr elo division tier\n');
    await fs.writeFile(path.join(dir, 'history.py'), 'import sqlite3\n# database match_history replay_store\n');
    await fs.writeFile(path.join(dir, 'roles_catalog.py'), [
      'ROLE_REGISTRY = {',
      '    "werewolf": {}, "alpha_wolf": {}, "seer": {}, "witch": {},',
      '    "hunter": {}, "guard": {}, "medium": {}, "villager": {},',
      '    "cupid": {}, "thief": {}, "idiot": {}, "wolf_king": {},',
      '}',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(dir, 'liveops.py'), 'class LiveOpsStore:\n    pass\n# shop skin avatar item cosmetic currency battle pass quest reward track inventory\n');
    await fs.writeFile(path.join(dir, 'admin.py'), 'class AdminConsole:\n    pass\n# admin metrics prometheus tracing audit analytics dashboard incident rate_limit\n');
    await fs.writeFile(path.join(dir, 'host_controls.py'), 'class HostControls:\n    pass\n# custom game host controls private room room settings spectator anonymous players\n');
    await fs.writeFile(path.join(dir, 'app.py'), [
      'from flask import Flask, jsonify',
      'from accounts import AccountStore',
      'from lobby import LobbyManager',
      'from communication import WebSocketPresenceHub',
      'from moderation import report_player',
      'from ranking import RankedSeasonLeaderboard',
      'from history import sqlite3',
      'from roles_catalog import ROLE_REGISTRY',
      'from liveops import LiveOpsStore',
      'from admin import AdminConsole',
      'from host_controls import HostControls',
      'app = Flask(__name__)',
      'accounts = AccountStore(); lobby = LobbyManager(); hub = WebSocketPresenceHub(); ranked = RankedSeasonLeaderboard(); liveops = LiveOpsStore(); admin = AdminConsole(); hosts = HostControls()',
      '@app.route("/healthz")',
      'def healthz(): return jsonify({"status": "ok"})',
      'def _d2p_product_status(name, enabled=True, **extra):',
      '    payload = {"workflow": name, "enabled": bool(enabled)}',
      '    payload.update(extra)',
      '    return jsonify(payload)',
      '@app.route("/product/profile")',
      'def product_profile(): return _d2p_product_status("account_profile", True, profile={"id": "demo_player"})',
      '@app.route("/product/lobby", methods=["POST"])',
      'def product_lobby(): return _d2p_product_status("lobby_room_matchmaking", True, room={"id": "demo_room"})',
      '@app.route("/product/chat/presence")',
      'def product_presence(): return _d2p_product_status("websocket_chat_voice_presence", True, presence=["demo_player"])',
      '@app.route("/product/moderation/report", methods=["POST"])',
      'def product_moderation(): return _d2p_product_status("moderation_report_block_mute", True, report={"status": "open"})',
      '@app.route("/product/ranked/leaderboard")',
      'def product_ranked(): return _d2p_product_status("ranked_season_leaderboard", True, leaderboard=[["demo_player", 1000]])',
      '@app.route("/product/history/replay")',
      'def product_history(): return _d2p_product_status("match_history_replay_store", True, replay=[{"phase": "night"}])',
      '@app.route("/product/roles/catalog")',
      'def product_roles(): return _d2p_product_status("role_registry_mode_catalog", True, roles=list(ROLE_REGISTRY))',
      '@app.route("/product/liveops/inventory")',
      'def product_liveops(): return _d2p_product_status("liveops_shop_inventory_rewards", True, inventory={"currency": 0})',
      '@app.route("/product/admin/metrics")',
      'def product_admin(): return _d2p_product_status("admin_metrics_audit_rate_limit", True, metrics={"active_rooms": 0})',
      '@app.route("/product/host/room-settings", methods=["POST"])',
      'def product_host(): return _d2p_product_status("host_controls_private_room_settings", True, settings={"private_room": True})',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(dir, 'tests', 'test_product_integration.py'), [
      'from app import app',
      'def test_social_product_workflow_routes_are_reachable():',
      '    client = app.test_client()',
      '    assert client.get("/product/profile").status_code == 200',
      '    assert client.post("/product/lobby").status_code == 200',
      '    assert client.get("/product/chat/presence").status_code == 200',
      '    assert client.post("/product/moderation/report").status_code == 200',
      'def test_social_product_workflows_return_enabled_contracts():',
      '    client = app.test_client()',
      '    payload = client.get("/product/profile").get_json()',
      '    assert payload["workflow"] == "account_profile"',
      '    assert "enabled" in payload',
      '',
    ].join('\n'));

    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    const categories = gap.findings.map((f) => f.category);

    expect(gap.product_maturity?.level).not.toBe('market_ready');
    expect(gap.product_maturity?.score).toBeLessThanOrEqual(60);
    expect(gap.product_maturity?.missing_capabilities).toContain('User-facing product workflows');
    expect(gap.product_maturity?.missing_capabilities).toContain('End-to-end product workflow verification');
    expect(categories).toContain('below_social_deduction_market_parity');
    expect(gap.score.score_gate?.failures.some((f) => f.gate === 'product_maturity')).toBe(true);
  });

  it('counts runtime-integrated social deduction product workflows as market ready', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-werewolf-integrated-backbone-'));
    await fs.mkdir(path.join(dir, 'tests'), { recursive: true });
    await fs.mkdir(path.join(dir, 'templates'), { recursive: true });
    await fs.mkdir(path.join(dir, '.github', 'workflows'), { recursive: true });
    await fs.writeFile(path.join(dir, 'README.md'), '# Werewolf Product\n\nA mature 狼人杀 social deduction product.\n' + 'x'.repeat(420));
    await fs.writeFile(path.join(dir, 'Dockerfile'), 'FROM python:3.11-slim\nCMD ["gunicorn", "wsgi:app"]\n');
    await fs.writeFile(path.join(dir, 'wsgi.py'), 'from app import app\n');
    await fs.writeFile(path.join(dir, '.github', 'workflows', 'ci.yml'), 'name: CI\njobs:\n  test:\n    steps:\n      - run: python3 -m pytest -q\n');
    await fs.writeFile(path.join(dir, 'game.py'), 'GAME_MODES = {"classic": {"roles": ["werewolf", "seer", "witch", "villager"]}}\nclass GameMaster:\n    def winner(self):\n        return "wolves"\n');
    await fs.writeFile(path.join(dir, 'rules.py'), 'def resolve_vote_result(votes):\n    return {"outcome": "vote"}\ndef winner_from_alive_roles(roles):\n    return None\n# night day alive dead kill save check guard winner werewolf seer witch villager\n');
    await fs.writeFile(path.join(dir, 'tests', 'test_rules.py'), 'from rules import resolve_vote_result\n\ndef test_rules():\n    assert resolve_vote_result({})["outcome"] == "vote"\n');
    await fs.writeFile(path.join(dir, 'accounts.py'), 'class AccountStore:\n    def login(self):\n        return "session"\n# account profile password_hash session\n');
    await fs.writeFile(path.join(dir, 'lobby.py'), 'class LobbyManager:\n    pass\n# lobby room matchmaking match_queue ready_check invite party\n');
    await fs.writeFile(path.join(dir, 'communication.py'), 'class WebSocketPresenceHub:\n    pass\n# websocket voice chat presence\n');
    await fs.writeFile(path.join(dir, 'moderation.py'), 'def report_player():\n    pass\n# moderation mute block_user ban anti_abuse grief afk\n');
    await fs.writeFile(path.join(dir, 'ranking.py'), 'class RankedSeasonLeaderboard:\n    pass\n# ranked season leaderboard rating mmr elo division tier\n');
    await fs.writeFile(path.join(dir, 'history.py'), 'import sqlite3\n# database match_history replay_store\n');
    await fs.writeFile(path.join(dir, 'roles_catalog.py'), [
      'ROLE_REGISTRY = {',
      '    "werewolf": {}, "alpha_wolf": {}, "seer": {}, "witch": {},',
      '    "hunter": {}, "guard": {}, "medium": {}, "villager": {},',
      '    "cupid": {}, "thief": {}, "idiot": {}, "wolf_king": {},',
      '}',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(dir, 'liveops.py'), 'class LiveOpsStore:\n    pass\n# shop skin avatar item cosmetic currency battle pass quest reward track inventory\n');
    await fs.writeFile(path.join(dir, 'admin.py'), 'class AdminConsole:\n    pass\n# admin metrics prometheus tracing audit analytics dashboard incident rate_limit\n');
    await fs.writeFile(path.join(dir, 'host_controls.py'), 'class HostControls:\n    pass\n# custom game host controls private room room settings spectator anonymous players\n');
    await fs.writeFile(path.join(dir, 'app.py'), [
      'from flask import Flask, jsonify',
      'from accounts import AccountStore',
      'from lobby import LobbyManager',
      'from communication import WebSocketPresenceHub',
      'from moderation import report_player',
      'from ranking import RankedSeasonLeaderboard',
      'from history import sqlite3',
      'from roles_catalog import ROLE_REGISTRY',
      'from liveops import LiveOpsStore',
      'from admin import AdminConsole',
      'from host_controls import HostControls',
      'app = Flask(__name__)',
      'accounts = AccountStore(); lobby = LobbyManager(); hub = WebSocketPresenceHub(); ranked = RankedSeasonLeaderboard(); liveops = LiveOpsStore(); admin = AdminConsole(); hosts = HostControls()',
      '@app.route("/healthz")',
      'def healthz(): return jsonify({"status": "ok"})',
      '@app.route("/login", methods=["POST"])',
      'def login(): return jsonify({"session": "session"})',
      '@app.route("/lobby/rooms", methods=["POST"])',
      'def create_room(): return jsonify({"room": "room"})',
      '@app.route("/chat/presence")',
      'def presence(): return jsonify({"presence": []})',
      '@app.route("/moderation/report", methods=["POST"])',
      'def report(): return jsonify({"report": "open"})',
      '@app.route("/ranked/leaderboard")',
      'def leaderboard(): return jsonify({"leaderboard": []})',
      '@app.route("/history/replay/<match_id>")',
      'def replay(match_id): return jsonify({"replay": match_id})',
      '@app.route("/roles/catalog")',
      'def roles(): return jsonify({"roles": list(ROLE_REGISTRY)})',
      '@app.route("/shop/inventory")',
      'def inventory(): return jsonify({"inventory": []})',
      '@app.route("/admin/metrics")',
      'def metrics(): return jsonify({"metrics": {}})',
      '@app.route("/host/room-settings", methods=["POST"])',
      'def host_settings(): return jsonify({"settings": {}})',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(dir, 'templates', 'index.html'), '<a href="/lobby/rooms">Lobby</a><a href="/ranked/leaderboard">Leaderboard</a><a href="/host/room-settings">Host controls</a>\n');
    await fs.writeFile(path.join(dir, 'tests', 'test_app.py'), [
      'from app import app',
      '',
      'def test_product_workflows_are_reachable_with_client():',
      '    client = app.test_client()',
      '    assert client.post("/login").status_code == 200',
      '    assert client.post("/lobby/rooms").status_code == 200',
      '    assert client.get("/ranked/leaderboard").status_code == 200',
      '    assert client.get("/history/replay/m1").status_code == 200',
      '    assert client.post("/host/room-settings").status_code == 200',
      '',
    ].join('\n'));

    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    const categories = gap.findings.map((f) => f.category);

    expect(gap.product_maturity?.level).toBe('market_ready');
    expect(gap.product_maturity?.missing_capabilities).toEqual([]);
    expect(categories).not.toContain('disconnected_social_product_backbone');
    expect(categories).not.toContain('below_social_deduction_market_parity');
  });

  it('does not apply social deduction optimization to unrelated voting games', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-voting-game-no-werewolf-'));
    await fs.mkdir(path.join(dir, 'tests'), { recursive: true });
    await fs.mkdir(path.join(dir, '.github', 'workflows'), { recursive: true });
    await fs.writeFile(path.join(dir, 'README.md'), '# Voting Game\n\nA party demo where players vote on prompts and the host resolves poll results.\n' + 'x'.repeat(420));
    await fs.writeFile(path.join(dir, 'requirements.txt'), 'pytest>=8.0.0,<9.0.0\nflask>=3.0.0,<4.0.0\n');
    await fs.writeFile(path.join(dir, 'pyproject.toml'), '[project]\nname = "voting-game"\n');
    await fs.writeFile(path.join(dir, 'Dockerfile'), 'FROM python:3.11-slim\n');
    await fs.writeFile(path.join(dir, 'wsgi.py'), 'from app import app\n');
    await fs.writeFile(path.join(dir, '.github', 'workflows', 'ci.yml'), 'name: CI\njobs:\n  test:\n    steps:\n      - run: python3 -m pytest -q\n');
    await fs.writeFile(path.join(dir, 'app.py'), [
      'from flask import Flask, jsonify',
      'app = Flask(__name__)',
      '@app.route("/healthz")',
      'def healthz():',
      '    return jsonify({"status": "ok"})',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(dir, 'game.py'), [
      'GAME_MODES = {"quick_vote": {"rounds": 3}}',
      'class GameMaster:',
      '    def __init__(self):',
      '        self.votes = []',
      '    def record_vote(self, player_id, option):',
      '        self.votes.append((player_id, option))',
      '    def winner(self):',
      '        return max((option for _, option in self.votes), default=None)',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(dir, 'tests', 'test_game.py'), [
      'from game import GameMaster',
      'def test_vote_winner_empty_poll():',
      '    assert GameMaster().winner() is None',
      '',
    ].join('\n'));

    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    const categories = gap.findings.map((f) => f.category);

    expect(categories).not.toContain('missing_social_deduction_rules_engine');
    expect(categories).not.toContain('below_social_deduction_market_parity');
    expect(gap.product_maturity).toBeUndefined();
    expect(gap.score.score_gate?.failures.some((f) => f.gate === 'product_maturity')).not.toBe(true);
  });

  it('adds source-cited market research gaps when a research report exists', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-research-gap-integration-'));
    await fs.writeFile(path.join(dir, 'README.md'), '# UI Demo\n\nA small visual demo.\n' + 'x'.repeat(240));
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({
      scripts: { build: 'node -e "console.log(1)"' },
      dependencies: { vue: '^3.0.0' },
    }));
    await fs.writeFile(path.join(dir, 'index.html'), '<div id="app"></div>\n');
    const report: MarketResearchReport = {
      schema_version: 1,
      generated_at: new Date(0).toISOString(),
      project_path: dir,
      domain: 'web_ui_app',
      query: 'production web UI competitors',
      search_provider: 'fixture',
      copy_policy: 'Use competitor material only to extract capabilities; do not copy names, text, UI, code, or brand assets.',
      sources: [{ title: 'UI benchmark', url: 'https://example.com/ui', retrieved_at: new Date(0).toISOString(), snippet: 'Responsive accessible UI.' }],
      capabilities: [{
        id: 'responsive_accessible_ui',
        label: 'Responsive and accessible UI',
        description: 'Keyboard, touch, responsive layout and semantic labels.',
        importance: 'required',
        source_urls: ['https://example.com/ui'],
        local_evidence_patterns: ['aria-', '@media', 'focus-visible'],
      }],
      risks: [],
      confidence: 'medium',
    };
    await writeMarketResearchReport(dir, report);

    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    const finding = gap.findings.find((f) => f.category === 'below_market_research_parity');

    expect(finding?.message).toContain('Responsive and accessible UI');
    expect(gap.product_maturity?.references).toContain('https://example.com/ui');
    expect(gap.score.score_gate?.failures.some((f) => f.gate === 'product_maturity')).toBe(true);
  });

  it('flags LLM web demos that require a server-wide API key instead of player-supplied provider config', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-llm-provider-config-gap-'));
    await fs.mkdir(path.join(dir, 'templates'), { recursive: true });
    await fs.mkdir(path.join(dir, 'tests'), { recursive: true });
    await fs.mkdir(path.join(dir, '.github', 'workflows'), { recursive: true });
    await fs.writeFile(path.join(dir, 'README.md'), '# LLM Game\n\nDocker gunicorn healthz provider settings.\n' + 'x'.repeat(420));
    await fs.writeFile(path.join(dir, 'requirements.txt'), 'flask>=3.0.0,<4.0.0\nopenai>=1.0.0,<2.0.0\npytest>=8.0.0,<9.0.0\ngunicorn>=22.0.0,<23.0.0\n');
    await fs.writeFile(path.join(dir, 'constraints.txt'), 'flask>=3.0.0,<4.0.0\nopenai>=1.0.0,<2.0.0\npytest>=8.0.0,<9.0.0\ngunicorn>=22.0.0,<23.0.0\n');
    await fs.writeFile(path.join(dir, 'pyproject.toml'), '[project]\nname = "llm-game"\n');
    await fs.writeFile(path.join(dir, 'Dockerfile'), 'FROM python:3.11-slim\nCMD ["gunicorn", "wsgi:app"]\n');
    await fs.writeFile(path.join(dir, 'wsgi.py'), 'from app import app\n');
    await fs.writeFile(path.join(dir, '.github', 'workflows', 'ci.yml'), 'name: CI\njobs:\n  test:\n    steps:\n      - run: python3 -m pytest -q\n');
    await fs.writeFile(path.join(dir, 'config.py'), [
      'import os',
      'def require_api_key():',
      '    if os.environ.get("DEEPSEEK_API_KEY") or os.environ.get("OPENAI_API_KEY"):',
      '        return True, ""',
      '    return False, "missing global key"',
      'def max_active_games():',
      '    return 3',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(dir, 'player.py'), [
      'import os',
      'from openai import OpenAI',
      'MODEL = os.environ.get("WW_MODEL", "deepseek-v4-flash")',
      'BASE_URL = os.environ.get("WW_BASE_URL", "https://api.deepseek.com")',
      'def make_client():',
      '    return OpenAI(api_key=os.environ.get("DEEPSEEK_API_KEY") or os.environ.get("OPENAI_API_KEY"), base_url=BASE_URL)',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(dir, 'app.py'), [
      'import queue, threading, time, uuid',
      'from flask import Flask, jsonify, request, render_template',
      'from config import require_api_key, max_active_games',
      'from player import MODEL, BASE_URL',
      'app = Flask(__name__)',
      '@app.after_request',
      'def headers(response):',
      '    response.headers.setdefault("X-Content-Type-Options", "nosniff")',
      '    response.headers.setdefault("X-Frame-Options", "DENY")',
      '    response.headers.setdefault("Referrer-Policy", "no-referrer")',
      '    return response',
      '@app.route("/")',
      'def index():',
      '    return render_template("index.html")',
      '@app.route("/healthz")',
      'def healthz():',
      '    return jsonify({"status": "ok"})',
      '@app.route("/config")',
      'def config():',
      '    return jsonify({"model": MODEL, "base_url": BASE_URL})',
      '@app.route("/start", methods=["POST"])',
      'def start():',
      '    has_key, error_msg = require_api_key()',
      '    if not has_key:',
      '        return jsonify({"error": error_msg}), 400',
      '    body = request.get_json(silent=True) or {}',
      '    mode = body.get("mode", "m6")',
      '    if mode not in {"m6"}:',
      '        return jsonify({"error": "invalid_mode"}), 400',
      '    speed = max(0.1, min(float(body.get("speed", 1.0)), 3.0))',
      '    return jsonify({"game_id": uuid.uuid4().hex[:8], "mode": mode, "speed": speed})',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(dir, 'templates', 'index.html'), [
      '<button id="start">start</button>',
      '<select id="speedSelect"><option value="1">1x</option></select>',
      '<script>',
      'document.getElementById("start").addEventListener("click", async () => {',
      '  await fetch("/start", {method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({mode:"m6", speed:1})});',
      '});',
      '</script>',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(dir, 'tests', 'test_app.py'), [
      'def test_healthz():',
      '    from app import app',
      '    app.config.update(TESTING=True)',
      '    response = app.test_client().get("/healthz")',
      '    assert response.status_code == 200',
      '',
    ].join('\n'));

    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    const categories = gap.findings.map((f) => f.category);

    expect(categories).toContain('missing_user_llm_provider_config');
  });

  it('flags LLM provider selects whose option labels cannot be populated from provider presets', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-llm-empty-provider-select-'));
    await fs.mkdir(path.join(dir, 'templates'), { recursive: true });
    await fs.writeFile(path.join(dir, 'README.md'), '# LLM Demo\n\nA browser LLM demo.\n' + 'x'.repeat(420));
    await fs.writeFile(path.join(dir, 'requirements.txt'), 'flask>=3.0.0\npytest>=8.0.0\n');
    await fs.writeFile(path.join(dir, 'app.py'), [
      'from flask import Flask, jsonify, render_template',
      'from llm_config import public_provider_config',
      'app = Flask(__name__)',
      '@app.route("/")',
      'def index():',
      '    return render_template("index.html")',
      '@app.route("/config")',
      'def config():',
      '    return jsonify(public_provider_config())',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(dir, 'llm_config.py'), [
      'def public_provider_config():',
      '    return {"providers": [',
      '        {"id": "deepseek", "name": "DeepSeek", "base_url": "https://api.deepseek.com", "models": ["deepseek-chat"]},',
      '        {"id": "openai", "name": "OpenAI", "base_url": "https://api.openai.com", "models": ["gpt-4o-mini"]},',
      '    ], "requires_player_key": True}',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(dir, 'templates', 'index.html'), [
      '<select id="llmProvider"></select>',
      '<script>',
      'async function initProviderSelect() {',
      '  const cfg = await fetch("/config").then(r => r.json());',
      '  const providerPresets = Array.isArray(cfg.providers) ? cfg.providers : [];',
      '  document.getElementById("llmProvider").innerHTML = providerPresets.map(p => `<option value="${p.id}">${p.label}</option>`).join("");',
      '}',
      '</script>',
      '',
    ].join('\n'));

    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    const categories = gap.findings.map((f) => f.category);

    expect(categories).toContain('broken_llm_provider_select_options');
  });

  it('flags LLM provider catalogs that omit common player-selectable providers', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-llm-provider-catalog-gap-'));
    await fs.mkdir(path.join(dir, 'templates'), { recursive: true });
    await fs.writeFile(path.join(dir, 'README.md'), '# LLM Demo\n\nA browser LLM demo.\n' + 'x'.repeat(420));
    await fs.writeFile(path.join(dir, 'requirements.txt'), 'flask>=3.0.0\npytest>=8.0.0\n');
    await fs.writeFile(path.join(dir, 'app.py'), 'from flask import Flask\napp = Flask(__name__)\n');
    await fs.writeFile(path.join(dir, 'llm_config.py'), [
      'def public_provider_config():',
      '    return {"providers": [',
      '        {"id": "deepseek", "label": "DeepSeek", "base_url": "https://api.deepseek.com", "default_model": "deepseek-chat"},',
      '        {"id": "openai", "label": "OpenAI", "base_url": "https://api.openai.com", "default_model": "gpt-4o-mini"},',
      '    ], "requires_player_key": True}',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(dir, 'templates', 'index.html'), '<select id="llmProvider"></select>\n');

    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    const categories = gap.findings.map((f) => f.category);

    expect(categories).toContain('incomplete_llm_provider_catalog');
  });

  it('flags LLM provider catalogs that are not backed by official model choices', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-llm-official-model-catalog-gap-'));
    await fs.mkdir(path.join(dir, 'templates'), { recursive: true });
    await fs.writeFile(path.join(dir, 'README.md'), '# LLM Demo\n\nA browser LLM demo.\n' + 'x'.repeat(420));
    await fs.writeFile(path.join(dir, 'requirements.txt'), 'flask>=3.0.0\npytest>=8.0.0\n');
    await fs.writeFile(path.join(dir, 'app.py'), 'from flask import Flask\napp = Flask(__name__)\n');
    await fs.writeFile(path.join(dir, 'llm_config.py'), [
      'def public_provider_config():',
      '    return {"providers": [',
      '        {"id": "deepseek", "label": "DeepSeek", "base_url": "https://api.deepseek.com", "default_model": "deepseek-chat"},',
      '        {"id": "minimax", "label": "MiniMax", "base_url": "https://api.minimax.io/v1", "default_model": "MiniMax-M2.7"},',
      '        {"id": "qwen", "label": "Qwen", "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1", "default_model": "qwen-plus"},',
      '        {"id": "openai", "label": "OpenAI", "base_url": "https://api.openai.com/v1", "default_model": "gpt-4o-mini"},',
      '        {"id": "custom", "label": "Custom", "base_url": "", "default_model": ""},',
      '    ], "requires_player_key": True}',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(dir, 'templates', 'index.html'), '<select id="llmProvider"></select><select id="llmModel"></select>\n');

    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    const categories = gap.findings.map((f) => f.category);

    expect(categories).toContain('llm_provider_catalog_missing_official_models');
  });

  it('flags LLM provider catalogs stale against a refreshed official model catalog', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-llm-stale-model-catalog-gap-'));
    await fs.mkdir(path.join(dir, 'templates'), { recursive: true });
    await fs.mkdir(path.join(dir, '.demo2project', 'research'), { recursive: true });
    await fs.writeFile(path.join(dir, 'README.md'), '# LLM Demo\n\nA browser LLM demo.\n' + 'x'.repeat(420));
    await fs.writeFile(path.join(dir, 'requirements.txt'), 'flask>=3.0.0\npytest>=8.0.0\n');
    await fs.writeFile(path.join(dir, 'app.py'), 'from flask import Flask\napp = Flask(__name__)\n');
    await fs.writeFile(path.join(dir, '.demo2project', 'research', 'llm-model-catalog.json'), JSON.stringify({
      schema_version: 1,
      generated_at: new Date(0).toISOString(),
      providers: [{
        id: 'openai',
        label: 'OpenAI',
        base_url: 'https://api.openai.com/v1',
        default_model: 'gpt-5.4-mini',
        models: ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini'],
        source_url: 'https://platform.openai.com/docs/models',
        source_name: 'OpenAI official model docs',
        source_kind: 'official_docs_snapshot',
        retrieved_at: new Date(0).toISOString(),
      }],
      warnings: [],
    }, null, 2));
    await fs.writeFile(path.join(dir, 'llm_config.py'), [
      'def public_provider_config():',
      '    return {"providers": [',
      '        {"id": "deepseek", "label": "DeepSeek", "base_url": "https://api.deepseek.com", "default_model": "deepseek-v4-flash", "models": ["deepseek-v4-flash"], "source_url": "https://api-docs.deepseek.com/api/list-models"},',
      '        {"id": "minimax", "label": "MiniMax", "base_url": "https://api.minimax.io/v1", "default_model": "MiniMax-M2.7", "models": ["MiniMax-M2.7"], "source_url": "https://platform.minimax.io/docs/guides/text-generation"},',
      '        {"id": "qwen", "label": "Qwen", "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1", "default_model": "qwen3.6-plus", "models": ["qwen3.6-plus"], "source_url": "https://www.alibabacloud.com/help/en/model-studio/text-generation-model"},',
      '        {"id": "openai", "label": "OpenAI", "base_url": "https://api.openai.com/v1", "default_model": "gpt-5-mini", "models": ["gpt-5-mini", "gpt-5.2"], "source_url": "https://platform.openai.com/docs/models"},',
      '        {"id": "custom", "label": "Custom", "base_url": "", "default_model": "", "models": []},',
      '    ], "requires_player_key": True}',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(dir, 'templates', 'index.html'), '<select id="llmProvider"></select><select id="llmModel"></select>\n');

    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    const categories = gap.findings.map((f) => f.category);

    expect(categories).toContain('llm_provider_catalog_outdated_against_official_refresh');
  });

  it('flags API projects without a contract/runtime harness', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-api-contract-gap-'));
    await fs.mkdir(path.join(dir, 'src'), { recursive: true });
    await fs.mkdir(path.join(dir, 'tests'), { recursive: true });
    await fs.writeFile(path.join(dir, 'README.md'), '# API Demo\n\nExpress API demo.\n' + 'x'.repeat(420));
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({
      name: 'api-demo',
      scripts: {
        test: 'node --test tests/smoke.test.mjs',
        build: 'node --check src/server.js',
      },
      dependencies: {
        express: '^5.0.0',
      },
    }, null, 2));
    await fs.writeFile(path.join(dir, 'src', 'server.js'), [
      'import express from "express";',
      'const app = express();',
      'app.get("/healthz", (_req, res) => res.json({ ok: true }));',
      'export default app;',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(dir, 'tests', 'smoke.test.mjs'), 'import test from "node:test"; test("ok", () => {});\n');

    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    expect(gap.findings.map((f) => f.category)).toContain('missing_api_contract_harness');
  });

  it('flags specialized demo surfaces without a generalized surface contract matrix', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-extension-surface-gap-'));
    await fs.mkdir(path.join(dir, 'src'), { recursive: true });
    await fs.writeFile(path.join(dir, 'README.md'), '# Extension Demo\n\nBrowser extension popup prototype.\n' + 'x'.repeat(420));
    await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify({
      manifest_version: 3,
      name: 'Extension Demo',
      version: '0.1.0',
      action: { default_popup: 'popup.html' },
    }, null, 2));
    await fs.writeFile(path.join(dir, 'popup.html'), '<button id="run">Run</button><script src="src/popup.js"></script>\n');
    await fs.writeFile(path.join(dir, 'src', 'popup.js'), 'document.getElementById("run").addEventListener("click", () => console.log("demo"));\n');

    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    const categories = gap.findings.map((f) => f.category);

    expect(categories).toContain('missing_demo_surface_contract_matrix');
  });

  it('flags specialized demo surfaces without dedicated product contract harnesses', async () => {
    const extensionDir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-extension-contract-gap-'));
    await fs.writeFile(path.join(extensionDir, 'manifest.json'), JSON.stringify({
      manifest_version: 3,
      name: 'Extension Demo',
      version: '0.1.0',
      action: { default_popup: 'popup.html' },
    }, null, 2));
    await fs.writeFile(path.join(extensionDir, 'popup.html'), '<main>Popup</main>\n');
    await fs.writeFile(path.join(extensionDir, 'README.md'), '# Extension Demo\n\n' + 'x'.repeat(420));

    const notebookDir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-notebook-contract-gap-'));
    await fs.writeFile(path.join(notebookDir, 'analysis.ipynb'), JSON.stringify({ cells: [], metadata: {}, nbformat: 4, nbformat_minor: 5 }));
    await fs.writeFile(path.join(notebookDir, 'README.md'), '# Notebook Demo\n\n' + 'x'.repeat(420));

    const mobileDir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-mobile-contract-gap-'));
    await fs.writeFile(path.join(mobileDir, 'package.json'), JSON.stringify({ dependencies: { expo: '^54.0.0' } }, null, 2));
    await fs.writeFile(path.join(mobileDir, 'app.json'), JSON.stringify({ expo: { name: 'Mobile Demo', slug: 'mobile-demo' } }, null, 2));
    await fs.writeFile(path.join(mobileDir, 'README.md'), '# Mobile Demo\n\n' + 'x'.repeat(420));

    const desktopDir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-desktop-contract-gap-'));
    await fs.writeFile(path.join(desktopDir, 'package.json'), JSON.stringify({ dependencies: { electron: '^39.0.0' } }, null, 2));
    await fs.writeFile(path.join(desktopDir, 'electron.js'), 'console.log("desktop shell");\n');
    await fs.writeFile(path.join(desktopDir, 'README.md'), '# Desktop Demo\n\n' + 'x'.repeat(420));

    const extensionCategories = (await new AnalyzerAgent().fullAnalyze(extensionDir)).gap.findings.map((f) => f.category);
    const notebookCategories = (await new AnalyzerAgent().fullAnalyze(notebookDir)).gap.findings.map((f) => f.category);
    const mobileCategories = (await new AnalyzerAgent().fullAnalyze(mobileDir)).gap.findings.map((f) => f.category);
    const desktopCategories = (await new AnalyzerAgent().fullAnalyze(desktopDir)).gap.findings.map((f) => f.category);

    expect(extensionCategories).toContain('missing_browser_extension_contract_harness');
    expect(notebookCategories).toContain('missing_notebook_contract_harness');
    expect(mobileCategories).toContain('missing_mobile_contract_harness');
    expect(desktopCategories).toContain('missing_desktop_contract_harness');
  });

  it('flags game, 3D, ML and media demos without dedicated product contract harnesses', async () => {
    const gameDir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-game-contract-gap-'));
    await fs.mkdir(path.join(gameDir, 'src'), { recursive: true });
    await fs.writeFile(path.join(gameDir, 'package.json'), JSON.stringify({ dependencies: { phaser: '^3.90.0' } }, null, 2));
    await fs.writeFile(path.join(gameDir, 'src', 'game.js'), 'const game = new Phaser.Game({ scene: {} });\n');
    await fs.writeFile(path.join(gameDir, 'README.md'), '# Game Demo\n\n' + 'x'.repeat(420));

    const sceneDir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-3d-contract-gap-'));
    await fs.mkdir(path.join(sceneDir, 'src'), { recursive: true });
    await fs.writeFile(path.join(sceneDir, 'package.json'), JSON.stringify({ dependencies: { three: '^0.180.0' } }, null, 2));
    await fs.writeFile(path.join(sceneDir, 'src', 'scene.js'), 'const renderer = new THREE.WebGLRenderer();\n');
    await fs.writeFile(path.join(sceneDir, 'README.md'), '# 3D Demo\n\n' + 'x'.repeat(420));

    const mlDir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-ml-contract-gap-'));
    await fs.writeFile(path.join(mlDir, 'package.json'), JSON.stringify({ dependencies: { 'onnxruntime-web': '^1.23.0' } }, null, 2));
    await fs.writeFile(path.join(mlDir, 'model.onnx'), 'placeholder model bytes\n');
    await fs.writeFile(path.join(mlDir, 'README.md'), '# ML Demo\n\n' + 'x'.repeat(420));

    const mediaDir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-media-contract-gap-'));
    await fs.mkdir(path.join(mediaDir, 'src'), { recursive: true });
    await fs.writeFile(path.join(mediaDir, 'package.json'), JSON.stringify({ dependencies: { sharp: '^0.34.0' } }, null, 2));
    await fs.writeFile(path.join(mediaDir, 'src', 'process-media.js'), 'import sharp from "sharp"; await sharp("in.png").resize(128).toFile("out.png");\n');
    await fs.writeFile(path.join(mediaDir, 'README.md'), '# Media Demo\n\n' + 'x'.repeat(420));

    const gameCategories = (await new AnalyzerAgent().fullAnalyze(gameDir)).gap.findings.map((f) => f.category);
    const sceneCategories = (await new AnalyzerAgent().fullAnalyze(sceneDir)).gap.findings.map((f) => f.category);
    const mlCategories = (await new AnalyzerAgent().fullAnalyze(mlDir)).gap.findings.map((f) => f.category);
    const mediaCategories = (await new AnalyzerAgent().fullAnalyze(mediaDir)).gap.findings.map((f) => f.category);

    expect(gameCategories).toContain('missing_game_contract_harness');
    expect(sceneCategories).toContain('missing_3d_scene_contract_harness');
    expect(mlCategories).toContain('missing_ml_model_contract_harness');
    expect(mediaCategories).toContain('missing_media_pipeline_contract_harness');
  });

  it('flags specialized product shells that have harnesses but shallow domain behavior', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-shallow-game-product-shell-'));
    await fs.mkdir(path.join(dir, 'src'), { recursive: true });
    await fs.mkdir(path.join(dir, 'tests'), { recursive: true });
    await fs.mkdir(path.join(dir, 'docs'), { recursive: true });
    await fs.mkdir(path.join(dir, 'scripts'), { recursive: true });
    await fs.mkdir(path.join(dir, '.github', 'workflows'), { recursive: true });
    await fs.writeFile(path.join(dir, 'README.md'), '# Game Product\n\n## Install\n\nnpm install\n\n## Usage\n\nnpm start\n\n' + 'This project claims to be a productized game baseline. '.repeat(12));
    await fs.writeFile(path.join(dir, '.env.example'), 'NODE_ENV=production\n');
    await fs.writeFile(path.join(dir, '.gitignore'), 'node_modules\n');
    await fs.writeFile(path.join(dir, '.github', 'workflows', 'ci.yml'), 'name: CI\njobs:\n  test:\n    steps:\n      - run: npm test\n      - run: npm run build\n');
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({
      name: 'shallow-game-product',
      type: 'module',
      scripts: {
        test: 'node --test tests/product-core.test.mjs',
        build: 'node --check src/game.js',
        start: 'vite',
        'surface:contract-check': 'node scripts/surface-contract-check.mjs',
        'game:contract-check': 'node scripts/game-contract-check.mjs',
        'product:core-check': 'node --test tests/product-core.test.mjs',
      },
      dependencies: { phaser: '^3.90.0', vite: '^6.0.0' },
    }, null, 2));
    await fs.writeFile(path.join(dir, 'index.html'), '<main id="game"></main><script type="module" src="/src/game.js"></script>\n');
    await fs.writeFile(path.join(dir, 'src', 'game.js'), [
      'const config = {',
      '  type: Phaser.AUTO,',
      '  width: 800,',
      '  height: 480,',
      '  scene: {',
      '    create() { this.add.text(20, 20, "Game demo"); }',
      '  }',
      '};',
      'new Phaser.Game(config);',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(dir, 'src', 'product-core.mjs'), 'export function createProductCore() { return { capabilities: ["game_demo"], workflows: [{ id: "game", status: "implemented" }] }; }\n');
    await fs.writeFile(path.join(dir, 'tests', 'product-core.test.mjs'), 'import test from "node:test"; import assert from "node:assert/strict"; import { createProductCore } from "../src/product-core.mjs"; test("product core", () => assert.ok(createProductCore().workflows.length));\n');
    await fs.writeFile(path.join(dir, 'docs', 'product-core.md'), '# Product Core\n\nA tiny product core exists.\n');
    await fs.writeFile(path.join(dir, 'docs', 'productization-surface-map.md'), '# Surface Map\n\n- game_demo\n');
    await fs.writeFile(path.join(dir, 'docs', 'game-contract.md'), '# Game Contract\n\nRuntime contract for Phaser.\n');
    await fs.writeFile(path.join(dir, 'scripts', 'surface-contract-check.mjs'), 'console.log(JSON.stringify({ ok: true }))\n');
    await fs.writeFile(path.join(dir, 'scripts', 'game-contract-check.mjs'), 'console.log(JSON.stringify({ ok: true }))\n');

    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    const categories = gap.findings.map((f) => f.category);

    expect(categories).toContain('specialized_surface_shallow_product');
    expect(gap.score.score_gate?.failures.some((f) => f.gate === 'gap')).toBe(true);
  });

  it('flags notebook product shells that only wrap a trivial notebook cell', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-shallow-notebook-product-shell-'));
    await fs.mkdir(path.join(dir, 'src'), { recursive: true });
    await fs.mkdir(path.join(dir, 'tests'), { recursive: true });
    await fs.mkdir(path.join(dir, 'docs'), { recursive: true });
    await fs.mkdir(path.join(dir, 'scripts'), { recursive: true });
    await fs.mkdir(path.join(dir, '.github', 'workflows'), { recursive: true });
    await fs.writeFile(path.join(dir, 'README.md'), '# Notebook Product\n\n## Usage\n\nRun `npm test`.\n\n' + 'This claims a repeatable notebook product baseline. '.repeat(12));
    await fs.writeFile(path.join(dir, '.env.example'), 'NODE_ENV=production\n');
    await fs.writeFile(path.join(dir, '.gitignore'), 'node_modules\n');
    await fs.writeFile(path.join(dir, '.github', 'workflows', 'ci.yml'), 'name: CI\njobs:\n  test:\n    steps:\n      - run: npm test\n');
    await fs.writeFile(path.join(dir, 'analysis.ipynb'), JSON.stringify({
      cells: [{ cell_type: 'code', execution_count: null, metadata: {}, outputs: [], source: ["print('demo analysis')"] }],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5,
    }, null, 2));
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({
      name: 'shallow-notebook-product',
      type: 'module',
      scripts: {
        test: 'node --test',
        build: 'node --check src/product-core.mjs',
        'surface:contract-check': 'node scripts/surface-contract-check.mjs',
        'notebook:contract-check': 'node scripts/notebook-contract-check.mjs',
        'product:core-check': 'node --test tests/product-core.test.mjs',
      },
    }, null, 2));
    await fs.writeFile(path.join(dir, 'src', 'product-core.mjs'), 'export function createProductCore() { return { capabilities: ["notebook"], workflows: [{ id: "notebook", status: "implemented" }] }; }\n');
    await fs.writeFile(path.join(dir, 'tests', 'product-core.test.mjs'), 'import test from "node:test"; import assert from "node:assert/strict"; import { createProductCore } from "../src/product-core.mjs"; test("product core", () => assert.ok(createProductCore().workflows.length));\n');
    await fs.writeFile(path.join(dir, 'tests', 'smoke.test.mjs'), 'import test from "node:test"; test("smoke", () => {});\n');
    await fs.writeFile(path.join(dir, 'docs', 'product-core.md'), '# Product Core\n');
    await fs.writeFile(path.join(dir, 'docs', 'productization-surface-map.md'), '# Surface Map\n- notebook\n');
    await fs.writeFile(path.join(dir, 'docs', 'notebook-contract.md'), '# Notebook Contract\n');
    await fs.writeFile(path.join(dir, 'scripts', 'surface-contract-check.mjs'), 'console.log(JSON.stringify({ ok: true }))\n');
    await fs.writeFile(path.join(dir, 'scripts', 'notebook-contract-check.mjs'), 'console.log(JSON.stringify({ ok: true }))\n');

    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    expect(gap.findings.map((f) => f.category)).toContain('specialized_surface_shallow_product');
  });

  it('lets the analyzer audit suppress unsupported agent misjudgments before planning', async () => {
    const snapshot = {
      project_path: '/tmp/not-cli',
      detected_language: 'python',
      detected_frameworks: [],
      package_manager: 'pip',
      test_commands: ['python3 -m pytest -q'],
      build_commands: ['python3 -m py_compile main.py'],
      start_commands: ['python3 main.py'],
      important_files: ['main.py'],
      missing_files: [],
      dependency_summary: { runtime: 0, dev: 0, has_lockfile: false },
      timestamp: new Date(0).toISOString(),
    } satisfies ProjectSnapshot;
    const audits = auditAgentMisjudgments({
      snapshot,
      files: ['main.py', 'README.md'],
      pkg: null,
      scripts: {},
      projectSurfaceText: 'print("not a cli")',
      readme: 'plain script',
      findings: [{
        id: 'gap-wrong-cli',
        category: 'missing_cli_contract_harness',
        severity: 'medium',
        message: 'CLI project lacks a contract',
        why_it_matters: '',
        suggested_fix: '',
        related_files: ['scripts/cli-contract-check.mjs'],
      }],
    });

    expect(audits).toHaveLength(1);
    expect(audits[0]?.action).toBe('suppress_finding');
    expect(audits[0]?.finding_category).toBe('missing_cli_contract_harness');
    expect(audits[0]?.reason).toContain('CLI harness finding lacked');
  });

  it('flags env-based projects without a config contract harness', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-config-contract-gap-'));
    await fs.mkdir(path.join(dir, 'src'), { recursive: true });
    await fs.mkdir(path.join(dir, 'tests'), { recursive: true });
    await fs.writeFile(path.join(dir, 'README.md'), '# Config Demo\n\nUses env vars.\n' + 'x'.repeat(420));
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({
      name: 'config-demo',
      scripts: {
        test: 'node --test tests/smoke.test.mjs',
        build: 'node --check src/app.js',
      },
    }, null, 2));
    await fs.writeFile(path.join(dir, 'src', 'app.js'), 'export const token = process.env.SERVICE_TOKEN || "";\n');
    await fs.writeFile(path.join(dir, 'tests', 'smoke.test.mjs'), 'import test from "node:test"; test("ok", () => {});\n');

    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    expect(gap.findings.map((f) => f.category)).toContain('missing_config_contract_harness');
  });

  it('flags data and worker projects without dedicated contract harnesses', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-data-worker-gap-'));
    await fs.mkdir(path.join(dir, 'src'), { recursive: true });
    await fs.mkdir(path.join(dir, 'tests'), { recursive: true });
    await fs.writeFile(path.join(dir, 'README.md'), '# Worker Data Demo\n\nUses a queue and persistence.\n' + 'x'.repeat(420));
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({
      name: 'data-worker-demo',
      scripts: {
        test: 'node --test tests/smoke.test.mjs',
        build: 'node --check src/worker.js',
      },
      dependencies: {
        bullmq: '^5.0.0',
        prisma: '^6.0.0',
      },
    }, null, 2));
    await fs.writeFile(path.join(dir, 'src', 'worker.js'), [
      'import { Queue } from "bullmq";',
      'export const queue = new Queue("jobs");',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(dir, 'tests', 'smoke.test.mjs'), 'import test from "node:test"; test("ok", () => {});\n');

    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    const categories = gap.findings.map((f) => f.category);
    expect(categories).toContain('missing_data_migration_harness');
    expect(categories).toContain('missing_worker_contract_harness');
  });

  it('flags trivial 1+1 smoke tests and entrypoints that no test exercises', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-behavioral-depth-'));
    await fs.mkdir(path.join(dir, 'src'), { recursive: true });
    await fs.mkdir(path.join(dir, 'tests'), { recursive: true });
    await fs.writeFile(path.join(dir, 'README.md'), '# Demo\n\nA single-page app.\n' + 'x'.repeat(420));
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({
      name: 'shell-only-demo',
      type: 'module',
      scripts: { test: 'node --test tests/smoke.test.mjs', build: 'tsc -p tsconfig.json' },
      dependencies: { vue: '^3.5.0' },
    }, null, 2));
    await fs.writeFile(path.join(dir, 'index.html'), '<!doctype html><div id="app"></div><script type="module" src="/src/App.vue"></script>');
    await fs.writeFile(path.join(dir, 'src', 'App.vue'), '<template><main><h1>Demo</h1><p>visible content</p></main></template>\n');
    // Trivial 1+1 smoke that never references App.vue or index.html.
    await fs.writeFile(path.join(dir, 'tests', 'smoke.test.mjs'),
      "import { test } from 'node:test';\nimport assert from 'node:assert';\ntest('sanity', () => { assert.equal(1 + 1, 2); });\n");

    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    const categories = gap.findings.map((f) => f.category);
    expect(categories).toContain('trivial_smoke_test_only');
    expect(categories).toContain('demo_entrypoint_not_exercised_by_tests');
    const entrypointFinding = gap.findings.find((f) => f.category === 'demo_entrypoint_not_exercised_by_tests');
    expect(entrypointFinding?.severity).toBe('blocker');
    expect(entrypointFinding?.related_files).toEqual(expect.arrayContaining(['index.html', 'src/App.vue']));
  });

  it('treats scaffolded product-core tests as not exercising the demo entrypoint', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-product-core-scaffold-'));
    await fs.mkdir(path.join(dir, 'src'), { recursive: true });
    await fs.mkdir(path.join(dir, 'tests'), { recursive: true });
    await fs.writeFile(path.join(dir, 'README.md'), '# Demo\n\nA single-page app.\n' + 'x'.repeat(420));
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({
      name: 'scaffold-only-demo',
      type: 'module',
      scripts: { test: 'node --test tests/product-core.test.mjs', build: 'tsc' },
      dependencies: { vue: '^3.5.0' },
    }, null, 2));
    await fs.writeFile(path.join(dir, 'index.html'), '<!doctype html><div id="app"></div>');
    await fs.writeFile(path.join(dir, 'src', 'App.vue'), '<template><main><h1>Demo</h1></main></template>\n');
    await fs.writeFile(path.join(dir, 'src', 'product-core.mjs'),
      'export function createProductCore() { return { capabilities: ["web_ui"], workflows: [] }; }\nexport function validateProductCore(core) { return { ok: !!core }; }\nexport function runWorkflow(id) { return { ok: id === "status" }; }\n');
    await fs.writeFile(path.join(dir, 'tests', 'product-core.test.mjs'),
      'import test from "node:test";\nimport assert from "node:assert/strict";\nimport { createProductCore } from "../src/product-core.mjs";\ntest("product core", () => { assert.equal(createProductCore().capabilities[0], "web_ui"); });\n');

    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    const categories = gap.findings.map((f) => f.category);
    expect(categories).toContain('trivial_smoke_test_only');
    expect(categories).toContain('demo_entrypoint_not_exercised_by_tests');
  });

  it('flags raw-SQL CRUD demos without a runtime round-trip test', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-db-crud-gap-'));
    await fs.mkdir(path.join(dir, 'tests'), { recursive: true });
    await fs.writeFile(path.join(dir, 'README.md'), '# CRUD Demo\n\n' + 'x'.repeat(420));
    await fs.writeFile(path.join(dir, 'requirements.txt'), 'flask\n');
    await fs.writeFile(path.join(dir, 'app.py'), [
      'import sqlite3',
      'from flask import Flask, jsonify, request',
      'app = Flask(__name__)',
      'with sqlite3.connect("data.db") as c:',
      '    c.execute("CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, title TEXT)")',
      '@app.post("/notes")',
      'def create():',
      '    sqlite3.connect("data.db").execute("INSERT INTO notes(title) VALUES (?)", ("x",))',
      '    return jsonify({"ok": True})',
      '',
    ].join('\n'));
    // A test exists but only checks status code; no INSERT/SELECT/DELETE round trip.
    await fs.writeFile(path.join(dir, 'tests', 'test_app.py'), [
      'def test_post(client_factory):',
      '    assert True',
      '',
    ].join('\n'));

    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    const categories = gap.findings.map((f) => f.category);
    expect(categories).toContain('missing_db_crud_runtime_tests');
    const finding = gap.findings.find((f) => f.category === 'missing_db_crud_runtime_tests');
    expect(finding?.severity).toBe('blocker');
  });

  it('flags worker demos that have no test enqueueing+draining the worker entry function', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-worker-runtime-gap-'));
    await fs.mkdir(path.join(dir, 'tests'), { recursive: true });
    await fs.writeFile(path.join(dir, 'README.md'), '# Worker Demo\n\n' + 'x'.repeat(420));
    await fs.writeFile(path.join(dir, 'requirements.txt'), 'pytest>=8\n');
    await fs.writeFile(path.join(dir, 'worker.py'), [
      'import os',
      'QUEUE_PATH = os.environ.get("QUEUE_PATH", "q.jsonl")',
      'def drain_once():',
      '    return 0',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(dir, 'tests', 'test_smoke.py'), 'def test_a(): assert True\n');

    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    const categories = gap.findings.map((f) => f.category);
    expect(categories).toContain('missing_worker_runtime_enqueue_test');
    expect(gap.findings.find((f) => f.category === 'missing_worker_runtime_enqueue_test')?.severity).toBe('high');
  });

  it('clears the worker runtime gap once a test imports the worker and calls drain_once', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-worker-runtime-clear-'));
    await fs.mkdir(path.join(dir, 'tests'), { recursive: true });
    await fs.writeFile(path.join(dir, 'README.md'), '# Worker Demo\n\n' + 'x'.repeat(420));
    await fs.writeFile(path.join(dir, 'requirements.txt'), 'pytest>=8\n');
    await fs.writeFile(path.join(dir, 'worker.py'), 'def drain_once():\n    return 0\n');
    await fs.writeFile(path.join(dir, 'tests', 'test_worker.py'), [
      'def test_drain():',
      '    import worker',
      '    assert worker.drain_once() == 0',
      '',
    ].join('\n'));

    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    expect(gap.findings.map((f) => f.category)).not.toContain('missing_worker_runtime_enqueue_test');
  });

  it('flags projects that read env vars but have no test setting env before importing the config module', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-config-runtime-gap-'));
    await fs.mkdir(path.join(dir, 'tests'), { recursive: true });
    await fs.writeFile(path.join(dir, 'README.md'), '# Config Demo\n\n' + 'x'.repeat(420));
    await fs.writeFile(path.join(dir, 'requirements.txt'), 'pytest>=8\n');
    await fs.writeFile(path.join(dir, 'app.py'), [
      'import os',
      'SECRET_KEY = os.environ.get("SECRET_KEY", "")',
      'DATABASE_URL = os.environ["DATABASE_URL"]',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(dir, 'tests', 'test_smoke.py'), 'def test_a(): assert True\n');

    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    const categories = gap.findings.map((f) => f.category);
    expect(categories).toContain('missing_config_runtime_load_test');
    expect(gap.findings.find((f) => f.category === 'missing_config_runtime_load_test')?.severity).toBe('high');
  });

  it('clears the config runtime gap once a test sets env vars before importing the module', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-config-runtime-clear-'));
    await fs.mkdir(path.join(dir, 'tests'), { recursive: true });
    await fs.writeFile(path.join(dir, 'README.md'), '# Config Demo\n\n' + 'x'.repeat(420));
    await fs.writeFile(path.join(dir, 'requirements.txt'), 'pytest>=8\n');
    await fs.writeFile(path.join(dir, 'app.py'), 'import os\nSECRET_KEY = os.environ.get("SECRET_KEY", "")\n');
    await fs.writeFile(path.join(dir, 'tests', 'test_config.py'), [
      'def test_loads(monkeypatch):',
      '    monkeypatch.setenv("SECRET_KEY", "dummy")',
      '    import app',
      '    assert app.SECRET_KEY == "dummy"',
      '',
    ].join('\n'));

    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    expect(gap.findings.map((f) => f.category)).not.toContain('missing_config_runtime_load_test');
  });

  it('flags API demos that have no test invoking any route through a test client', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-api-runtime-gap-'));
    await fs.mkdir(path.join(dir, 'tests'), { recursive: true });
    await fs.writeFile(path.join(dir, 'README.md'), '# API Demo\n\n' + 'x'.repeat(420));
    await fs.writeFile(path.join(dir, 'requirements.txt'), 'flask\n');
    await fs.writeFile(path.join(dir, 'app.py'), [
      'from flask import Flask, jsonify, request',
      'app = Flask(__name__)',
      '@app.post("/summarize")',
      'def summarize():',
      '    text = (request.get_json(silent=True) or {}).get("text", "")',
      '    return jsonify({"summary": text[:20]})',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(dir, 'tests', 'test_smoke.py'), [
      'def test_imports_ok():',
      '    import app',
      '    assert app.app is not None',
      '',
    ].join('\n'));

    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    const categories = gap.findings.map((f) => f.category);
    expect(categories).toContain('missing_api_runtime_behaviour_test');
    expect(gap.findings.find((f) => f.category === 'missing_api_runtime_behaviour_test')?.severity).toBe('blocker');
  });

  it('clears the API runtime behaviour gap once a test invokes a route via test_client', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-api-runtime-clear-'));
    await fs.mkdir(path.join(dir, 'tests'), { recursive: true });
    await fs.writeFile(path.join(dir, 'README.md'), '# API Demo\n\n' + 'x'.repeat(420));
    await fs.writeFile(path.join(dir, 'requirements.txt'), 'flask\n');
    await fs.writeFile(path.join(dir, 'app.py'), [
      'from flask import Flask, jsonify',
      'app = Flask(__name__)',
      '@app.get("/health")',
      'def health(): return jsonify({"ok": True})',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(dir, 'tests', 'test_api.py'), [
      'def test_health():',
      '    import app',
      '    client = app.app.test_client()',
      '    response = client.get("/health")',
      '    assert response.status_code == 200',
      '',
    ].join('\n'));

    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    const categories = gap.findings.map((f) => f.category);
    expect(categories).not.toContain('missing_api_runtime_behaviour_test');
  });

  it('flags multi-service repos without a cross-service integration check', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-multi-service-gap-'));
    await fs.mkdir(path.join(dir, 'api'), { recursive: true });
    await fs.mkdir(path.join(dir, 'worker'), { recursive: true });
    await fs.mkdir(path.join(dir, 'web'), { recursive: true });
    await fs.writeFile(path.join(dir, 'README.md'), '# Multi-service demo\n\n' + 'x'.repeat(420));
    await fs.writeFile(path.join(dir, 'api', 'app.py'), 'from flask import Flask\napp = Flask(__name__)\n@app.post("/jobs")\ndef j(): return {}\n');
    await fs.writeFile(path.join(dir, 'worker', 'worker.py'), 'def drain_once():\n    return 0\n');
    await fs.writeFile(path.join(dir, 'web', 'index.html'), '<!doctype html><div id="app">Demo</div>');

    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    const categories = gap.findings.map((f) => f.category);
    expect(categories).toContain('missing_multi_service_integration_check');
    expect(gap.findings.find((f) => f.category === 'missing_multi_service_integration_check')?.severity).toBe('blocker');
  });

  it('accepts smoke tests that read the demo entrypoint file content', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-entrypoint-aware-smoke-'));
    await fs.mkdir(path.join(dir, 'src'), { recursive: true });
    await fs.mkdir(path.join(dir, 'tests'), { recursive: true });
    await fs.writeFile(path.join(dir, 'README.md'), '# Demo\n\nA single-page app.\n' + 'x'.repeat(420));
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({
      name: 'entrypoint-aware-demo',
      type: 'module',
      scripts: { test: 'node --test tests/smoke.test.mjs', build: 'tsc' },
      dependencies: { vue: '^3.5.0' },
    }, null, 2));
    await fs.writeFile(path.join(dir, 'index.html'), '<!doctype html><div id="app"></div><script type="module" src="/src/App.vue"></script>');
    await fs.writeFile(path.join(dir, 'src', 'App.vue'), '<template><main><h1>Demo</h1></main></template>\n');
    await fs.writeFile(path.join(dir, 'tests', 'smoke.test.mjs', ),
      [
        "import { test } from 'node:test';",
        "import assert from 'node:assert/strict';",
        "import fs from 'node:fs';",
        "import path from 'node:path';",
        "import { fileURLToPath } from 'node:url';",
        "const here = path.dirname(fileURLToPath(import.meta.url));",
        "const root = path.resolve(here, '..');",
        "test('App.vue is a real component', () => {",
        "  const src = fs.readFileSync(path.join(root, 'src/App.vue'), 'utf8');",
        "  assert.match(src, /<template/);",
        "});",
        '',
      ].join('\n'));

    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    const categories = gap.findings.map((f) => f.category);
    expect(categories).not.toContain('trivial_smoke_test_only');
    expect(categories).not.toContain('demo_entrypoint_not_exercised_by_tests');
  });

  // --- Specialized surface runtime gates ---------------------------------

  it('flags ML demos without a test that loads or runs the model artifact', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-ml-runtime-gap-'));
    await fs.writeFile(path.join(dir, 'README.md'), '# ML Demo\n\n' + 'x'.repeat(420));
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'ml-stub', type: 'module', dependencies: { 'onnxruntime-web': '^1.23.0' } }));
    await fs.writeFile(path.join(dir, 'model.onnx'), Buffer.from('\x08\x07placeholder content'));
    await fs.writeFile(path.join(dir, 'inference.js'), 'await import("onnxruntime-web");\n');
    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    expect(gap.findings.map((f) => f.category)).toContain('missing_ml_model_runtime_inference_test');
  });

  it('clears the ML runtime gap once a test references onnxruntime / InferenceSession', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-ml-runtime-clear-'));
    await fs.mkdir(path.join(dir, 'tests'), { recursive: true });
    await fs.writeFile(path.join(dir, 'README.md'), '# ML Demo\n\n' + 'x'.repeat(420));
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'ml-stub', type: 'module', dependencies: { 'onnxruntime-web': '^1.23.0' } }));
    await fs.writeFile(path.join(dir, 'model.onnx'), Buffer.from('\x08\x07placeholder content'));
    await fs.writeFile(path.join(dir, 'inference.js'), 'await import("onnxruntime-web");\n');
    await fs.writeFile(path.join(dir, 'tests', 'ml-runtime.test.mjs'),
      "import test from 'node:test';\ntest('ml', async () => { await import('onnxruntime-node'); });\n");
    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    expect(gap.findings.map((f) => f.category)).not.toContain('missing_ml_model_runtime_inference_test');
  });

  it('flags game demos without a test referencing Phaser or pygame', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-game-runtime-gap-'));
    await fs.writeFile(path.join(dir, 'README.md'), '# Game Demo\n\n' + 'x'.repeat(420));
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'game-stub', type: 'module', dependencies: { phaser: '^3.90.0' } }));
    await fs.mkdir(path.join(dir, 'src'), { recursive: true });
    await fs.writeFile(path.join(dir, 'src', 'index.js'), 'import Phaser from "phaser";\nnew Phaser.Game({ type: Phaser.AUTO });\n');
    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    expect(gap.findings.map((f) => f.category)).toContain('missing_game_runtime_loop_test');
  });

  it('flags 3D demos without a test using THREE / WebGL', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-3d-runtime-gap-'));
    await fs.writeFile(path.join(dir, 'README.md'), '# 3D Demo\n\n' + 'x'.repeat(420));
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: '3d-stub', type: 'module', dependencies: { three: '^0.170.0' } }));
    await fs.mkdir(path.join(dir, 'src'), { recursive: true });
    await fs.writeFile(path.join(dir, 'src', 'scene.js'), 'import * as THREE from "three";\nconst scene = new THREE.Scene();\n');
    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    expect(gap.findings.map((f) => f.category)).toContain('missing_3d_scene_runtime_render_test');
  });

  it('flags browser extension demos without a manifest validation test', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-ext-runtime-gap-'));
    await fs.writeFile(path.join(dir, 'README.md'), '# Extension Demo\n\n' + 'x'.repeat(420));
    await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'stub', version: '0.1.0' }));
    await fs.writeFile(path.join(dir, 'background.js'), 'chrome.runtime.onMessage.addListener(() => {});\n');
    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    expect(gap.findings.map((f) => f.category)).toContain('missing_browser_extension_runtime_manifest_test');
  });

  it('flags mobile demos without a bundle / app.json runtime test', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-mobile-runtime-gap-'));
    await fs.writeFile(path.join(dir, 'README.md'), '# Mobile Demo\n\n' + 'x'.repeat(420));
    await fs.writeFile(path.join(dir, 'app.json'), JSON.stringify({ expo: { name: 'X', slug: 'x' } }));
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'mobile-stub', dependencies: { expo: '^54.0.0', 'react-native': '^0.81.0' } }));
    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    expect(gap.findings.map((f) => f.category)).toContain('missing_mobile_runtime_bundle_test');
  });

  it('flags desktop demos without an electron / tauri runtime test', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-desktop-runtime-gap-'));
    await fs.writeFile(path.join(dir, 'README.md'), '# Desktop Demo\n\n' + 'x'.repeat(420));
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'desktop-stub', dependencies: { electron: '^33.0.0' } }));
    await fs.writeFile(path.join(dir, 'electron.js'), 'import { app, BrowserWindow } from "electron";\napp.whenReady().then(() => new BrowserWindow({}));\n');
    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    expect(gap.findings.map((f) => f.category)).toContain('missing_desktop_runtime_boot_test');
  });

  // --- LLM chat-style productization gates -------------------------------
  // These four detectors gate the LLM chat suite. Each one has a missing-case
  // (gate fires) and a satisfied-case (gate clears) so the implementation
  // contract is locked down and false positives on non-chat LLM demos remain
  // suppressed.

  async function scaffoldLlmChatDemo(dir: string): Promise<void> {
    await fs.writeFile(path.join(dir, 'README.md'), '# LLM Chat Demo\n\n' + 'x'.repeat(420));
    await fs.writeFile(
      path.join(dir, 'requirements.txt'),
      'flask>=3.0\nopenai>=1.0\npytest>=8.0\n',
    );
    await fs.writeFile(
      path.join(dir, 'app.py'),
      [
        'import os',
        'from flask import Flask, jsonify, request',
        'from openai import OpenAI',
        '',
        'app = Flask(__name__)',
        'client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))',
        '',
        '@app.post("/chat")',
        'def chat():',
        '    body = request.get_json(silent=True) or {}',
        '    message = body.get("message", "")',
        '    response = client.chat.completions.create(',
        '        model="gpt-4o-mini",',
        '        messages=[{"role": "user", "content": message}],',
        '    )',
        '    return jsonify({"reply": response.choices[0].message.content})',
        '',
      ].join('\n'),
    );
  }

  it('flags LLM chat demos without a prompt eval harness', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-llm-eval-gap-'));
    await scaffoldLlmChatDemo(dir);
    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    expect(gap.findings.map((f) => f.category)).toContain('missing_llm_prompt_eval_harness');
  });

  it('clears the prompt-eval gate once tests/prompts fixtures + iterating harness exist', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-llm-eval-clear-'));
    await scaffoldLlmChatDemo(dir);
    await fs.mkdir(path.join(dir, 'tests', 'prompts'), { recursive: true });
    await fs.writeFile(
      path.join(dir, 'tests', 'prompts', 'intro.json'),
      JSON.stringify({ input: 'hi', expected_keys: ['reply'] }),
    );
    await fs.writeFile(
      path.join(dir, 'tests', 'test_prompt_eval.py'),
      [
        'import json, pathlib',
        'def test_prompts_iterate():',
        '    cases = list(pathlib.Path("tests/prompts").glob("*.json"))',
        '    for c in cases:',
        '        data = json.loads(c.read_text())',
        '        assert "input" in data',
        '',
      ].join('\n'),
    );
    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    expect(gap.findings.map((f) => f.category)).not.toContain('missing_llm_prompt_eval_harness');
  });

  it('flags LLM chat demos without a provider-failure fallback test', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-llm-fallback-gap-'));
    await scaffoldLlmChatDemo(dir);
    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    expect(gap.findings.map((f) => f.category)).toContain('missing_llm_provider_failure_fallback');
  });

  it('clears the provider-fallback gate when a test patches the client to raise and asserts a graceful 5xx', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-llm-fallback-clear-'));
    await scaffoldLlmChatDemo(dir);
    await fs.mkdir(path.join(dir, 'tests'), { recursive: true });
    await fs.writeFile(
      path.join(dir, 'tests', 'test_provider_fallback.py'),
      [
        'from unittest.mock import patch, Mock',
        'from app import app',
        '',
        'def test_provider_failure_returns_graceful_status():',
        '    fake = Mock()',
        '    fake.chat.completions.create = Mock(side_effect=RuntimeError("provider down"))',
        '    with patch("app.OpenAI", return_value=fake):',
        '        client = app.test_client()',
        '        r = client.post("/chat", json={"message": "x"})',
        '        assert r.status_code in (502, 503, 504, 429)',
        '',
      ].join('\n'),
    );
    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    expect(gap.findings.map((f) => f.category)).not.toContain('missing_llm_provider_failure_fallback');
  });

  it('flags LLM chat demos without a token / input-size budget enforcement', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-llm-token-gap-'));
    await scaffoldLlmChatDemo(dir);
    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    expect(gap.findings.map((f) => f.category)).toContain('missing_llm_token_budget_enforcement');
  });

  it('clears the token-budget gate when source declares MAX_MESSAGE_LENGTH or the test sends oversized input and asserts 4xx', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-llm-token-clear-'));
    await scaffoldLlmChatDemo(dir);
    await fs.mkdir(path.join(dir, 'tests'), { recursive: true });
    await fs.writeFile(
      path.join(dir, 'tests', 'test_token_budget.py'),
      [
        'from app import app',
        '',
        'def test_oversized_message_is_rejected():',
        '    client = app.test_client()',
        '    huge = "x" * 50000',
        '    r = client.post("/chat", json={"message": huge})',
        '    assert r.status_code in (400, 413, 422)',
        '',
      ].join('\n'),
    );
    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    expect(gap.findings.map((f) => f.category)).not.toContain('missing_llm_token_budget_enforcement');
  });

  it('flags LLM chat demos without a prompt template registry', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-llm-registry-gap-'));
    await scaffoldLlmChatDemo(dir);
    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    expect(gap.findings.map((f) => f.category)).toContain('missing_llm_prompt_template_registry');
  });

  it('clears the template-registry gate when prompts.py registry exists and source loads from it', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-llm-registry-clear-'));
    await scaffoldLlmChatDemo(dir);
    await fs.mkdir(path.join(dir, 'prompts'), { recursive: true });
    await fs.writeFile(path.join(dir, 'prompts', 'chat_system.txt'), 'You are a helpful assistant.\n');
    await fs.writeFile(
      path.join(dir, 'prompts.py'),
      'from pathlib import Path\nPROMPT_TEMPLATES = {p.stem: p.read_text() for p in Path("prompts").glob("*.txt")}\n'
      + 'def load_prompt(name): return PROMPT_TEMPLATES[name]\n',
    );
    // Source must reference the registry by name.
    await fs.writeFile(
      path.join(dir, 'app.py'),
      (await fs.readFile(path.join(dir, 'app.py'), 'utf8'))
        .replace('from openai import OpenAI', 'from openai import OpenAI\nfrom prompts import load_prompt'),
    );
    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    expect(gap.findings.map((f) => f.category)).not.toContain('missing_llm_prompt_template_registry');
  });

  it('flags LLM chat demos without a streaming response surface', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-llm-stream-gap-'));
    await scaffoldLlmChatDemo(dir);
    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    expect(gap.findings.map((f) => f.category)).toContain('missing_llm_streaming_response');
  });

  it('clears the streaming gate when a streaming.py module declares SSE + stream=True LLM call', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-llm-stream-clear-'));
    await scaffoldLlmChatDemo(dir);
    await fs.writeFile(
      path.join(dir, 'streaming.py'),
      [
        'from flask import Response',
        'def chat_stream(client, message):',
        '    stream = client.chat.completions.create(model="gpt-4o-mini",',
        '        messages=[{"role": "user", "content": message}], stream=True)',
        '    def gen():',
        '        for chunk in stream: yield f"data: {chunk}\\n\\n"',
        '    return Response(gen(), mimetype="text/event-stream")',
        '',
      ].join('\n'),
    );
    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    expect(gap.findings.map((f) => f.category)).not.toContain('missing_llm_streaming_response');
  });

  it('flags Flask API demos without a structured error envelope', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-api-envelope-gap-'));
    await fs.writeFile(path.join(dir, 'README.md'), '# Api Demo\n\n' + 'x'.repeat(420));
    await fs.writeFile(path.join(dir, 'requirements.txt'), 'flask>=3.0\npytest>=8.0\n');
    await fs.writeFile(
      path.join(dir, 'app.py'),
      [
        'from flask import Flask, jsonify',
        'app = Flask(__name__)',
        '@app.get("/health")',
        'def health(): return jsonify({"ok": True})',
        '',
      ].join('\n'),
    );
    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    expect(gap.findings.map((f) => f.category)).toContain('missing_api_error_envelope');
  });

  it('clears the error-envelope gate when @app.errorhandler is registered', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-api-envelope-clear-'));
    await fs.writeFile(path.join(dir, 'README.md'), '# Api Demo\n\n' + 'x'.repeat(420));
    await fs.writeFile(path.join(dir, 'requirements.txt'), 'flask>=3.0\npytest>=8.0\n');
    await fs.writeFile(
      path.join(dir, 'app.py'),
      [
        'from flask import Flask, jsonify',
        'app = Flask(__name__)',
        '@app.get("/health")',
        'def health(): return jsonify({"ok": True})',
        '@app.errorhandler(Exception)',
        'def err(exc): return jsonify({"error": type(exc).__name__, "message": str(exc), "status": 500}), 500',
        '',
      ].join('\n'),
    );
    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    expect(gap.findings.map((f) => f.category)).not.toContain('missing_api_error_envelope');
  });

  it('suppresses LLM chat-style findings for an LLM-backed simulation server that has no chat route', async () => {
    // Servers that use the LLM as an internal agent (e.g. background game loops)
    // legitimately have no /chat-style HTTP surface. The four chat gates should
    // not fire — the relevant gates for these servers are background-task /
    // observability ones, not prompt-eval harnesses.
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-llm-sim-no-chat-'));
    await fs.writeFile(path.join(dir, 'README.md'), '# Sim Server\n\n' + 'x'.repeat(420));
    await fs.writeFile(path.join(dir, 'requirements.txt'), 'flask>=3.0\nopenai>=1.0\npytest>=8.0\n');
    await fs.writeFile(
      path.join(dir, 'app.py'),
      [
        'import os, threading',
        'from flask import Flask, jsonify',
        'from openai import OpenAI',
        '',
        'app = Flask(__name__)',
        'client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))',
        '',
        '@app.post("/start")',
        'def start():',
        '    def loop():',
        '        client.chat.completions.create(model="gpt-4o-mini", messages=[])',
        '    threading.Thread(target=loop, daemon=True).start()',
        '    return jsonify({"started": True})',
        '',
      ].join('\n'),
    );
    const { gap } = await new AnalyzerAgent().fullAnalyze(dir);
    const cats = gap.findings.map((f) => f.category);
    expect(cats).not.toContain('missing_llm_prompt_eval_harness');
    expect(cats).not.toContain('missing_llm_provider_failure_fallback');
    expect(cats).not.toContain('missing_llm_token_budget_enforcement');
    expect(cats).not.toContain('missing_llm_prompt_template_registry');
    expect(cats).not.toContain('missing_llm_streaming_response');
  });
});
