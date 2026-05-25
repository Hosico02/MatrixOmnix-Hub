import { Hono } from 'hono';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { DbHandle } from '../db/client.js';
import { events } from '../db/schema.js';
import { bearerAuth, type InstanceLookup, type InstanceInfo } from '../auth.js';
import { payloadHash } from '../ingest/payloadHash.js';
import { dispatchIngest } from '../ingest/eventHandlers.js';

const EventBody = z.object({
  type: z.enum([
    'run_started', 'iteration_complete', 'verdict_emitted',
    'finding_recorded', 'run_terminated',
  ]),
  run_id: z.string(),
  payload: z.record(z.any()),
});

export function eventsRoute(handle: DbHandle, lookup: InstanceLookup) {
  const r = new Hono();
  r.post('/events', bearerAuth(lookup), async (c) => {
    const parsed = EventBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'bad payload' }, 400);
    const { type, run_id, payload } = parsed.data;
    const inst = c.get('instance' as never) as InstanceInfo;
    const id = randomUUID();
    const hash = payloadHash({ run_id, ...payload });

    try {
      handle.db.insert(events).values({
        id,
        instanceId: inst.id,
        eventType: type,
        payload: JSON.stringify({ run_id, ...payload }),
        payloadHash: hash,
      }).run();
    } catch (e: any) {
      if (String(e?.message ?? '').includes('UNIQUE')) {
        return c.json({ event_id: null, deduped: true });
      }
      throw e;
    }

    dispatchIngest(handle, inst, type, run_id, payload);
    return c.json({ event_id: id });
  });
  return r;
}
