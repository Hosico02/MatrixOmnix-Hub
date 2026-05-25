import type { DbHandle } from '../db/client.js';
import type { InstanceInfo } from '../auth.js';

export function dispatchIngest(
  _handle: DbHandle, _inst: InstanceInfo,
  _type: string, _runId: string, _payload: Record<string, any>,
): void {
  // wired per-event-type in Task 2.3
}
