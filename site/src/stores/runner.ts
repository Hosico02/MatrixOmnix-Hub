import { defineStore } from 'pinia';

// LocalStorage-backed admin token + active run state. The token is set
// by the operator on first visit to /iterate and persists across reloads.
// Active run id is the one we last started or reattached to; nullable.
const TOKEN_KEY = 'hub.adminToken';

export const useRunnerStore = defineStore('runner', {
  state: () => ({
    adminToken: localStorage.getItem(TOKEN_KEY) ?? '',
    activeRunId: null as string | null,
  }),
  actions: {
    setToken(t: string) {
      this.adminToken = t.trim();
      if (this.adminToken) localStorage.setItem(TOKEN_KEY, this.adminToken);
      else localStorage.removeItem(TOKEN_KEY);
    },
    setActiveRunId(id: string | null) { this.activeRunId = id; },
    clearToken() { this.setToken(''); },
  },
});
