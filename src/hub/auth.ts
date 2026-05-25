import type { MiddlewareHandler } from 'hono';

export interface InstanceInfo { id: string; name: string; tokenHash: string }
export type InstanceLookup = (token: string) => Promise<InstanceInfo | null>;

export function bearerAuth(lookup: InstanceLookup): MiddlewareHandler {
  return async (c, next) => {
    const hdr = c.req.header('Authorization') ?? '';
    const m = /^Bearer\s+(.+)$/i.exec(hdr);
    if (!m) return c.json({ error: 'missing bearer' }, 401);
    const inst = await lookup(m[1]);
    if (!inst) return c.json({ error: 'invalid token' }, 401);
    c.set('instance' as never, inst);
    await next();
  };
}

export function adminAuth(expected: string | null): MiddlewareHandler {
  return async (c, next) => {
    if (!expected) return c.json({ error: 'admin disabled' }, 503);
    const hdr = c.req.header('Authorization') ?? '';
    if (hdr !== `Bearer ${expected}`) return c.json({ error: 'forbidden' }, 403);
    await next();
  };
}
