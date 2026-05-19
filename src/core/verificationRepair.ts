import type { AgentResult, AgentTask } from './types.js';
import { shortId } from '../utils/time.js';

export interface RepairTaskOptions {
  /** Number of times this exact verification command has failed in a row, including the current failure. */
  consecutiveFailures?: number;
  /** Prior fix attempts (summary + changed_files) so the model can avoid re-trying them. */
  priorAttempts?: Array<{ summary: string; changed_files: string[] }>;
}

export interface RootCauseHint {
  signature: string;
  message: string;
  hint: string;
  related_files: string[];
}

export function buildVerificationRepairTask(
  failedTask: AgentTask,
  result: AgentResult,
  options: RepairTaskOptions = {},
): AgentTask | null {
  const failedEvidence = result.verification_evidence.find((e) => !e.passed);
  if (!failedEvidence) return null;
  const combinedOutput = `${failedEvidence.stdout_summary}\n${failedEvidence.stderr_summary}`;
  const rootCauses = extractRootCauseHints(combinedOutput);
  const related = Array.from(new Set([
    ...result.changed_files,
    ...failedTask.expected_changed_files.filter((f) => f !== '(see suggested_fix)'),
    ...rootCauses.flatMap((rc) => rc.related_files),
    ...extractPaths(combinedOutput),
  ])).slice(0, 12);

  const consecutive = options.consecutiveFailures ?? 1;
  const priorAttempts = options.priorAttempts ?? [];
  const lines: string[] = [];

  if (consecutive >= 2) {
    lines.push(
      `**ESCALATION**: this exact command has now failed ${consecutive} times in a row. Previous repair attempts did NOT fix the root cause — do not repeat them.`,
      '',
    );
    if (priorAttempts.length > 0) {
      lines.push('Prior repair attempts (do not re-apply these as-is):');
      for (const attempt of priorAttempts.slice(-4)) {
        lines.push(`  - ${attempt.summary} (changed: ${attempt.changed_files.join(', ') || 'none'})`);
      }
      lines.push('');
    }
  }

  lines.push(
    `Previous task failed verification: ${failedTask.title}`,
    `Failed command: ${failedEvidence.command}`,
    `Failure reason: ${failedEvidence.failure_reason ?? 'non-zero exit'}`,
    '',
  );

  if (rootCauses.length > 0) {
    lines.push('Extracted root-cause signals (fix these specifically — do not guess generic causes like "missing package"):');
    for (const rc of rootCauses) {
      lines.push(`  - [${rc.signature}] ${rc.message}`);
      lines.push(`      hint: ${rc.hint}`);
      if (rc.related_files.length > 0) {
        lines.push(`      files: ${rc.related_files.join(', ')}`);
      }
    }
    lines.push('');
  }

  lines.push(
    'Diagnose before patching:',
    '  1. Read the file named in the error trace and confirm what is actually defined there.',
    '  2. Match the missing symbol/import against the test that requires it.',
    '  3. Decide whether to add the missing source symbol or correct the test reference — never blanket-skip failing tests.',
    '',
    'Fix the root cause of the failed verification before doing any unrelated productization work.',
    '',
    'Verification output:',
    truncate(combinedOutput, 3000),
  );

  return {
    id: shortId('task_repair'),
    iteration_id: failedTask.iteration_id,
    assigned_to: 'executor',
    title: `Repair failed verification: ${failedEvidence.command}`,
    description: lines.join('\n'),
    acceptance_criteria: [
      'the failed verification command exits 0',
      'the fix addresses the specific root-cause signature extracted above, not a guessed generic cause',
      'the fix does not weaken or delete tests, and does not re-apply prior failed attempts',
      'no unrelated productization work is bundled into the repair',
    ],
    expected_changed_files: related.length > 0 ? related : failedTask.expected_changed_files,
    verification_commands: [failedEvidence.command],
    priority: 'blocker',
    status: 'pending',
  };
}

/**
 * Parse common Python/Node failure signatures out of raw verification output.
 * Surfaces concrete symbol names and file paths instead of letting them get
 * lost in a 3000-char tail.
 */
