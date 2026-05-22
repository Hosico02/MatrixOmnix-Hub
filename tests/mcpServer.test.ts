import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

describe('d2p-verify MCP server', () => {
  it('detect_archetype returns python-library for a pyproject + __init__.py fixture', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'mcp-arche-py-'));
    await fs.writeFile(
      path.join(dir, 'pyproject.toml'),
      [
        '[build-system]',
        'requires = ["setuptools"]',
        'build-backend = "setuptools.build_meta"',
        '',
        '[project]',
        'name = "x"',
        'classifiers = ["License :: OSI Approved"]',
        '',
      ].join('\n'),
    );
    await fs.mkdir(path.join(dir, 'src', 'x'), { recursive: true });
    await fs.writeFile(path.join(dir, 'src', 'x', '__init__.py'), '');
    const { runDetectArchetypeImpl } = await import('../src/mcp/server.js') as any;
    const result = await runDetectArchetypeImpl(dir);
    expect(result.primary.id).toBe('python-library');
    expect(result.primary.confidence).toBeGreaterThan(0.4);
    expect(Array.isArray(result.alternatives)).toBe(true);
  });
});
