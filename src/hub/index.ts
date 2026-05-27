import { serve } from '@hono/node-server';
import Anthropic from '@anthropic-ai/sdk';
import { openDb, migrate } from './db/client.js';
import { loadConfig } from './config.js';
import { buildApp } from './server.js';
import { runLlmSummariser } from './learner/llm_summariser.js';
import { RunSupervisor } from './runner/supervisor.js';

async function main() {
  const cfg = loadConfig({ requireAdminToken: true });
  const handle = openDb(cfg.dbPath);
  migrate(handle.sqlite);
  const anthropic = (cfg.llmLearnerEnabled && cfg.anthropicApiKey)
    ? new Anthropic({ apiKey: cfg.anthropicApiKey })
    : null;

  // Runner is optional. Only instantiate when D2P_RUNNER_ENABLED=1 AND
  // the required env is present — otherwise the routes 503 anyway and
  // the supervisor would just be inert.
  let supervisor: RunSupervisor | null = null;
  if (cfg.runnerEnabled && cfg.d2pPath
      && cfg.runnerMinimaxApiKey && cfg.runnerInstanceToken) {
    supervisor = new RunSupervisor({
      handle, dataDir: cfg.hubDataDir, d2pPath: cfg.d2pPath,
    });
    const shutdown = () => {
      process.stderr.write('shutting down RunSupervisor\n');
      supervisor?.shutdown();
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } else if (cfg.runnerEnabled) {
    process.stderr.write(
      'D2P_RUNNER_ENABLED=1 but D2P_PATH / D2P_RUNNER_MINIMAX_API_KEY / '
      + 'D2P_RUNNER_INSTANCE_TOKEN missing — runner routes will 503\n');
  }

  const app = buildApp(handle, {
    adminToken: cfg.adminToken,
    anthropic: anthropic as any,
    dataDir: cfg.hubDataDir,
    runner: supervisor,
    runnerCfg: cfg.runnerEnabled ? {
      enabled: true,
      d2pPath: cfg.d2pPath ?? '',
      minimaxApiKey: cfg.runnerMinimaxApiKey ?? '',
      instanceToken: cfg.runnerInstanceToken ?? '',
      hubBaseUrl: `http://${cfg.bind}:${cfg.port}`,
      pathPrefixes: cfg.runnerPathPrefixes,
    } : null,
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
