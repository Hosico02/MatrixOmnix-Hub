import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import type { DbHandle } from './db/client.js';
import { d2pInstances } from './db/schema.js';
import type { InstanceLookup, InstanceInfo } from './auth.js';

export function makeInstanceLookup(handle: DbHandle): InstanceLookup {
  return async (token: string): Promise<InstanceInfo | null> => {
    const rows = handle.db.select().from(d2pInstances).all();
    for (const r of rows) {
      if (bcrypt.compareSync(token, r.tokenHash)) {
        handle.db.update(d2pInstances)
          .set({ lastSeenAt: new Date().toISOString() })
          .where(eq(d2pInstances.id, r.id))
          .run();
        return { id: r.id, name: r.name, tokenHash: r.tokenHash };
      }
    }
    return null;
  };
}
