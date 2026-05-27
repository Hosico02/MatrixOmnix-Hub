import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useRunLogs } from '../../site/src/composables/useRunLogs';

describe('useRunLogs', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function mockFetchSeq(...responses: Array<{
    status: number; json?: any;
  }>) {
    const fn = vi.fn();
    for (const r of responses) {
      fn.mockResolvedValueOnce({
        ok: r.status >= 200 && r.status < 300,
        status: r.status,
        json: async () => r.json,
      });
    }
    vi.stubGlobal('fetch', fn);
    return fn;
  }

  it('idle on construction; start() transitions to loading then streaming', async () => {
    mockFetchSeq({
      status: 200,
      json: { content: 'hello\n', next_offset: 6, eof: false },
    });
    const log = useRunLogs();
    expect(log.state.value).toBe('idle');
    void log.start('r1', 'tok1');
    await vi.runOnlyPendingTimersAsync();
    expect(log.state.value).toBe('streaming');
    expect(log.buffer.value).toBe('hello\n');
    expect(log.nextOffset.value).toBe(6);
    log.stop();
  });

  it('sends Authorization: Bearer <token> header (matches Hub adminAuth)', async () => {
    const fetch = mockFetchSeq({
      status: 200,
      json: { content: '', next_offset: 0, eof: true },
    });
    const log = useRunLogs();
    void log.start('r1', 'sekret');
    await vi.runOnlyPendingTimersAsync();
    expect(fetch).toHaveBeenCalledTimes(1);
    const init = fetch.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization)
      .toBe('Bearer sekret');
    log.stop();
  });

  it('appends content across polls and stops at eof', async () => {
    const fetch = mockFetchSeq(
      { status: 200, json: { content: 'a', next_offset: 1, eof: false } },
      { status: 200, json: { content: 'bc', next_offset: 3, eof: true } },
    );
    const log = useRunLogs();
    void log.start('r1', 'tok1');
    await vi.runOnlyPendingTimersAsync();
    await vi.advanceTimersByTimeAsync(2000);
    await vi.runOnlyPendingTimersAsync();
    expect(log.buffer.value).toBe('abc');
    expect(log.state.value).toBe('eof');
    // No more polls scheduled after eof.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('transitions to no_log on 404', async () => {
    mockFetchSeq({ status: 404, json: { error: 'log_not_found' } });
    const log = useRunLogs();
    void log.start('r1', 'tok1');
    await vi.runOnlyPendingTimersAsync();
    expect(log.state.value).toBe('no_log');
    expect(log.buffer.value).toBe('');
  });

  it('transitions to needs_token on 401', async () => {
    mockFetchSeq({ status: 401, json: { error: 'unauthorized' } });
    const log = useRunLogs();
    void log.start('r1', 'badtok');
    await vi.runOnlyPendingTimersAsync();
    expect(log.state.value).toBe('needs_token');
  });

  it('stop() clears scheduled poll', async () => {
    const fetch = mockFetchSeq(
      { status: 200, json: { content: 'x', next_offset: 1, eof: false } },
    );
    const log = useRunLogs();
    void log.start('r1', 'tok1');
    await vi.runOnlyPendingTimersAsync();
    log.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
