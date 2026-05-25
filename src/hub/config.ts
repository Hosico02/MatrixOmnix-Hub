import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface HubConfig {
  port: number;
  bind: string;
  dbPath: string;
  adminToken: string | null;
  llmLearnerEnabled: boolean;
  anthropicApiKey: string | null;
  disabledRules: Set<string>;
  // d2p runner (operator subprocess surface). All opt-in via env;
  // defaults make a standard Hub deployment incapable of spawning processes.
  runnerEnabled: boolean;
  d2pPath: string | null;             // absolute path to the d2p repo
  runnerMinimaxApiKey: string | null; // injected into subprocess env
  runnerInstanceToken: string | null; // d2p uses this to push events back
  runnerPathPrefixes: string[];       // allowed prefixes for target paths
  hubDataDir: string;                 // where runner-logs/ lives
}

export interface LoadOpts { requireAdminToken?: boolean }

export function loadConfig(opts: LoadOpts = {}): HubConfig {
  const port = Number(process.env.HUB_PORT ?? 3030);
  const bind = process.env.HUB_BIND ?? '127.0.0.1';
  const dbPath = process.env.HUB_DB_PATH
    ?? join(homedir(), '.matrixomnix', 'hub.db');
  const adminToken = process.env.HUB_ADMIN_TOKEN ?? null;
  if (opts.requireAdminToken && !adminToken) {
    throw new Error('HUB_ADMIN_TOKEN is required');
  }
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY ?? null;
  const llmLearnerEnabled = !!anthropicApiKey
    && process.env.HUB_DISABLE_LLM_LEARNER !== '1';
  const disabledRules = new Set(
    (process.env.HUB_DISABLE_RULE ?? '').split(',').filter(Boolean),
  );
  const runnerEnabled = process.env.D2P_RUNNER_ENABLED === '1';
  const d2pPath = process.env.D2P_PATH ?? null;
  const runnerMinimaxApiKey = process.env.D2P_RUNNER_MINIMAX_API_KEY ?? null;
  const runnerInstanceToken = process.env.D2P_RUNNER_INSTANCE_TOKEN ?? null;
  const runnerPathPrefixes = (process.env.HUB_RUNNER_PATH_PREFIX
    ?? `${homedir()},/tmp`).split(',').map((s) => s.trim()).filter(Boolean);
  const hubDataDir = process.env.HUB_DATA_DIR ?? dirname(dbPath);
  return {
    port, bind, dbPath, adminToken, llmLearnerEnabled,
    anthropicApiKey, disabledRules,
    runnerEnabled, d2pPath, runnerMinimaxApiKey, runnerInstanceToken,
    runnerPathPrefixes, hubDataDir,
  };
}
