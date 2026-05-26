import { ref } from 'vue';

export type LogState =
  | 'idle'
  | 'loading'
  | 'streaming'
  | 'eof'
  | 'error'
  | 'no_log'
  | 'needs_token';

const POLL_INTERVAL_MS = 2000;
const ADMIN_BASE = '/admin';

/**
 * Polls `/admin/runs/:id/stdout?from=N`, appending content to a buffer
 * until eof. Callers drive lifecycle via start() / stop(). Polling is
 * scheduled via setTimeout so each request fully completes (including
 * appending to buffer) before the next request is scheduled — avoids
 * overlapping fetches.
 */
export function useRunLogs() {
  const state = ref<LogState>('idle');
  const buffer = ref<string>('');
  const nextOffset = ref<number>(0);
  const error = ref<string | null>(null);

  let runId: string | null = null;
  let token: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  async function fetchChunk(): Promise<void> {
    if (stopped || runId == null || token == null) return;
    let res: Response;
    try {
      res = await fetch(
        `${ADMIN_BASE}/runs/${runId}/stdout?from=${nextOffset.value}`,
        { headers: { 'x-admin-token': token } },
      );
    } catch (e) {
      state.value = 'error';
      error.value = String(e);
      return;
    }
    if (res.status === 404) {
      state.value = 'no_log';
      return;
    }
    if (res.status === 401 || res.status === 403) {
      state.value = 'needs_token';
      return;
    }
    if (!res.ok) {
      state.value = 'error';
      error.value = `HTTP ${res.status}`;
      return;
    }
    const body = await res.json() as {
      content: string; next_offset: number; eof: boolean;
    };
    buffer.value += body.content;
    nextOffset.value = body.next_offset;
    if (body.eof) {
      state.value = 'eof';
      return;
    }
    state.value = 'streaming';
    schedule();
  }

  function schedule(delay: number = POLL_INTERVAL_MS): void {
    if (stopped) return;
    if (timer != null) clearTimeout(timer);
    timer = setTimeout(() => { void fetchChunk(); }, delay);
  }

  function start(rid: string, tok: string): void {
    runId = rid;
    token = tok;
    stopped = false;
    state.value = 'loading';
    buffer.value = '';
    nextOffset.value = 0;
    error.value = null;
    // Schedule the initial fetch via setTimeout(0) so callers can drive
    // it with fake timers (runOnlyPendingTimersAsync) just like a poll.
    schedule(0);
  }

  function stop(): void {
    stopped = true;
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  return { state, buffer, nextOffset, error, start, stop };
}
