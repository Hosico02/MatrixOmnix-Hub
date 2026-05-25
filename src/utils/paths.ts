import path from 'node:path';

const STATE_DIR = '.demo2project';

export function stateDir(projectPath: string): string {
  return path.join(projectPath, STATE_DIR);
}

export function eventsDir(projectPath: string): string {
  return path.join(stateDir(projectPath), 'events');
}

export function iterationsDir(projectPath: string): string {
  return path.join(stateDir(projectPath), 'iterations');
}

export function isInsideDir(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Resolve to absolute, normalized form for safe comparison.
 */
export function abs(p: string): string {
  return path.resolve(p);
}
