import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCommand } from '../src/core/commandRunner.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

describe('MatrixOmnix site', () => {
  it('ships a Vite/Vue app with About, Service and Contact routes plus beta usage guidance', async () => {
    const result = await runCommand('node scripts/site-check.mjs', {
      cwd: root,
      timeoutMs: 20_000,
    });
    expect(result.passed).toBe(true);

    const app = await fs.readFile(path.join(root, 'site', 'src', 'App.vue'), 'utf8');
    expect(app).toContain('currently in beta');
    expect(app).toContain('data-service-guide');
    expect(app).toContain('Beta workflow');
    expect(app).toContain('pnpm matrixomnix analyze --project ./demo');
    expect(app).toContain('v-if="page === \'home\'" class="cursor-capture"');
    expect(app).toContain('v-if="page === \'home\'" class="cursor-core"');
    expect(app).not.toContain('data-return-format="zip"');
    expect(app).not.toContain('data-demo-upload');
    expect(app).not.toContain('type="file"');
    expect(app).not.toContain('Receive a product zip');
    // Diagram filenames must still appear in App.vue. Format-agnostic (svg or png)
    // because we render the same three concepts as raster exports when generated
    // by an external image tool and as vector files when authored in-repo.
    expect(app).toMatch(/framework-loop\.(svg|png|webp|jpg)/);
    expect(app).toMatch(/harness-map\.(svg|png|webp|jpg)/);
    expect(app).toMatch(/deployment-flow\.(svg|png|webp|jpg)/);
    expect(app).toContain('Why it exists');
    expect(app).toContain('What we do not claim yet');
    expect(app).toContain('source-cited market research must produce real capabilities');
    expect(app).toContain('managed workspaces');
    expect(app).toContain('https://github.com/Hosico02/demo2project');
    expect(app).toContain('requestAnimationFrame');
    expect(app).toContain('onTouchstart');
  });
});
