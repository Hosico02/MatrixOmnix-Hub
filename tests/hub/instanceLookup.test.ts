import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { openDb, migrate } from '../../src/hub/db/client.js';
import { d2pInstances } from '../../src/hub/db/schema.js';
import { makeInstanceLookup } from '../../src/hub/instanceLookup.js';

describe('instance lookup', () => {
  let handle: ReturnType<typeof openDb>;
  beforeEach(() => {
    const p = join(mkdtempSync(join(tmpdir(), 'il-')), 'h.db');
    handle = openDb(p);
    migrate(handle.sqlite);
    handle.db.insert(d2pInstances).values({
      id: randomUUID(), name: 'dev',
      tokenHash: bcrypt.hashSync('plaintext-token', 4),
    }).run();
  });

  it('returns instance for valid token', async () => {
    const lookup = makeInstanceLookup(handle);
    const i = await lookup('plaintext-token');
    expect(i?.name).toBe('dev');
  });

  it('returns null for unknown token', async () => {
    const lookup = makeInstanceLookup(handle);
    expect(await lookup('wrong')).toBeNull();
  });
});
