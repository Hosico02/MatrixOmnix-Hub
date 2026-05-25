import type { DbHandle } from '../db/client.js';
import { upsertCandidate } from './dedup.js';
import type { ProposalCandidate } from './types.js';

const WINDOW_DAYS = 7;
const MAX_INPUT_FINDINGS = 500;

interface ClaudeLike {
  messages: { create: (args: any) => Promise<{ content: Array<{ type: string; text: string }> }> };
}

const SYSTEM_PROMPT = `You review d2p's recent run data and propose standards changes.
Rules R1-R5 already cover: persistent findings, dead checks, severity drift,
archetype drift, repeated residuals. **Do NOT duplicate those patterns.**
Focus on semantic issues: vague wording, missing examples, archetype boundary
errors. Output JSON array of { archetype, proposal_type ('add_check' |
'adjust_weight' | 'remove_check' | 'reword'), body_md, rationale_md,
evidence_finding_ids: string[] }. If you have nothing to propose, return [].`;

export async function runLlmSummariser(handle: DbHandle, client: ClaudeLike): Promise<number> {
  const since = new Date(Date.now() - WINDOW_DAYS * 86400_000).toISOString();
  const rows = handle.sqlite.prepare(`
    SELECT r.detected_archetype AS archetype, f.id AS finding_id,
           f.category, f.severity, f.message, v.verdict
    FROM findings f
    JOIN verdicts v ON v.id = f.verdict_id
    JOIN iterations i ON i.id = v.iteration_id
    JOIN runs r ON r.id = i.run_id
    WHERE r.started_at > ?
    ORDER BY r.started_at DESC
    LIMIT ?
  `).all(since, MAX_INPUT_FINDINGS) as Array<{
    archetype: string; finding_id: string; category: string;
    severity: string; message: string | null; verdict: string;
  }>;

  if (rows.length === 0) return 0;

  const grouped: Record<string, typeof rows> = {};
  for (const r of rows) {
    (grouped[r.archetype] ??= [] as any).push(r);
  }
  const userPrompt = `Past ${WINDOW_DAYS} days, grouped by archetype:\n` +
    Object.entries(grouped).map(([arch, items]) =>
      `## ${arch}\n` + items.slice(0, 50).map((it) =>
        `- [${it.severity}] ${it.category}: ${it.message ?? ''}`,
      ).join('\n')
    ).join('\n\n');

  let resp: { content: Array<{ type: string; text: string }> };
  try {
    resp = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });
  } catch (e) {
    process.stderr.write(`LLM summariser call failed: ${e instanceof Error ? e.message : String(e)}\n`);
    return 0;
  }

  const text = resp.content.find((p) => p.type === 'text')?.text ?? '';
  let parsed: any[];
  try {
    const match = /\[[\s\S]*\]/m.exec(text);
    parsed = JSON.parse(match ? match[0] : text);
    if (!Array.isArray(parsed)) return 0;
  } catch {
    return 0;
  }

  let inserted = 0;
  for (const p of parsed) {
    const cand: ProposalCandidate = {
      archetype: String(p.archetype ?? ''),
      proposalType: p.proposal_type,
      bodyMd: String(p.body_md ?? ''),
      rationaleMd: String(p.rationale_md ?? ''),
      source: 'llm',
      evidenceFindingIds: Array.isArray(p.evidence_finding_ids)
        ? p.evidence_finding_ids.map(String) : [],
    };
    if (!cand.archetype || !cand.bodyMd) continue;
    const newId = upsertCandidate(handle, cand);
    if (newId) inserted++;
  }
  return inserted;
}
