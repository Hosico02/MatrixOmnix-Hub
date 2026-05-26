export type MilestoneKind = 'start' | 'iter' | 'term';

export interface Milestone {
  id: string;
  kind: MilestoneKind;
  ts: string;
  title: string;
  subtitle?: string;
  iterId?: string;
}

interface IterRow {
  id: string;
  iter_n: number;
  started_at: string | null;
  ended_at: string | null;
  analyzer_summary: string | null;
  planner_summary: string | null;
  executor_summary: string | null;
  qa_summary?: string | null;
}

interface RunDetailPayload {
  run: {
    id: string;
    project_path: string;
    started_at: string;
    terminated_at: string | null;
    terminal_state: string | null;
  };
  iterations: IterRow[];
}

const MAX_SUBTITLE_LINE = 80;

function clip(s: string): string {
  return s.length <= MAX_SUBTITLE_LINE ? s : s.slice(0, MAX_SUBTITLE_LINE);
}

function iterSubtitle(it: IterRow): string | undefined {
  const parts: string[] = [];
  if (it.analyzer_summary) parts.push(clip(it.analyzer_summary));
  if (it.planner_summary) parts.push(clip(it.planner_summary));
  if (it.executor_summary) parts.push(clip(it.executor_summary));
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

export function deriveMilestones(payload: RunDetailPayload): Milestone[] {
  const out: Milestone[] = [];
  const projectName = payload.run.project_path.split('/').pop() || payload.run.project_path;

  out.push({
    id: 'start',
    kind: 'start',
    ts: payload.run.started_at,
    title: 'run_started',
    subtitle: projectName,
  });

  const sorted = [...payload.iterations].sort((a, b) => a.iter_n - b.iter_n);
  for (const it of sorted) {
    const inProgress = it.ended_at == null;
    const ts = it.ended_at
      ?? it.started_at
      ?? payload.run.terminated_at
      ?? payload.run.started_at;
    out.push({
      id: `iter:${it.id}`,
      kind: 'iter',
      ts,
      title: inProgress ? `第 ${it.iter_n} 轮 进行中` : `第 ${it.iter_n} 轮 完成`,
      subtitle: iterSubtitle(it),
      iterId: it.id,
    });
  }

  if (payload.run.terminated_at != null) {
    out.push({
      id: 'term',
      kind: 'term',
      ts: payload.run.terminated_at,
      title: 'run_terminated',
      subtitle: payload.run.terminal_state ?? undefined,
    });
  }

  return out;
}
