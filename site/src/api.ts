const BASE = '/api';

async function get<T>(path: string): Promise<T> {
  const r = await fetch(BASE + path);
  if (!r.ok) throw new Error(`GET ${path} failed: ${r.status}`);
  return r.json();
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`POST ${path} failed: ${r.status}`);
  return r.json();
}

export const api = {
  listRuns: (params?: { archetype?: string; state?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.archetype) q.set('archetype', params.archetype);
    if (params?.state) q.set('state', params.state);
    if (params?.limit) q.set('limit', String(params.limit));
    const qs = q.toString();
    return get<{ items: any[] }>('/runs' + (qs ? '?' + qs : ''));
  },
  getRun: (id: string) =>
    get<any>(`/runs/${id}`),
  addRunNote: (id: string, body_md: string) =>
    post<{ note: any }>(`/runs/${id}/notes`, { body_md, author: 'human' }),
  listStandards: () =>
    get<{ items: any[] }>('/standards'),
  getStandardsHistory: (archetype: string) =>
    get<any>(`/standards/${encodeURIComponent(archetype)}/history`),
  listProposals: (status: 'pending' | 'approved' | 'rejected' | 'superseded' = 'pending') =>
    get<{ items: any[] }>(`/proposals?status=${status}`),
  getProposal: (id: string) =>
    get<any>(`/proposals/${id}`),
  decideProposal: (id: string, decision: 'approve' | 'reject',
                   opts?: { note?: string; edited_body_md?: string }) =>
    post<{ new_standard_version_id: string | null }>(`/proposals/${id}/decision`,
      { decision, ...opts }),
};

const ADMIN_BASE = '/admin';

function adminHeaders(token: string) {
  return { 'content-type': 'application/json',
           Authorization: `Bearer ${token}` };
}

export interface StartRunReq { project_path: string; iter: number }
export interface StartRunRes { run_id: string; pid: number; stdout_log: string }
export interface CurrentRunRes {
  run_id: string | null;
  pid?: number; project_path?: string; started_at?: string;
}
export interface StdoutRes { content: string; next_offset: number; eof: boolean }
export interface PushReq {
  remote_url: string; branch: string; commit_message: string;
}
export interface PushRes {
  steps: Array<{ cmd: string; exit: number; output: string }>;
  ok: boolean; remote_html: string | null;
}

export const adminApi = {
  startRun: async (token: string, body: StartRunReq): Promise<StartRunRes> => {
    const r = await fetch(`${ADMIN_BASE}/runs/start`, {
      method: 'POST', headers: adminHeaders(token), body: JSON.stringify(body),
    });
    if (!r.ok) throw await asError(r);
    return r.json();
  },
  currentRun: async (token: string): Promise<CurrentRunRes> => {
    const r = await fetch(`${ADMIN_BASE}/runs/current`,
                          { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw await asError(r);
    return r.json();
  },
  stdout: async (token: string, runId: string, from: number): Promise<StdoutRes> => {
    const r = await fetch(`${ADMIN_BASE}/runs/${runId}/stdout?from=${from}`,
                          { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw await asError(r);
    return r.json();
  },
  pushGithub: async (token: string, runId: string, body: PushReq): Promise<PushRes> => {
    const r = await fetch(`${ADMIN_BASE}/runs/${runId}/push-github`, {
      method: 'POST', headers: adminHeaders(token), body: JSON.stringify(body),
    });
    // Push intentionally returns 200 or 500 with a JSON body; surface both.
    const j = await r.json().catch(() => ({}));
    if (!r.ok && !j?.steps) throw new Error(`push failed: ${r.status}`);
    return j;
  },
};

async function asError(r: Response): Promise<Error> {
  const text = await r.text().catch(() => '');
  return new Error(`${r.status} ${r.statusText}: ${text.slice(0, 200)}`);
}
