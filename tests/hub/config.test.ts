import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../../src/hub/config.js';

describe('hub config', () => {
  const origEnv = { ...process.env };
  beforeEach(() => { process.env = { ...origEnv }; });
  afterEach(() => { process.env = origEnv; });

  it('uses defaults when no env vars set', () => {
    delete process.env.HUB_PORT;
    delete process.env.HUB_DB_PATH;
    delete process.env.HUB_BIND;
    const cfg = loadConfig();
    expect(cfg.port).toBe(3030);
    expect(cfg.bind).toBe('127.0.0.1');
    expect(cfg.dbPath).toMatch(/\.matrixomnix\/hub\.db$/);
  });

  it('reads HUB_PORT as number', () => {
    process.env.HUB_PORT = '4040';
    expect(loadConfig().port).toBe(4040);
  });

  it('throws on missing HUB_ADMIN_TOKEN when required', () => {
    delete process.env.HUB_ADMIN_TOKEN;
    expect(() => loadConfig({ requireAdminToken: true }))
      .toThrow(/HUB_ADMIN_TOKEN/);
  });

  it('disables LLM learner when ANTHROPIC_API_KEY missing', () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(loadConfig().llmLearnerEnabled).toBe(false);
  });
});
