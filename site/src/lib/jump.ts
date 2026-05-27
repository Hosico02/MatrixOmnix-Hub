import type { Milestone } from './milestones';

/**
 * Best-effort scroll-target offset in stdout for a milestone's timestamp.
 *
 * Tries three timestamp patterns (full ISO, ISO without trailing Z slice,
 * HH:MM:SS slice) in stdout; first hit wins. If none match, calls the
 * `fallbackFraction` thunk for a [0, 1] position and returns
 * `floor(stdout.length * fraction)`.
 */
export function findStdoutOffsetFor(
  ts: string,
  stdout: string,
  fallbackFraction: () => number,
): number {
  const patterns = [
    ts,
    ts.slice(0, 19),          // YYYY-MM-DDTHH:MM:SS
    ts.slice(11, 19),         // HH:MM:SS
  ];
  for (const p of patterns) {
    if (p.length < 4) continue;
    const idx = stdout.indexOf(p);
    if (idx !== -1) return idx;
  }
  const f = Math.max(0, Math.min(1, fallbackFraction()));
  return Math.floor(stdout.length * f);
}

export function milestoneFractionInTimeline(
  m: Milestone,
  list: Milestone[],
): number {
  if (list.length <= 1) return 0;
  const idx = list.findIndex((x) => x.id === m.id);
  if (idx < 0) return 0;
  return idx / (list.length - 1);
}
