/**
 * @module runners/exec-runner
 * Generic command execution test runner.
 *
 * Implements the {@link TestRunner} interface by executing an arbitrary
 * command via the system shell and interpreting the exit code.
 *
 * Differs from {@link ShellRunner} in that it runs the `target` string
 * as a shell command directly (not as a bash script file path).
 */

import { spawn } from 'node:child_process';
import type { TestRunner, RunConfig, TestEvent } from '../types.js';

/**
 * Exec runner — runs an arbitrary command string via `sh -c`.
 *
 * The `target` field in {@link RunConfig} is treated as the command
 * to execute (e.g. `"npm test"`, `"curl http://localhost:3000"`).
 */
export class ExecRunner implements TestRunner {
  id = 'exec';

  /**
   * Execute a command and yield test events.
   *
   * @param config - Run configuration
   * @param config.target - Command string to execute
   * @param config.cwd - Working directory
   * @param config.env - Environment variables
   * @param config.timeout - Maximum execution time in milliseconds
   * @yields {TestEvent} Test progress events
   */
  async *run(config: RunConfig): AsyncGenerator<TestEvent> {
    const suiteName = `exec:${config.target}`;
    const suiteStart = Date.now();
    let passed = 0;
    let failed = 0;
    const skipped = 0;

    yield { type: 'suite_start', suite: suiteName, timestamp: Date.now() };

    const caseStart = Date.now();
    const caseName = config.target;

    yield { type: 'case_start', suite: suiteName, name: caseName, timestamp: Date.now() };

    const events: TestEvent[] = [];
    let done = false;
    let resolveWait: (() => void) | null = null;

    const push = (event: TestEvent) => {
      events.push(event);
      if (resolveWait) {
        resolveWait();
        resolveWait = null;
      }
    };

    const proc = spawn('sh', ['-c', config.target], {
      cwd: config.cwd,
      env: { ...process.env, ...config.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: config.timeout,
    });

    let stdoutBuffer = '';
    let stderrBuffer = '';

    proc.stdout.on('data', (data: Buffer) => {
      stdoutBuffer += data.toString();
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) {
          push({ type: 'log', level: 'info', message: line, timestamp: Date.now() });
        }
      }
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderrBuffer += data.toString();
      const lines = stderrBuffer.split('\n');
      stderrBuffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) {
          push({ type: 'log', level: 'error', message: line, timestamp: Date.now() });
        }
      }
    });

    proc.on('close', (code) => {
      // Flush remaining buffers
      if (stdoutBuffer.trim()) {
        push({ type: 'log', level: 'info', message: stdoutBuffer.trim(), timestamp: Date.now() });
      }
      if (stderrBuffer.trim()) {
        push({ type: 'log', level: 'error', message: stderrBuffer.trim(), timestamp: Date.now() });
      }

      const duration = Date.now() - caseStart;

      if (code === 0) {
        passed++;
        push({ type: 'case_pass', suite: suiteName, name: caseName, duration, timestamp: Date.now() });
      } else {
        failed++;
        push({
          type: 'case_fail',
          suite: suiteName,
          name: caseName,
          error: `Command exited with code ${code}`,
          duration,
          timestamp: Date.now(),
        });
      }

      done = true;
      if (resolveWait) {
        resolveWait();
        resolveWait = null;
      }
    });

    proc.on('error', (err) => {
      failed++;
      push({
        type: 'case_fail',
        suite: suiteName,
        name: caseName,
        error: `Failed to spawn command: ${err.message}`,
        duration: Date.now() - caseStart,
        timestamp: Date.now(),
      });
      done = true;
      if (resolveWait) {
        resolveWait();
        resolveWait = null;
      }
    });

    while (!done || events.length > 0) {
      if (events.length > 0) {
        yield events.shift()!;
      } else {
        await new Promise<void>((resolve) => {
          resolveWait = resolve;
          setTimeout(resolve, 1000);
        });
      }
    }

    yield {
      type: 'suite_end',
      suite: suiteName,
      passed,
      failed,
      skipped,
      duration: Date.now() - suiteStart,
      timestamp: Date.now(),
    };
  }

  /**
   * Check if the exec runner is available.
   * Always returns `true` since `sh` is universally available.
   */
  async available(): Promise<boolean> {
    return true;
  }
}
