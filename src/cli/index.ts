#!/usr/bin/env node
import { init } from './commands/init.js';
import { analyze } from './commands/analyze.js';
import { gap } from './commands/gap.js';
import { archetype } from './commands/archetype.js';
import { selfCheck } from './commands/selfCheck.js';
import { doctor } from './commands/doctor.js';
import { quickstart } from './commands/quickstart.js';
import { docsTruth } from './commands/docsTruth.js';
import { trustCheck, trustReport, trustExplain } from './commands/trust.js';
import { evidenceShow, evidenceExplain } from './commands/evidence.js';
import { standardsList, standardsExplain, standardsValidate } from './commands/standards.js';

interface ParsedArgs {
  command: string;
  flags: Record<string, string | boolean>;
  positional: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command = 'help', ...rest] = argv;
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        flags[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
      } else {
        const key = arg.slice(2);
        const next = rest[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = true;
        }
      }
    } else {
      positional.push(arg);
    }
  }
  return { command, flags, positional };
}

const HELP = `matrixomnix — the verifier for demo-to-product pipelines

Read-only inspector. Pair with a do-layer (d2p, Claude Code, custom) to produce
changes, then call matrixomnix verify (or the d2p-verify MCP server) for an
independent verdict.

Legacy alias: demo2project

Usage:
  matrixomnix <command> [--flags]
  d2p-verify                                      Start MCP stdio server

Core commands:
  init                                            Bootstrap config files
  doctor                                          Environment + config diagnose
  quickstart [--use-example]                      5-minute analyze/gap loop
  analyze     --project <path>                    ProjectSnapshot + ProjectScore
  gap         --project <path> [--fast|--no-verify]
                                                  GapReport; evidence verification by default
  archetype   --project <path>                    Detect project archetype
  trust:check --project <path>                    Repo trust + safety scan
  trust:report                                    Aggregated trust posture
  trust:explain                                   Explain a trust finding
  docs:truth  --project <path>                    README/docs vs reality
  self-check                                      Run analyze/gap on this repo
  evidence:show --project <path>                  Inspect evidence graph
  evidence:explain --node <id>                    Explain an evidence node
  standards:list / explain / validate

Removed commands:
  iterate, plan, long-run, autonomy:*, scenario:*, replay:*, regression:bisect,
  self-improve, governance:*, advisory agents, providers (RuleBasedExecutor,
  MiniMax, ClaudeCode, …) — MatrixOmnix is now a verifier only. Use d2p or
  any other do-layer to produce changes.

Help & info:
  --help                                          Show this message
`;

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  switch (args.command) {
    case 'init':
      return init(args.flags);
    case 'doctor':
      return doctor(args.flags);
    case 'quickstart':
    case 'demo':
      return quickstart(args.flags);
    case 'analyze':
      return analyze(args.flags);
    case 'gap':
      return gap(args.flags);
    case 'archetype':
      return archetype(args.flags);
    case 'trust:check':
      return trustCheck(args.flags);
    case 'trust:report':
      return trustReport(args.flags);
    case 'trust:explain':
      return trustExplain(args.flags);
    case 'docs:truth':
      return docsTruth(args.flags);
    case 'self-check':
      return selfCheck(args.flags);
    case 'evidence:show':
      return evidenceShow(args.flags);
    case 'evidence:explain':
      return evidenceExplain(args.flags);
    case 'standards:list':
      return standardsList(args.flags);
    case 'standards:explain':
      return standardsExplain(args.flags);
    case 'standards:validate':
      return standardsValidate(args.flags);
    case 'iterate':
    case 'plan':
    case 'long-run':
    case 'self-iterate':
    case 'self-iterate-sandbox':
    case 'compare-executors':
    case 'benchmark':
    case 'autonomy:run':
    case 'autonomy:policy':
    case 'autonomy:set-level':
    case 'scenario:run':
    case 'replay:create':
    case 'replay:run':
    case 'regression:bisect':
    case 'self:diagnose':
    case 'self:experiment':
      process.stderr.write(
        `matrixomnix ${args.command} has been removed.\n` +
        `MatrixOmnix is now a read-only verifier; use d2p (https://github.com/Hosico02/d2p)\n` +
        `or another do-layer to produce changes, then re-run matrixomnix gap / verify.\n`,
      );
      return 2;
    case 'help':
    case '--help':
    case '-h':
      process.stdout.write(HELP);
      return 0;
    default:
      process.stderr.write(`unknown command: ${args.command}\n\n${HELP}`);
      return 2;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`error: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
  });
