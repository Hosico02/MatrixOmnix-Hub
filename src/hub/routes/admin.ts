import { Hono } from 'hono';
import type { DbHandle } from '../db/client.js';
import { adminAuth } from '../auth.js';
import { runRulePass } from '../learner/runner.js';
import { runLlmSummariser } from '../learner/llm_summariser.js';

// Minimal shape the route needs from an Anthropic-like client. Kept narrow so
// tests can pass a hand-rolled stub without depending on the SDK type.
export interface AnthropicLike {
  messages: {
    create: (args: unknown) => Promise<{
      content: Array<{ type: string; text: string }>;
    }>;
  };
}

export interface AdminRouteDeps {
  adminToken: string | null;
  // When absent, /admin/learner/run-summariser responds 503. Lets the route
  // exist unconditionally while still gating on production wiring.
  anthropic: AnthropicLike | null;
}

export function adminRoute(handle: DbHandle, deps: AdminRouteDeps) {
  const r = new Hono();
  r.post('/admin/learner/trigger', adminAuth(deps.adminToken), async (c) => {
    const created = await runRulePass(handle, { disabledRules: new Set() });
    return c.json({ proposals_created: created });
  });
  // Manual trigger for the weekly LLM summariser. Same code path the
  // setInterval in src/hub/index.ts uses; the manual route exists so the
  // cron can be tested in-band without waiting 7 days.
  r.post('/admin/learner/run-summariser', adminAuth(deps.adminToken), async (c) => {
    if (!deps.anthropic) {
      return c.json({
        error: 'llm_learner_not_configured',
        detail: 'HUB_LLM_LEARNER_ENABLED + ANTHROPIC_API_KEY must be set.',
      }, 503);
    }
    try {
      const created = await runLlmSummariser(handle, deps.anthropic);
      return c.json({ proposals_created: created });
    } catch (e) {
      return c.json({
        error: 'summariser_failed',
        detail: e instanceof Error ? e.message : String(e),
      }, 500);
    }
  });
  return r;
}
