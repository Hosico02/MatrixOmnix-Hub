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

describe('runner config', () => {
  const savedEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('runnerEnabled defaults to false', () => {
    delete process.env.D2P_RUNNER_ENABLED;
    delete process.env.HUB_ADMIN_TOKEN;
    const cfg = loadConfig();
    expect(cfg.runnerEnabled).toBe(false);
  });

  it('runnerEnabled true when D2P_RUNNER_ENABLED=1', () => {
    process.env.D2P_RUNNER_ENABLED = '1';
    const cfg = loadConfig();
    expect(cfg.runnerEnabled).toBe(true);
  });

  it('runnerPathPrefixes defaults to $HOME + /tmp', () => {
    delete process.env.HUB_RUNNER_PATH_PREFIX;
    const cfg = loadConfig();
    expect(cfg.runnerPathPrefixes.length).toBeGreaterThanOrEqual(2);
    expect(cfg.runnerPathPrefixes).toContain('/tmp');
  });

  it('runnerPathPrefixes parses comma-separated env override', () => {
    process.env.HUB_RUNNER_PATH_PREFIX = '/a,/b/c';
    const cfg = loadConfig();
    expect(cfg.runnerPathPrefixes).toEqual(['/a', '/b/c']);
  });

  it('hubDataDir defaults to dirname(dbPath)', () => {
    process.env.HUB_DB_PATH = '/tmp/x/y/hub.db';
    delete process.env.HUB_DATA_DIR;
    const cfg = loadConfig();
    expect(cfg.hubDataDir).toBe('/tmp/x/y');
  });
});
