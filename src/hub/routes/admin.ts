import { Hono } from 'hono';
import type { DbHandle } from '../db/client.js';
import { adminAuth } from '../auth.js';
import { runRulePass } from '../learner/runner.js';

export function adminRoute(handle: DbHandle, adminToken: string | null) {
  const r = new Hono();
  r.post('/admin/learner/trigger', adminAuth(adminToken), async (c) => {
    const created = await runRulePass(handle, { disabledRules: new Set() });
    return c.json({ proposals_created: created });
  });
  return r;
}
