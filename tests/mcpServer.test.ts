import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

describe('d2p-verify MCP server', () => {
  it('verify_project returns archetype + score + verdict + findings for a minimal flask app', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'mcp-verify-flask-'));
    await fs.writeFile(path.join(dir, 'requirements.txt'), 'flask\n');
    await fs.writeFile(
      path.join(dir, 'app.py'),
      [
        'from flask import Flask, jsonify',
        'app = Flask(__name__)',
        '@app.get("/health")',
        'def h(): return jsonify({"ok": True})',
        '',
      ].join('\n'),
    );
    await fs.writeFile(path.join(dir, 'README.md'), '# x\n\n' + 'x'.repeat(220));
    const { runVerifyImpl } = await import('../src/mcp/server.js') as any;
    const result = await runVerifyImpl(dir);
    expect(typeof result.archetype.id).toBe('string');
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(['pass', 'needs_repair', 'fail']).toContain(result.verdict);
    expect(Array.isArray(result.findings)).toBe(true);
    expect(result.evidence).toBeDefined();
    expect(result.qa_preflight).toBeDefined();
    expect(Array.isArray(result.qa_preflight.active_cases)).toBe(true);
  });

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
