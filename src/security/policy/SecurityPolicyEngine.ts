import path from 'node:path';
import { readJsonSafe, writeJson } from '../../utils/json.js';
import { ensureDir } from '../../utils/fs.js';
import type { SecurityPolicy, PolicyAction } from './PolicySchema.js';
import { evaluate, newRequest } from './PolicyEvaluator.js';
import type { PolicyRequest, PolicyDecision } from './PolicyEvaluator.js';
import { fromDecision, record as recordViolation } from './PolicyViolation.js';
import type { PolicyViolation } from './PolicyViolation.js';
// AuditLog removed in the verifier pivot (governance/ subsystem was do-layer
// surface). Policy decisions are still computed and returned to the caller;
// the audit-trail side effect is now the caller's responsibility.
async function auditAppend(_systemRoot: string, _entry: unknown): Promise<void> {
  /* no-op */
}

const POLICY_FILE = 'config/security-policy.json';

let cachedPolicy: SecurityPolicy | null = null;
let cachedRoot: string | null = null;

export async function loadSecurityPolicy(systemRoot: string): Promise<SecurityPolicy> {
  if (cachedPolicy && cachedRoot === systemRoot) return cachedPolicy;
  const p = path.join(systemRoot, POLICY_FILE);
  const raw = await readJsonSafe<SecurityPolicy>(p);
  if (raw) {
    cachedPolicy = raw;
    cachedRoot = systemRoot;
    return raw;
  }
  // fallback to bundled default
  const def = await readJsonSafe<SecurityPolicy>(path.join(systemRoot, 'dist', 'security', 'policy', 'default-security-policy.json'))
    ?? await readJsonSafe<SecurityPolicy>(path.join(systemRoot, 'src', 'security', 'policy', 'default-security-policy.json'));
  if (!def) throw new Error('default security policy not found');
  cachedPolicy = def;
  cachedRoot = systemRoot;
  return def;
}

export async function saveSecurityPolicy(systemRoot: string, p: SecurityPolicy): Promise<string> {
  const file = path.join(systemRoot, POLICY_FILE);
  await ensureDir(path.dirname(file));
  await writeJson(file, p);
  cachedPolicy = null;
  return file;
}

export async function ensurePolicyFile(systemRoot: string): Promise<string> {
  const p = await loadSecurityPolicy(systemRoot);
  return saveSecurityPolicy(systemRoot, p);
}

export interface EngineCheckResult {
  decision: PolicyDecision;
  violation: PolicyViolation | null;
}

export async function check(
  systemRoot: string,
  partial: Partial<PolicyRequest> & { action: PolicyAction; actor: string },
): Promise<EngineCheckResult> {
  const policy = await loadSecurityPolicy(systemRoot);
  const req = newRequest(partial);
  const decision = evaluate(policy, req);
  let violation: PolicyViolation | null = null;
  if (decision.decision === 'deny' || decision.decision === 'require_approval') {
    violation = fromDecision(req, decision);
    if (violation && partial.project_path) {
      await recordViolation(partial.project_path, violation);
    }
    await auditAppend(systemRoot, {
      actor: req.actor,
      action: `policy:${req.action}`,
      target: req.target_path ?? req.command ?? req.network_target ?? '',
      decision: decision.decision,
      risk_level: decision.risk_level,
      policy_decision_id: decision.request_id,
      metadata: { matched_rules: decision.matched_rules, reason: decision.reason },
    });
  }
  return { decision, violation };
}

export function validate(policy: SecurityPolicy): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!policy.version) errors.push('missing version');
  if (!Array.isArray(policy.rules)) errors.push('rules must be an array');
  for (const r of policy.rules ?? []) {
    if (!r.id) errors.push(`rule missing id`);
    if (!r.action) errors.push(`rule ${r.id} missing action`);
    if (!r.decision) errors.push(`rule ${r.id} missing decision`);
  }
  return { ok: errors.length === 0, errors };
}

export function explainAction(policy: SecurityPolicy, action: PolicyAction): {
  action: PolicyAction;
  rules: { id: string; decision: string; reason: string }[];
  default_decision: string;
} {
  return {
    action,
    rules: policy.rules.filter((r) => r.action === action || r.action === '*').map((r) => ({ id: r.id, decision: r.decision, reason: r.reason })),
    default_decision: policy.default_decision,
  };
}
