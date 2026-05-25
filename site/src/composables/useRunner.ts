import { ref, computed, onUnmounted } from 'vue';
import { api, adminApi } from '../api';
import { useRunnerStore } from '../stores/runner';

// Encapsulates the polling state machine for the /iterate page.
// Owns three reactive sources:
//   - `runDetail`  (the runs row, fetched every 2s via /api/runs/:id)
//   - `stdoutBuf`  (incrementally appended via /admin/runs/:id/stdout)
//   - `phase`      ('idle' | 'starting' | 'running' | 'terminal' | 'error')
// Caller drives the lifecycle via start() / attach() / stop().

export type Phase = 'idle' | 'starting' | 'running' | 'terminal' | 'error';

export function useRunner() {
  const store = useRunnerStore();
  const phase = ref<Phase>('idle');
  const runId = ref<string | null>(store.activeRunId);
  const runDetail = ref<any | null>(null);
  const stdoutBuf = ref('');
  const error = ref<string | null>(null);
  let stdoutOffset = 0;
  let detailTimer: number | null = null;
  let stdoutTimer: number | null = null;

  function clearTimers() {
    if (detailTimer) { clearInterval(detailTimer); detailTimer = null; }
    if (stdoutTimer) { clearInterval(stdoutTimer); stdoutTimer = null; }
  }

  function isTerminal(state: string | null | undefined): boolean {
    return !!state && state !== 'RUNNING';
  }

  async function pollDetail() {
    if (!runId.value) return;
    try {
      runDetail.value = await api.getRun(runId.value);
      const ts = runDetail.value?.run?.terminal_state;
      if (isTerminal(ts)) {
        phase.value = 'terminal';
        clearTimers();
        // Drain the rest of stdout one more time so the last log lines arrive.
        await pollStdout();
      }
    } catch (e: any) {
      // 404 is expected immediately after start before d2p has pushed
      // run_started — keep polling.
      if (!/404/.test(e?.message ?? '')) {
        error.value = e?.message ?? String(e);
        phase.value = 'error';
        clearTimers();
      }
    }
  }

  async function pollStdout() {
    if (!runId.value || !store.adminToken) return;
    try {
      const r = await adminApi.stdout(store.adminToken, runId.value, stdoutOffset);
      stdoutBuf.value += r.content;
      stdoutOffset = r.next_offset;
    } catch {
      // 404 is expected before the log file exists; swallow.
    }
  }

  async function start(projectPath: string, iter: number) {
    if (!store.adminToken) throw new Error('admin token not set');
    error.value = null; runDetail.value = null; stdoutBuf.value = '';
    stdoutOffset = 0; phase.value = 'starting';
    try {
      const res = await adminApi.startRun(store.adminToken,
                                          { project_path: projectPath, iter });
      runId.value = res.run_id;
      store.setActiveRunId(res.run_id);
      phase.value = 'running';
      // Kick off polling immediately, then on a 2 s cadence.
      void pollDetail(); void pollStdout();
      detailTimer = window.setInterval(pollDetail, 2000);
      stdoutTimer = window.setInterval(pollStdout, 2000);
    } catch (e: any) {
      error.value = e?.message ?? String(e);
      phase.value = 'error';
    }
  }

  async function attach() {
    if (!store.adminToken) return;
    try {
      const cur = await adminApi.currentRun(store.adminToken);
      if (!cur.run_id) return;
      runId.value = cur.run_id;
      store.setActiveRunId(cur.run_id);
      phase.value = 'running';
      void pollDetail(); void pollStdout();
      detailTimer = window.setInterval(pollDetail, 2000);
      stdoutTimer = window.setInterval(pollStdout, 2000);
    } catch { /* no active run / bad token — stay idle */ }
  }

  function stop() {
    clearTimers();
    phase.value = 'idle';
    runId.value = null;
    store.setActiveRunId(null);
  }

  onUnmounted(clearTimers);

  return {
    phase, runId, runDetail, stdoutBuf, error,
    start, attach, stop,
    canPush: computed(() => phase.value === 'terminal'),
  };
}
