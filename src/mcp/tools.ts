// Type contracts for the d2p-verify MCP server tools. Validation happens
// via the JSON Schemas declared in server.ts; these interfaces describe
// what the tool implementations return.

export interface VerifyProjectArgs {
  path: string;
  archetype_hint?: string;
}

export interface DetectArchetypeArgs {
  path: string;
}

export interface VerifyProjectOutput {
  archetype: { id: string; confidence: number };
  score: number;
  verdict: 'pass' | 'needs_repair' | 'fail';
  findings: Array<{
    category: string;
    severity: string;
    message: string;
    suggested_fix?: string;
    evidence?: string;
  }>;
  evidence: {
    tests_run?: { passed: number; failed: number; output_excerpt: string };
    build_status?: 'pass' | 'fail' | 'not_run';
    type_check_status?: 'pass' | 'fail' | 'not_run';
  };
  qa_preflight: {
    active_cases: Array<{ fingerprint: string; frequency: number; last_seen: string }>;
  };
}

export interface DetectArchetypeOutput {
  primary: {
    id: string;
    confidence: number;
    detected_signals: string[];
    missing_signals: string[];
    recommended_standard: string;
    risk_profile: 'low' | 'medium' | 'high';
  };
  alternatives: Array<{ id: string; confidence: number }>;
}
