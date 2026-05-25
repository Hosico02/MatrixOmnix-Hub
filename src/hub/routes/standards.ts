import { Hono } from 'hono';
import { and, eq, desc } from 'drizzle-orm';
import type { DbHandle } from '../db/client.js';
import { standards, standardVersions, proposals } from '../db/schema.js';

export function standardsRoute(handle: DbHandle) {
  const r = new Hono();

  r.get('/standards/:archetype/history', (c) => {
    const archetype = c.req.param('archetype');
    const std = handle.db.select().from(standards)
      .where(eq(standards.archetype, archetype)).get();
    if (!std) return c.json({ error: 'unknown archetype' }, 404);
    const versions = handle.db.select().from(standardVersions)
      .where(eq(standardVersions.standardsId, std.id))
      .orderBy(desc(standardVersions.version)).all();
    const pending = handle.db.select().from(proposals)
      .where(and(eq(proposals.archetype, archetype), eq(proposals.status, 'pending'))).all();
    return c.json({
      versions: versions.map((v) => ({
        id: v.id, version: v.version, body_md: v.bodyMd,
        diff_from_prev_md: v.diffFromPrevMd, created_at: v.createdAt,
      })),
      proposals: pending.map((p) => ({
        id: p.id, proposal_type: p.proposalType, body_md: p.bodyMd,
        created_at: p.createdAt,
      })),
    });
  });

  r.get('/standards/:archetype', (c) => {
    const archetype = c.req.param('archetype');
    const row = handle.db.select().from(standards)
      .where(and(eq(standards.archetype, archetype), eq(standards.isCurrent, true)))
      .get();
    if (!row) return c.json({ error: 'unknown archetype' }, 404);
    const etag = String(row.version);
    if (c.req.header('if-none-match') === etag) {
      return new Response(null, { status: 304 });
    }
    c.header('ETag', etag);
    return c.json({ version: row.version, body_md: row.bodyMd, etag });
  });

  r.get('/standards', (c) => {
    const rows = handle.db.select().from(standards).where(eq(standards.isCurrent, true)).all();
    const items = rows.map((row) => {
      const vcount = handle.db.select().from(standardVersions)
        .where(eq(standardVersions.standardsId, row.id)).all().length;
      return {
        archetype: row.archetype,
        current_version: row.version,
        version_count: Math.max(vcount, 1),
      };
    });
    return c.json({ items });
  });

  return r;
}
