import type { IterationEvent, QACase } from '../core/types.js';

/**
 * Minimal in-memory frequency tracker for QA cases. The verifier-pivot
 * build no longer ships the full cross-iteration memory subsystem; this
 * stub exists so the QAAgent constructor seam continues to work for
 * tests and any in-process callers that want a fingerprint-frequency
 * counter without a persistence layer.
 */
export class MemoryAgent {
  private counts = new Map<string, number>();

  /** Record raw iteration events. No-op in the verifier build. */
  ingest(_events: IterationEvent[]): void {
    /* no-op */
  }

  /** Bump and return the case's frequency in this in-memory tracker. */
  bumpFrequency(c: QACase): QACase {
    const next = (this.counts.get(c.fingerprint) ?? 0) + 1;
    this.counts.set(c.fingerprint, next);
    return { ...c, frequency: Math.max(c.frequency ?? 0, next) };
  }
}
