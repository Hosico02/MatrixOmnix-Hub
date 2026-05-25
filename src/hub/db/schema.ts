import { sqliteTable, text, integer, real, primaryKey, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const d2pInstances = sqliteTable('d2p_instances', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull(),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  lastSeenAt: text('last_seen_at'),
});

export const runs = sqliteTable('runs', {
  id: text('id').primaryKey(),
  instanceId: text('instance_id').notNull().references(() => d2pInstances.id),
  projectPath: text('project_path').notNull(),
  detectedArchetype: text('detected_archetype'),
  startedAt: text('started_at').notNull(),
  terminatedAt: text('terminated_at'),
  terminalState: text('terminal_state'),
  totalCostUsd: real('total_cost_usd').default(0),
  totalIterations: integer('total_iterations').default(0),
}, (t) => ({
  byInstanceTime: index('runs_instance_time').on(t.instanceId, t.startedAt),
  byArchetypeState: index('runs_archetype_state').on(t.detectedArchetype, t.terminalState),
}));

export const iterations = sqliteTable('iterations', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull().references(() => runs.id),
  iterN: integer('iter_n').notNull(),
  startedAt: text('started_at').notNull(),
  endedAt: text('ended_at'),
  analyzerSummary: text('analyzer_summary'),
  plannerSummary: text('planner_summary'),
  executorSummary: text('executor_summary'),
  qaSummary: text('qa_summary'),
}, (t) => ({
  byRun: index('iter_by_run').on(t.runId, t.iterN),
}));

export const standards = sqliteTable('standards', {
  id: text('id').primaryKey(),
  archetype: text('archetype').notNull(),
  version: integer('version').notNull(),
  bodyMd: text('body_md').notNull(),
  isCurrent: integer('is_current', { mode: 'boolean' }).notNull(),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  approvedBy: text('approved_by'),
  source: text('source').notNull(),
}, (t) => ({
  byArchetypeCurrent: index('standards_arche_current').on(t.archetype, t.isCurrent),
}));

export const standardVersions = sqliteTable('standard_versions', {
  id: text('id').primaryKey(),
  standardsId: text('standards_id').notNull().references(() => standards.id),
  version: integer('version').notNull(),
  bodyMd: text('body_md').notNull(),
  diffFromPrevMd: text('diff_from_prev_md'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const verdicts = sqliteTable('verdicts', {
  id: text('id').primaryKey(),
  iterationId: text('iteration_id').notNull().references(() => iterations.id),
  verdict: text('verdict').notNull(),
  confidence: real('confidence'),
  stabilitySignal: text('stability_signal'),
  suggestedNextFocus: text('suggested_next_focus'),
  rawResponse: text('raw_response'),
  standardsVersionId: text('standards_version_id').references(() => standardVersions.id),
});

export const findings = sqliteTable('findings', {
  id: text('id').primaryKey(),
  verdictId: text('verdict_id').notNull().references(() => verdicts.id),
  category: text('category').notNull(),
  severity: text('severity').notNull(),
  message: text('message'),
  evidence: text('evidence'),
  isNew: integer('is_new', { mode: 'boolean' }).notNull(),
}, (t) => ({
  byCatSev: index('findings_cat_sev').on(t.category, t.severity),
  byVerdict: index('findings_by_verdict').on(t.verdictId),
}));

export const proposals = sqliteTable('proposals', {
  id: text('id').primaryKey(),
  archetype: text('archetype').notNull(),
  proposalType: text('proposal_type').notNull(),
  bodyMd: text('body_md').notNull(),
  rationaleMd: text('rationale_md').notNull(),
  source: text('source').notNull(),
  status: text('status').notNull().default('pending'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  decidedAt: text('decided_at'),
  decidedBy: text('decided_by'),
  resultingStandardVersionId: text('resulting_standard_version_id')
    .references(() => standardVersions.id),
}, (t) => ({
  byStatusArchetype: index('proposals_status_arche').on(t.status, t.archetype),
}));

export const proposalEvidence = sqliteTable('proposal_evidence', {
  proposalId: text('proposal_id').notNull().references(() => proposals.id),
  findingId: text('finding_id').notNull().references(() => findings.id),
}, (t) => ({
  pk: primaryKey({ columns: [t.proposalId, t.findingId] }),
}));

export const mentorNotes = sqliteTable('mentor_notes', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull().references(() => runs.id),
  author: text('author').notNull(),
  bodyMd: text('body_md').notNull(),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const events = sqliteTable('events', {
  id: text('id').primaryKey(),
  instanceId: text('instance_id').notNull().references(() => d2pInstances.id),
  eventType: text('event_type').notNull(),
  payload: text('payload').notNull(),
  payloadHash: text('payload_hash').notNull(),
  receivedAt: text('received_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => ({
  byTime: index('events_time').on(t.receivedAt),
  uniqDedup: uniqueIndex('events_dedup').on(t.instanceId, t.eventType, t.payloadHash),
}));
