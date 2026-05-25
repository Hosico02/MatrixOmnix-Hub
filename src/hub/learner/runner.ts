import type { DbHandle } from '../db/client.js';
import { r1PersistentFinding } from './rules/r1_persistent_finding.js';
import { r2CheckNeverFires } from './rules/r2_check_never_fires.js';
import { r3SeverityDrift } from './rules/r3_severity_drift.js';
import { r4ArchetypeDrift } from './rules/r4_archetype_drift.js';
import { r5RepeatedResidual } from './rules/r5_repeated_residual.js';
import { upsertCandidate } from './dedup.js';
import type { ProposalCandidate } from './types.js';

const RULES: Array<[string, (h: DbHandle) => Promise<ProposalCandidate[]>]> = [
  ['R1', r1PersistentFinding],
  ['R2', r2CheckNeverFires],
  ['R3', r3SeverityDrift],
  ['R4', r4ArchetypeDrift],
  ['R5', r5RepeatedResidual],
];

export interface RunOpts { disabledRules: Set<string> }

export async function runRulePass(handle: DbHandle, opts: RunOpts): Promise<number> {
  let created = 0;
  for (const [id, rule] of RULES) {
    if (opts.disabledRules.has(id)) continue;
    try {
      const cands = await rule(handle);
      for (const c of cands) {
        const newId = upsertCandidate(handle, c);
        if (newId) created++;
      }
    } catch (e) {
      process.stderr.write(`rule ${id} failed: ${e instanceof Error ? e.message : String(e)}\n`);
    }
  }
  return created;
}

let scheduledTimer: NodeJS.Timeout | null = null;
let pendingTrigger = false;
const DEBOUNCE_MS = 60_000;

export function debouncedRulePass(handle: DbHandle, opts: RunOpts): void {
  pendingTrigger = true;
  if (scheduledTimer) return;
  scheduledTimer = setTimeout(async () => {
    scheduledTimer = null;
    if (pendingTrigger) {
      pendingTrigger = false;
      await runRulePass(handle, opts);
    }
  }, DEBOUNCE_MS);
}
