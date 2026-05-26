import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DbHandle } from './db/client.js';
import { adminAuth } from './auth.js';
import { adminRoute, type AnthropicLike } from './routes/admin.js';
import { eventsRoute } from './routes/events.js';
import { standardsRoute } from './routes/standards.js';
import { runsRoute } from './routes/runs.js';
import { proposalsRoute } from './routes/proposals.js';
import { runsRunnerRoute, type RunnerConfig } from './routes/runs_runner.js';
import { makeInstanceLookup } from './instanceLookup.js';
import type { RunSupervisor } from './runner/supervisor.js';

export interface AppOpts {
  adminToken: string | null;
  anthropic?: AnthropicLike | null;
  // Optional. When supplied AND runnerCfg.enabled is true, mount the
  // /admin/runs/* routes. Otherwise those routes simply aren't registered.
  runner?: RunSupervisor | null;
  runnerCfg?: RunnerConfig | null;
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
  app.route('/', adminRoute(handle, {
    adminToken: opts.adminToken,
    anthropic: opts.anthropic ?? null,
  }));
  app.route('/api', eventsRoute(handle, lookup));
  app.route('/api', standardsRoute(handle));
  app.route('/api', runsRoute(handle));
  app.route('/api', proposalsRoute(handle));

  if (opts.runner) {
    app.route('/', runsRunnerRoute(handle, opts.runner, {
      adminToken: opts.adminToken,
      cfg: opts.runnerCfg ?? null,
    }));
  }

  const sitePath = join(process.cwd(), 'site', 'dist');
  if (existsSync(sitePath)) {
    app.use('/*', serveStatic({ root: './site/dist' }));
    // SPA history fallback: any GET that didn't match a real file or an
    // API/admin route gets the SPA's index.html, so client-side routes
    // like /iterate or /runs/:id survive a hard refresh. Skip /api/* and
    // /admin/* so missing backend routes still 404 cleanly.
    const indexPath = join(sitePath, 'index.html');
    if (existsSync(indexPath)) {
      const indexHtml = readFileSync(indexPath, 'utf-8');
      app.get('*', (c) => {
        const p = new URL(c.req.url).pathname;
        if (p.startsWith('/api/') || p.startsWith('/admin/')) {
          return c.notFound();
        }
        return c.html(indexHtml);
      });
    }
  }

  return app;
}
