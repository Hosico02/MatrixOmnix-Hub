import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import bcrypt from 'bcryptjs';
import { bearerAuth } from '../../src/hub/auth.js';

describe('bearerAuth', () => {
  const hash = bcrypt.hashSync('secret-token', 4);
  const instances = [{ id: 'inst-1', name: 'dev', tokenHash: hash }];

  function app() {
    const a = new Hono();
    a.use('*', bearerAuth(async (token) => {
      for (const i of instances) {
        if (bcrypt.compareSync(token, i.tokenHash)) return i;
      }
      return null;
    }));
    a.get('/ok', (c) => c.json({ instance: c.get('instance' as never) }));
    return a;
  }

  it('401 without header', async () => {
    const res = await app().request('/ok');
    expect(res.status).toBe(401);
  });

  it('401 with wrong token', async () => {
    const res = await app().request('/ok', {
      headers: { Authorization: 'Bearer wrong' },
    });
    expect(res.status).toBe(401);
  });

  it('200 with valid token, attaches instance', async () => {
    const res = await app().request('/ok', {
      headers: { Authorization: 'Bearer secret-token' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.instance.id).toBe('inst-1');
  });
});
