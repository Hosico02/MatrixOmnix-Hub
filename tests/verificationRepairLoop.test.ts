import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { SupervisorAgent } from '../src/agents/SupervisorAgent.js';
import type { AgentProvider, AgentContext } from '../src/agents/providers/AgentProvider.js';
import type { AgentResult, AgentTask } from '../src/core/types.js';

async function mkPythonDemo() {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'd2p-repair-loop-'));
  await fs.writeFile(path.join(dir, 'README.md'), '# Demo\n\n' + 'x'.repeat(420));
  await fs.writeFile(path.join(dir, '.gitignore'), '.env\n');
  await fs.writeFile(path.join(dir, 'pyproject.toml'), '[project]\nname = "repair-loop-demo"\n');
  await fs.writeFile(path.join(dir, 'requirements.txt'), 'pytest>=8\n');
  await fs.writeFile(path.join(dir, 'app.py'), 'def ok():\n    return True\n');
  return dir;
}

class FailingThenRepairingProvider implements AgentProvider {
  readonly name = 'failing-then-repairing';

  async runTask(task: AgentTask, ctx: AgentContext): Promise<AgentResult> {
    if (/Repair failed verification/.test(task.title)) {
      await fs.writeFile(path.join(ctx.project_path, 'tests', 'test_smoke.py'), 'def test_smoke():\n    assert True\n');
      return result(task, 'completed', 'repair made pytest pass', ['tests/test_smoke.py']);
    }
    await fs.mkdir(path.join(ctx.project_path, 'tests'), { recursive: true });
    await fs.writeFile(path.join(ctx.project_path, 'tests', 'test_smoke.py'), 'def test_smoke():\n    assert False\n');
    return result(task, 'failed', 'introduced failing pytest smoke test', ['tests/test_smoke.py']);
  }
}

function result(task: AgentTask, status: AgentResult['status'], summary: string, changed: string[]): AgentResult {
  return {
    task_id: task.id,
    agent: 'executor',
    status,
    summary,
    changed_files: changed,
    commands_run: task.verification_commands,
    verification_evidence: [],
    failures: status === 'failed' ? ['simulated provider failure'] : [],
    risks: [],
    next_steps: [],
  };
}

describe('failed verification repair loop', () => {
  it('creates and runs a repair task before continuing ordinary gap work', async () => {
    const project = await mkPythonDemo();
    const summaries = await new SupervisorAgent().iterate({
      projectPath: project,
      goal: 'project-ready',
      provider: new FailingThenRepairingProvider(),
      maxIterations: 1,
    });

    const summary = summaries[0]!;
    expect(summary.assigned_tasks.map((t) => t.title)).toContain('Repair failed verification: python3 -m pytest -q');
    expect(summary.executor_results.some((r) => r.summary === 'repair made pytest pass' && r.status === 'completed')).toBe(true);
    expect(summary.verification_results.some((r) => r.command === 'python3 -m pytest -q' && r.passed)).toBe(true);
    expect(summary.assigned_tasks.findIndex((t) => /Repair failed verification/.test(t.title))).toBe(1);
  });
});

import { extractRootCauseHints, buildVerificationRepairTask } from '../src/core/verificationRepair.js';

