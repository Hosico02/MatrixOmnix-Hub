import { defineStore } from 'pinia';
import { api } from '../api';

export const useRunsStore = defineStore('runs', {
  state: () => ({ runs: [] as any[], loading: false, error: null as string | null }),
  actions: {
    async refresh(params?: { archetype?: string; state?: string }) {
      this.loading = true;
      this.error = null;
      try {
        this.runs = (await api.listRuns(params)).items;
      } catch (e: any) {
        this.error = e.message ?? String(e);
      } finally {
        this.loading = false;
      }
    },
  },
  getters: {
    active: (s) => s.runs.filter((r) => r.terminal_state === 'RUNNING'),
    recent: (s) => s.runs.filter((r) => r.terminal_state !== 'RUNNING').slice(0, 20),
  },
});
