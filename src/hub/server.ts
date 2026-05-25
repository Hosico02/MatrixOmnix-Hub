import { Hono } from 'hono';
import type { DbHandle } from './db/client.js';
import { adminAuth } from './auth.js';

export interface AppOpts {
  adminToken: string | null;
}

export function buildApp(handle: DbHandle, opts: AppOpts) {
  const app = new Hono();

  app.get('/admin/health',
    adminAuth(opts.adminToken),
    (c) => {
      let dbOk = true;
      try { handle.sqlite.prepare('SELECT 1').get(); }
      catch { dbOk = false; }
      return c.json({
        db_ok: dbOk,
        last_event_at: null,
        last_learner_run_at: null,
      });
    },
  );

  return app;
}