describe('extractRootCauseHints', () => {
  it('parses Python ImportError(cannot import name X from Y)', () => {
    const hints = extractRootCauseHints(
      "tests/test_smoke.py:3: in <module>\n    from prompts import PERSONALITIES\nE   ImportError: cannot import name 'PERSONALITIES' from 'prompts' (/repo/prompts.py)\n"
    );
    expect(hints.length).toBeGreaterThan(0);
    const h = hints.find((x) => x.signature === 'python_import_name_missing');
    expect(h).toBeDefined();
    expect(h!.message).toContain("'PERSONALITIES'");
    expect(h!.message).toContain("'prompts'");
    expect(h!.related_files).toContain('/repo/prompts.py');
    expect(h!.hint).toMatch(/Do NOT install new packages/);
  });

  it('parses ModuleNotFoundError separately from cannot-import-name', () => {
    const hints = extractRootCauseHints("ModuleNotFoundError: No module named 'foo_bar'");
    expect(hints.some((h) => h.signature === 'python_module_not_found' && h.message.includes("'foo_bar'"))).toBe(true);
  });

  it('parses openai missing credentials signature', () => {
    const hints = extractRootCauseHints('openai.OpenAIError: The api_key client option must be set');
    expect(hints.some((h) => h.signature === 'openai_missing_credentials')).toBe(true);
  });

  it('parses Python SyntaxError with file and line', () => {
    const hints = extractRootCauseHints('  File "tests/test_app.py", line 42\n    assert x == "y\\""\n              ^\nSyntaxError: invalid syntax');
    const h = hints.find((x) => x.signature === 'python_syntax_error');
    expect(h).toBeDefined();
    expect(h!.related_files).toContain('tests/test_app.py');
    expect(h!.message).toContain('42');
  });
});

describe('buildVerificationRepairTask escalation', () => {
  it('surfaces root-cause hints in the first repair task description', () => {
    const failedTask: AgentTask = {
      id: 't1', iteration_id: 'it1', assigned_to: 'executor',
      title: 'Add Python smoke tests', description: '', acceptance_criteria: [],
      expected_changed_files: ['tests/test_smoke.py'], verification_commands: ['python3 -m pytest -q'],
      priority: 'high', status: 'pending',
    };
    const result: AgentResult = {
      task_id: 't1', agent: 'executor', status: 'failed', summary: '', changed_files: ['tests/test_smoke.py'],
      commands_run: ['python3 -m pytest -q'],
      verification_evidence: [{
        command: 'python3 -m pytest -q', passed: false, exit_code: 1,
        stdout_summary: "ImportError: cannot import name 'PERSONALITIES' from 'prompts' (/repo/prompts.py)",
        stderr_summary: '', duration_ms: 10, failure_reason: 'exit_code_1',
      }],
      failures: [], risks: [], next_steps: [],
    };
    const repair = buildVerificationRepairTask(failedTask, result);
    expect(repair).not.toBeNull();
    expect(repair!.description).toMatch(/python_import_name_missing/);
    expect(repair!.description).toMatch(/PERSONALITIES/);
    expect(repair!.description).not.toMatch(/ESCALATION/);
  });

  it('marks ESCALATION and lists prior attempts when consecutiveFailures>=2', () => {
    const failedTask: AgentTask = {
      id: 't2', iteration_id: 'it2', assigned_to: 'executor',
      title: 'Add Python smoke tests', description: '', acceptance_criteria: [],
      expected_changed_files: [], verification_commands: ['python3 -m pytest -q'],
      priority: 'high', status: 'pending',
    };
    const result: AgentResult = {
      task_id: 't2', agent: 'executor', status: 'failed', summary: '', changed_files: [],
      commands_run: ['python3 -m pytest -q'],
      verification_evidence: [{
        command: 'python3 -m pytest -q', passed: false, exit_code: 1,
        stdout_summary: "ImportError: cannot import name 'X' from 'y' (/repo/y.py)",
        stderr_summary: '', duration_ms: 10, failure_reason: 'exit_code_1',
      }],
      failures: [], risks: [], next_steps: [],
    };
    const repair = buildVerificationRepairTask(failedTask, result, {
      consecutiveFailures: 2,
      priorAttempts: [
        { summary: 'guessed missing openai package', changed_files: ['requirements.txt'] },
      ],
    });
    expect(repair!.description).toMatch(/\*\*ESCALATION\*\*: this exact command has now failed 2 times/);
    expect(repair!.description).toMatch(/guessed missing openai package/);
    expect(repair!.description).toMatch(/Prior repair attempts/);
  });
});
