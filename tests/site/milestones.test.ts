import { describe, it, expect } from 'vitest';
import { deriveMilestones, type Milestone } from '../../site/src/lib/milestones';

const baseRun = {
  id: 'r1',
  project_path: '/tmp/demo',
  detected_archetype: 'python-cli',
  started_at: '2026-05-26T10:00:00Z',
  terminated_at: null as string | null,
  terminal_state: null as string | null,
  total_cost_usd: 0,
  total_iterations: 0,
};

describe('deriveMilestones', () => {
  it('emits run_started only when no iterations and run still running', () => {
    const out = deriveMilestones({
      run: baseRun, iterations: [], verdicts: [], findings: [], notes: [],
    });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('start');
    expect(out[0].ts).toBe('2026-05-26T10:00:00Z');
    expect(out[0].subtitle).toBe('demo');
  });

  it('emits start + per-iteration completed + terminated for a 2-iter clean run', () => {
    const out = deriveMilestones({
      run: { ...baseRun,
        terminated_at: '2026-05-26T10:05:00Z',
        terminal_state: 'CLEAN',
      },
      iterations: [
        { id: 'i1', iter_n: 1, started_at: '2026-05-26T10:00:30Z',
          ended_at: '2026-05-26T10:02:00Z',
          analyzer_summary: 'detected Python CLI', planner_summary: 'split into 3 tasks',
          executor_summary: 'wrote tests', qa_summary: null },
        { id: 'i2', iter_n: 2, started_at: '2026-05-26T10:02:10Z',
          ended_at: '2026-05-26T10:04:50Z',
          analyzer_summary: null, planner_summary: null,
          executor_summary: 'fixed README', qa_summary: null },
      ],
      verdicts: [], findings: [], notes: [],
    });
    expect(out.map((m) => m.kind)).toEqual(['start', 'iter', 'iter', 'term']);
    expect(out[1].ts).toBe('2026-05-26T10:02:00Z');
    expect(out[1].title).toBe('第 1 轮 完成');
    expect(out[1].subtitle).toContain('detected Python CLI');
    expect(out[1].subtitle).toContain('split into 3 tasks');
    expect(out[1].subtitle).toContain('wrote tests');
    expect(out[3].subtitle).toBe('CLEAN');
  });

  it('marks an iteration in progress when ended_at is null', () => {
    const out = deriveMilestones({
      run: baseRun,
      iterations: [
        { id: 'i1', iter_n: 1, started_at: '2026-05-26T10:00:30Z', ended_at: null,
          analyzer_summary: null, planner_summary: null, executor_summary: null,
          qa_summary: null },
      ],
      verdicts: [], findings: [], notes: [],
    });
    expect(out[1].title).toBe('第 1 轮 进行中');
    expect(out[1].ts).toBe('2026-05-26T10:00:30Z');
  });

  it('truncates each summary line to 80 chars and joins with " · "', () => {
    const long = 'x'.repeat(200);
    const out = deriveMilestones({
      run: baseRun,
      iterations: [
        { id: 'i1', iter_n: 1, started_at: '2026-05-26T10:00:30Z',
          ended_at: '2026-05-26T10:02:00Z',
          analyzer_summary: long, planner_summary: long, executor_summary: long,
          qa_summary: null },
      ],
      verdicts: [], findings: [], notes: [],
    });
    const parts = (out[1].subtitle ?? '').split(' · ');
    expect(parts).toHaveLength(3);
    for (const p of parts) {
      expect(p.length).toBeLessThanOrEqual(80);
    }
  });

  it('uses run.terminated_at when iteration ended_at is null but run terminated', () => {
    const out = deriveMilestones({
      run: { ...baseRun, terminated_at: '2026-05-26T10:05:00Z', terminal_state: 'TIMEOUT' },
      iterations: [
        { id: 'i1', iter_n: 1, started_at: null, ended_at: null,
          analyzer_summary: null, planner_summary: null, executor_summary: null,
          qa_summary: null },
      ],
      verdicts: [], findings: [], notes: [],
    });
    expect(out[1].ts).toBe('2026-05-26T10:05:00Z');
  });
});
