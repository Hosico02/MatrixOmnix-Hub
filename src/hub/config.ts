import { homedir } from 'node:os';
import { join } from 'node:path';

export interface HubConfig {
  port: number;
  bind: string;
  dbPath: string;
  adminToken: string | null;
  llmLearnerEnabled: boolean;
  anthropicApiKey: string | null;
  disabledRules: Set<string>;
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
  return { port, bind, dbPath, adminToken, llmLearnerEnabled,
           anthropicApiKey, disabledRules };
}
