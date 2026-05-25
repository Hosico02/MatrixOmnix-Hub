import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import type { DbHandle } from '../db/client.js';
import { standards } from '../db/schema.js';

export function standardsRoute(handle: DbHandle) {
  const r = new Hono();

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

  return r;
}
