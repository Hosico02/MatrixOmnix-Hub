import { describe, it, expect } from 'vitest';
import { payloadHash } from '../../src/hub/ingest/payloadHash.js';

describe('payloadHash', () => {
  it('is deterministic for same payload', () => {
    const p = { foo: 1, bar: 'x' };
    expect(payloadHash(p)).toBe(payloadHash(p));
  });
  it('is key-order independent', () => {
    expect(payloadHash({ a: 1, b: 2 })).toBe(payloadHash({ b: 2, a: 1 }));
  });
  it('changes when payload changes', () => {
    expect(payloadHash({ a: 1 })).not.toBe(payloadHash({ a: 2 }));
  });
});
