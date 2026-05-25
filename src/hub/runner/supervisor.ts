import { spawn, type ChildProcess } from 'node:child_process';
import { closeSync, createWriteStream, existsSync, mkdirSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { eq, isNull, and } from 'drizzle-orm';
import type { DbHandle } from '../db/client.js';
import { runs } from '../db/schema.js';

export interface SupervisorOpts {
  handle: DbHandle;
  dataDir: string;
  d2pPath: string;
}

export interface AcquireOpts {
  runId: string;
  projectPath: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface ActiveRun {
  runId: string;
  pid: number;
  child: ChildProcess;
  stdoutPath: string;
  projectPath: string;
  startedAt: number;
}

export class RunSupervisor {
  private active: ActiveRun | null = null;
  private logDir: string;
  constructor(private opts: SupervisorOpts) {
    this.logDir = join(opts.dataDir, 'runner-logs');
    if (!existsSync(this.logDir)) mkdirSync(this.logDir, { recursive: true });
  }

  current(): ActiveRun | null { return this.active; }

  acquire(req: AcquireOpts): ActiveRun {
    if (this.active) {
      throw new Error(`run already in flight: ${this.active.runId}`);
    }
    const stdoutPath = join(this.logDir, `${req.runId}.log`);
    // Touch the log file synchronously so callers can existsSync() immediately.
    closeSync(openSync(stdoutPath, 'a'));
    const stream = createWriteStream(stdoutPath, { flags: 'a' });
    // spawn (not exec) — argv form, no shell parsing, safe with arbitrary
    // path strings as long as we don't ourselves concatenate them.
    // Use a safe fallback cwd if projectPath doesn't exist to prevent
    // ENOENT from emitting on the child and crashing callers.
    const spawnCwd = existsSync(req.projectPath) ? req.projectPath : process.cwd();
    const child = spawn(req.command, req.args, {
      env: { ...req.env, D2P_RUN_ID: req.runId },
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: spawnCwd,
    });
    child.stdout?.pipe(stream, { end: false });
    child.stderr?.pipe(stream, { end: false });
    const ar: ActiveRun = {
      runId: req.runId, pid: child.pid ?? -1, child,
      stdoutPath, projectPath: req.projectPath,
      startedAt: Date.now(),
    };
    child.on('error', (err) => {
      stream.write(`\n[supervisor] spawn-error=${err.message}\n`);
      stream.end();
      this.markCrashedIfOrphan(req.runId);
      if (this.active?.runId === req.runId) this.active = null;
    });
    child.on('exit', (code) => {
      stream.write(`\n[supervisor] exit=${code}\n`);
      stream.end();
      this.markCrashedIfOrphan(req.runId);
      if (this.active?.runId === req.runId) this.active = null;
    });
    this.active = ar;
    return ar;
  }

  // If d2p exited without pushing a run_terminated event, the runs row's
  // terminal_state stays null forever — UI shows a perpetual RUNNING
  // ghost. Mark it `crashed` so the page can stop polling and the runs
  // list shows what actually happened.
  private markCrashedIfOrphan(runId: string): void {
    try {
      const row = this.opts.handle.db.select().from(runs)
        .where(eq(runs.id, runId)).get();
      if (!row) return;  // d2p never pushed run_started — nothing to mark
      if (row.terminalState != null) return;  // d2p finished cleanly
      this.opts.handle.db.update(runs).set({
        terminalState: 'crashed',
        terminatedAt: new Date().toISOString(),
      }).where(and(eq(runs.id, runId), isNull(runs.terminalState))).run();
    } catch {
      // Best-effort: a closing DB or schema mismatch shouldn't crash the
      // exit handler. Worst case the row stays as a RUNNING ghost.
    }
  }

  shutdown(): void {
    if (!this.active) return;
    try { this.active.child.kill('SIGTERM'); } catch { /* already gone */ }
    this.active = null;
  }
}
