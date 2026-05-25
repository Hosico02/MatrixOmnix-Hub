import { Hono } from 'hono';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { and, eq, desc } from 'drizzle-orm';
import type { DbHandle } from '../db/client.js';
import { proposals, proposalEvidence, standards, standardVersions, findings } from '../db/schema.js';

const DecisionBody = z.object({
  decision: z.enum(['approve', 'reject']),
  note: z.string().optional(),
  edited_body_md: z.string().optional(),
});

export function proposalsRoute(handle: DbHandle) {
  const r = new Hono();

  r.get('/proposals', (c) => {
    const status = c.req.query('status') ?? 'pending';
    const archetype = c.req.query('archetype');
    const conds = [eq(proposals.status, status)];
    if (archetype) conds.push(eq(proposals.archetype, archetype));
    const rows = handle.db.select().from(proposals)
      .where(and(...conds)).orderBy(desc(proposals.createdAt)).all();
    return c.json({
      items: rows.map((p) => ({
        id: p.id, archetype: p.archetype, proposal_type: p.proposalType,
        body_md: p.bodyMd, rationale_md: p.rationaleMd, source: p.source,
        status: p.status, created_at: p.createdAt,
      })),
    });
  });

  r.get('/proposals/:id', (c) => {
    const id = c.req.param('id');
    const p = handle.db.select().from(proposals).where(eq(proposals.id, id)).get();
    if (!p) return c.json({ error: 'not found' }, 404);
    const links = handle.db.select().from(proposalEvidence)
      .where(eq(proposalEvidence.proposalId, id)).all();
    const evidenceFindings = [];
    for (const l of links) {
      const f = handle.db.select().from(findings).where(eq(findings.id, l.findingId)).get();
      if (f) evidenceFindings.push({
        id: f.id, category: f.category, severity: f.severity,
        message: f.message, evidence: f.evidence,
      });
    }
    return c.json({
      proposal: {
        id: p.id, archetype: p.archetype, proposal_type: p.proposalType,
        body_md: p.bodyMd, rationale_md: p.rationaleMd, source: p.source,
        status: p.status, created_at: p.createdAt,
        decided_at: p.decidedAt, decided_by: p.decidedBy,
      },
      evidence: evidenceFindings,
    });
  });

  r.post('/proposals/:id/decision', async (c) => {
    const id = c.req.param('id');
    const parsed = DecisionBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'bad body' }, 400);
    const p = handle.db.select().from(proposals).where(eq(proposals.id, id)).get();
    if (!p) return c.json({ error: 'not found' }, 404);
    if (p.status !== 'pending') return c.json({ error: 'not pending' }, 409);

    if (parsed.data.decision === 'reject') {
      handle.db.update(proposals).set({
        status: 'rejected',
        decidedAt: new Date().toISOString(),
        decidedBy: 'human',
      }).where(eq(proposals.id, id)).run();
      return c.json({ new_standard_version_id: null });
    }

    const std = handle.db.select().from(standards)
      .where(and(eq(standards.archetype, p.archetype), eq(standards.isCurrent, true))).get();
    if (!std) return c.json({ error: 'no current standards for archetype' }, 500);
    const newVersion = std.version + 1;
    const newBody = (parsed.data.edited_body_md ?? std.bodyMd + '\n' + p.bodyMd);
    const versionId = randomUUID();
    handle.db.insert(standardVersions).values({
      id: versionId, standardsId: std.id, version: newVersion,
      bodyMd: newBody, diffFromPrevMd: `+ ${p.bodyMd}`,
    }).run();
    handle.db.update(standards).set({
      version: newVersion, bodyMd: newBody,
      source: parsed.data.edited_body_md ? 'manual' : p.source,
      approvedBy: 'human',
    }).where(eq(standards.id, std.id)).run();
    handle.db.update(proposals).set({
      status: 'approved',
      decidedAt: new Date().toISOString(),
      decidedBy: 'human',
      resultingStandardVersionId: versionId,
    }).where(eq(proposals.id, id)).run();
    return c.json({ new_standard_version_id: versionId });
  });

  return r;
}
