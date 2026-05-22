#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { DetectArchetypeArgs, DetectArchetypeOutput, VerifyProjectArgs } from './tools.js';
import { detectArchetype } from '../core/projectArchetypeDetector.js';

const server = new Server(
  { name: 'd2p-verify', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'verify_project',
      description:
        'Run the full verifier on a project directory. Returns archetype, evidence-weighted score, verdict (pass/needs_repair/fail), gap findings sorted by severity, evidence summary and QA preflight warnings. Read-only; never modifies the project.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path to the project directory.' },
          archetype_hint: {
            type: 'string',
            description: 'Optional archetype id to bias detection (advisory only).',
          },
        },
        required: ['path'],
      },
    },
    {
      name: 'detect_archetype',
      description:
        'Detect the project archetype only (cheaper than verify_project). Returns the primary archetype with confidence, detected and missing signals, recommended standard, risk profile, and the top-3 alternatives.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path to the project directory.' },
        },
        required: ['path'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: rawArgs } = request.params;
  if (name === 'verify_project') {
    const args = rawArgs as unknown as VerifyProjectArgs;
    if (!args || typeof args.path !== 'string') throw new Error('verify_project requires { path: string }');
    const result = await runVerifyImpl(args.path, args.archetype_hint);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
  if (name === 'detect_archetype') {
    const args = rawArgs as unknown as DetectArchetypeArgs;
    if (!args || typeof args.path !== 'string') throw new Error('detect_archetype requires { path: string }');
    const result = await runDetectArchetypeImpl(args.path);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
  throw new Error(`Unknown tool: ${name}`);
});

// Implementation stubs — wired in Tasks 4 and 5.

export async function runDetectArchetypeImpl(projectPath: string): Promise<DetectArchetypeOutput> {
  const report = await detectArchetype(projectPath);
  return {
    primary: {
      id: String(report.primary.id),
      confidence: report.primary.confidence,
      detected_signals: report.primary.detected_signals,
      missing_signals: report.primary.missing_signals,
      recommended_standard: report.primary.recommended_standard,
      risk_profile: report.primary.risk_profile,
    },
    alternatives: report.alternatives.map((a) => ({ id: String(a.id), confidence: a.confidence })),
  };
}

export async function runVerifyImpl(_projectPath: string, _hint?: string): Promise<unknown> {
  throw new Error('verify_project not yet wired');
}

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Only start the server when run directly. Tests import the impl functions.
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    process.stderr.write(`d2p-verify fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
  });
}
