import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCommand } from '../src/core/commandRunner.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

describe('MatrixOmnix site', () => {
  it('ships a Vite/Vue app with About, Service and Contact routes and verifier framing', async () => {
    const result = await runCommand('node scripts/site-check.mjs', {
      cwd: root,
      timeoutMs: 20_000,
    });
    expect(result.passed).toBe(true);

    const app = await fs.readFile(path.join(root, 'site', 'src', 'App.vue'), 'utf8');
    expect(app).toContain('verifier for demo-to-product');
    expect(app).toContain('data-service-guide');
    expect(app).toMatch(/pnpm matrixomnix (analyze|gap|archetype) --project \.\/[\w-]+/);
    expect(app).toContain('v-if="page === \'home\'" class="cursor-capture"');
    expect(app).toContain('v-if="page === \'home\'" class="cursor-core"');
    // Verifier never accepts uploads — these data attributes must not appear.
    expect(app).not.toContain('data-return-format="zip"');
    expect(app).not.toContain('data-demo-upload');
    expect(app).not.toContain('type="file"');
    expect(app).not.toContain('Receive a product zip');
    expect(app).toMatch(/framework-loop\.(svg|png|webp|jpg)/);
    expect(app).toMatch(/harness-map\.(svg|png|webp|jpg)/);
    expect(app).toMatch(/deployment-flow\.(svg|png|webp|jpg)/);
    expect(app).toContain('Why it exists');
    expect(app).toContain('https://github.com/Hosico02/demo2project');
    expect(app).toContain('requestAnimationFrame');
    expect(app).toContain('onTouchstart');
  });
});