export function extractRootCauseHints(text: string): RootCauseHint[] {
  const hints: RootCauseHint[] = [];
  const seen = new Set<string>();
  const add = (h: RootCauseHint) => {
    const key = `${h.signature}:${h.message}`;
    if (seen.has(key)) return;
    seen.add(key);
    hints.push(h);
  };

  for (const match of text.matchAll(/ImportError:\s*cannot import name\s+['"]([\w_]+)['"]\s+from\s+['"]?([\w_.]+)['"]?(?:\s*\(([^)]+)\))?/g)) {
    const [, symbol, moduleName, filePath] = match;
    const file = filePath ?? `${moduleName!.replace(/\./g, '/')}.py`;
    add({
      signature: 'python_import_name_missing',
      message: `'${symbol}' is not defined in module '${moduleName}' (${file ?? 'unknown'}).`,
      hint: `Open ${file} and confirm whether '${symbol}' was renamed, deleted, or never added. Either add it back with the shape the importer expects, or update every importer to use the new name. Do NOT install new packages — this is an in-repo symbol drift.`,
      related_files: [file ?? `${moduleName!.replace(/\./g, '/')}.py`].filter((f): f is string => Boolean(f)),
    });
  }

  for (const match of text.matchAll(/ModuleNotFoundError:\s*No module named\s+['"]([\w_.]+)['"]/g)) {
    const [, moduleName] = match;
    add({
      signature: 'python_module_not_found',
      message: `Module '${moduleName}' could not be imported.`,
      hint: `First check if '${moduleName}' is an in-repo file that needs to be added to sys.path or referenced via the correct package; only treat it as a missing pip dependency if no source file by that name exists in the repo.`,
      related_files: [`${moduleName!.replace(/\./g, '/')}.py`],
    });
  }

  for (const match of text.matchAll(/NameError:\s*name\s+['"]([\w_]+)['"]\s+is not defined/g)) {
    const [, symbol] = match;
    add({
      signature: 'python_name_error',
      message: `Name '${symbol}' is referenced but never imported or defined in the failing scope.`,
      hint: `Search the codebase for '${symbol}' to find where it should be defined or imported from. Add the missing import at the top of the failing file.`,
      related_files: [],
    });
  }

  for (const match of text.matchAll(/AttributeError:\s*module\s+['"]([\w_.]+)['"]\s+has no attribute\s+['"]([\w_]+)['"]/g)) {
    const [, moduleName, attr] = match;
    add({
      signature: 'python_attribute_missing',
      message: `Module '${moduleName}' has no attribute '${attr}'.`,
      hint: `Open ${moduleName!.replace(/\./g, '/')}.py and confirm whether '${attr}' was renamed or moved. Update either the source or the caller; do not install new packages.`,
      related_files: [`${moduleName!.replace(/\./g, '/')}.py`],
    });
  }

  for (const match of text.matchAll(/AttributeError:\s*['"]?([\w_]+)['"]?\s*object has no attribute\s+['"]([\w_]+)['"]/g)) {
    const [, owner, attr] = match;
    add({
      signature: 'python_object_attribute_missing',
      message: `${owner} instance has no attribute '${attr}'.`,
      hint: `Inspect where '${owner}' is constructed and confirm '${attr}' should exist there. The fix is usually a missing assignment or an outdated test that references a renamed field.`,
      related_files: [],
    });
  }

  if (/openai\.(?:OpenAIError|AuthenticationError|APIKeyError)|OPENAI_API_KEY is missing|api_key client option must be set/i.test(text)) {
    add({
      signature: 'openai_missing_credentials',
      message: 'OpenAI client construction failed because no API key is present.',
      hint: 'Make OpenAI client construction lazy (call openai.OpenAI() inside the function that uses it) or read os.environ.get("OPENAI_API_KEY") with a None-safe default. Do NOT add a real API key to source.',
      related_files: [],
    });
  }

  for (const match of text.matchAll(/(?:^|\n)\s*File\s+"([^"]+)",\s+line\s+(\d+)[\s\S]{0,200}?SyntaxError:\s*([^\n]+)/g)) {
    const [, file, lineNo, msg] = match;
    add({
      signature: 'python_syntax_error',
      message: `SyntaxError in ${file}:${lineNo}: ${msg!.trim()}`,
      hint: `Open ${file} at line ${lineNo} and fix the syntax. If the file was generated by a previous task, the generator probably produced invalid escapes or f-string content — fix the generator too.`,
      related_files: [file!],
    });
  }

  for (const match of text.matchAll(/Cannot find module\s+['"]([^'"]+)['"]/g)) {
    const [, moduleName] = match;
    add({
      signature: 'node_module_not_found',
      message: `Node could not resolve '${moduleName}'.`,
      hint: `If '${moduleName}' is a relative path the file is missing; if it is a bare name it is an unlisted dependency — check package.json before assuming.`,
      related_files: moduleName!.startsWith('.') ? [moduleName!.replace(/^\.\//, '')] : [],
    });
  }

  return hints.slice(0, 6);
}

function extractPaths(text: string): string[] {
  const out = new Set<string>();
  const pattern = /(?:^|[\s("'`])([A-Za-z0-9_./-]+\.(?:py|js|ts|tsx|jsx|json|toml|md|yml|yaml|txt|html|css|sh))(?::\d+)?/gm;
  for (const match of text.matchAll(pattern)) {
    const rel = match[1]?.replace(/^\.\//, '');
    if (rel && !rel.startsWith('/') && !rel.includes('..')) out.add(rel);
  }
  return Array.from(out);
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + `\n... [truncated, original ${text.length} chars]` : text;
}
