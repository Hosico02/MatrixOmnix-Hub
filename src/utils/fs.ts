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
 * Walks breadth-first across the whole tree: every file at depth N is
 * pushed before any file at depth N+1. This guarantees shallow markers
 * like book.toml, package.json, Cargo.toml, pyproject.toml, src/SUMMARY.md
 * always make it into the result, even on repos like rust-lang/book where
 * a single sibling directory (listings/) holds thousands of deep files
 * that would otherwise exhaust the cap under a depth-first walk before
 * src/SUMMARY.md (depth 1) ever gets visited.
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
  let frontier: { abs: string; rel: string }[] = [{ abs: dir, rel: '' }];
  while (frontier.length > 0 && out.length < maxFiles) {
    const nextFrontier: { abs: string; rel: string }[] = [];
    for (const node of frontier) {
      if (out.length >= maxFiles) break;
      let entries;
      try {
        entries = await fs.readdir(node.abs, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        if (skip.has(e.name)) continue;
        const childRel = node.rel ? path.join(node.rel, e.name) : e.name;
        const childAbs = path.join(node.abs, e.name);
        if (e.isFile()) {
          out.push(childRel);
          if (out.length >= maxFiles) break;
        } else if (e.isDirectory()) {
          nextFrontier.push({ abs: childAbs, rel: childRel });
        }
      }
    }
    frontier = nextFrontier;
  }
  return out.sort();
}
