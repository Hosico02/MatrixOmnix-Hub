import { serve } from '@hono/node-server';
import Anthropic from '@anthropic-ai/sdk';
import { openDb, migrate } from './db/client.js';
import { loadConfig } from './config.js';
import { buildApp } from './server.js';
import { runLlmSummariser } from './learner/llm_summariser.js';

async function main() {
  const cfg = loadConfig({ requireAdminToken: true });
  const handle = openDb(cfg.dbPath);
  migrate(handle.sqlite);
  // Construct the Anthropic client once and pass it to the app so
  // /admin/learner/run-summariser can reuse it for on-demand triggers,
  // matching what the weekly setInterval below uses for the cron path.
  const anthropic = (cfg.llmLearnerEnabled && cfg.anthropicApiKey)
    ? new Anthropic({ apiKey: cfg.anthropicApiKey })
    : null;
  const app = buildApp(handle, {
    adminToken: cfg.adminToken,
    anthropic: anthropic as any,
  });
  serve({ fetch: app.fetch, port: cfg.port, hostname: cfg.bind }, (info) => {
    process.stderr.write(`MatrixOmnix Hub listening on http://${cfg.bind}:${info.port}\n`);
  });

  if (anthropic) {
    const WEEK_MS = 7 * 86400_000;
    setInterval(async () => {
      try {
        const n = await runLlmSummariser(handle, anthropic as any);
        process.stderr.write(`LLM summariser produced ${n} proposals\n`);
      } catch (e) {
        process.stderr.write(`LLM summariser failed: ${e}\n`);
      }
    }, WEEK_MS);
  }
}

main().catch((e) => {
  process.stderr.write(`hub fatal: ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
  process.exit(1);
});
