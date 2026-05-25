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
