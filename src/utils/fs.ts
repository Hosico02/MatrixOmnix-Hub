import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import path from 'node:path';

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export function fileExists(p: string): boolean {
  return existsSync(p);
}

export async function readTextSafe(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, 'utf8');
  } catch {
    return null;
  }
}

export async function writeText(p: string, content: string): Promise<void> {
  await ensureDir(path.dirname(p));
  await fs.writeFile(p, content, 'utf8');
}

export async function appendText(p: string, content: string): Promise<void> {
  await ensureDir(path.dirname(p));
  await fs.appendFile(p, content, 'utf8');
}

/**
 * List file paths under `dir` recursively, relative to `dir`.
 * Skips node_modules, .git, dist, .demo2project, common heavy/tool dirs.
 *
 * Walks shallow-first: every directory's own files are pushed BEFORE
 * recursing into subdirectories. This guarantees that shallow markers
 * (book.toml, package.json, Cargo.toml, pyproject.toml at the root)
 * always make it into the result, even on repos like rust-lang/book where
 * a single deep directory (listings/) could otherwise exhaust the cap
 * before sibling files at the same depth get a chance.
 */
export async function listFiles(dir: string, maxFiles = 2000): Promise<string[]> {
  const skip = new Set([
    'node_modules',
    '.git',
    'dist',
    '.demo2project',
    '.zp',
    'coverage',
    '.next',
    '.cache',
    '.pycache',
    '.pytest_cache',
    '.venv',
    'venv',
    '__pycache__',
  ]);
  const out: string[] = [];
  async function walk(current: string, rel: string): Promise<void> {
    if (out.length >= maxFiles) return;
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    // Pass 1: push all files at this depth so siblings never lose to a
    // sibling directory that fills the budget on its own.
    const subdirs: { abs: string; rel: string }[] = [];
    for (const e of entries) {
      if (skip.has(e.name)) continue;
      const childRel = rel ? path.join(rel, e.name) : e.name;
      const childAbs = path.join(current, e.name);
      if (e.isFile()) {
        out.push(childRel);
        if (out.length >= maxFiles) return;
      } else if (e.isDirectory()) {
        subdirs.push({ abs: childAbs, rel: childRel });
      }
    }
    // Pass 2: recurse into directories.
    for (const sub of subdirs) {
      if (out.length >= maxFiles) return;
      await walk(sub.abs, sub.rel);
    }
  }
  await walk(dir, '');
  return out.sort();
}
