import { Hono } from 'hono';
import type { DbHandle } from './db/client.js';
import { adminAuth } from './auth.js';
import { adminRoute } from './routes/admin.js';
import { eventsRoute } from './routes/events.js';
import { standardsRoute } from './routes/standards.js';
import { runsRoute } from './routes/runs.js';
import { proposalsRoute } from './routes/proposals.js';
import { makeInstanceLookup } from './instanceLookup.js';

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

  const lookup = makeInstanceLookup(handle);
  app.route('/', adminRoute(handle, opts.adminToken));
  app.route('/', eventsRoute(handle, lookup));
  app.route('/', standardsRoute(handle));
  app.route('/', runsRoute(handle));
  app.route('/', proposalsRoute(handle));

  return app;
}
