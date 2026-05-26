import { describe, it, expect } from 'vitest';
import {
  findStdoutOffsetFor,
  milestoneFractionInTimeline,
} from '../../site/src/lib/jump';
import type { Milestone } from '../../site/src/lib/milestones';

const ms = (kind: Milestone['kind'], ts: string, id = kind): Milestone => ({
  id, kind, ts, title: kind,
});

describe('findStdoutOffsetFor', () => {
  it('matches full ISO timestamp when present', () => {
    const stdout = 'pre\n2026-05-26T10:00:42Z some output\nafter\n';
    const idx = findStdoutOffsetFor('2026-05-26T10:00:42Z', stdout, () => 0);
    expect(idx).toBe(stdout.indexOf('2026-05-26T10:00:42Z'));
  });

  it('matches HH:MM:SS slice when full ISO not present', () => {
    const stdout = 'pre\n[10:00:42] doing thing\nafter\n';
    const idx = findStdoutOffsetFor('2026-05-26T10:00:42Z', stdout, () => 999);
    expect(idx).toBe(stdout.indexOf('10:00:42'));
  });

  it('falls back to fraction when no timestamp pattern present', () => {
    const stdout = 'line a\nline b\nline c\nline d\nline e\n';
    const idx = findStdoutOffsetFor('2026-05-26T10:00:42Z', stdout, () => 0.4);
    expect(idx).toBe(Math.floor(stdout.length * 0.4));
  });
});

describe('milestoneFractionInTimeline', () => {
  it('returns the milestone position fraction', () => {
    const list = [
      ms('start', '2026-05-26T10:00:00Z'),
      ms('iter', '2026-05-26T10:01:00Z', 'i1'),
      ms('iter', '2026-05-26T10:02:00Z', 'i2'),
      ms('term', '2026-05-26T10:03:00Z'),
    ];
    expect(milestoneFractionInTimeline(list[0], list)).toBeCloseTo(0, 3);
    expect(milestoneFractionInTimeline(list[2], list)).toBeCloseTo(2 / 3, 3);
    expect(milestoneFractionInTimeline(list[3], list)).toBeCloseTo(1, 3);
  });

  it('returns 0 when milestone not in list', () => {
    const list = [ms('start', '2026-05-26T10:00:00Z')];
    const orphan = ms('iter', '2026-05-26T11:00:00Z', 'missing');
    expect(milestoneFractionInTimeline(orphan, list)).toBe(0);
  });
});
