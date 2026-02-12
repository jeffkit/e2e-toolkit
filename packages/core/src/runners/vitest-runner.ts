/**
 * @module runners/vitest-runner
 * Vitest test runner implementation.
 *
 * Implements the {@link TestRunner} interface by spawning `npx vitest run`
 * and parsing stdout/stderr into {@link TestEvent} entries.
 */

import { spawn } from 'node:child_process';
import type { TestRunner, RunConfig, TestEvent } from '../types.js';

/**
 * Vitest JavaScript/TypeScript test runner.
 *
 * Executes tests via `npx vitest run` in a child process.
 * Parses output lines to produce simplified {@link TestEvent} entries.
 */
export class VitestRunner implements TestRunner {
  id = 'vitest';

  /**
   * Execute Vitest tests.
   *
   * @param config - Run configuration
   * @param config.cwd - Working directory for Vitest
   * @param config.target - Test file or directory (passed as argument to vitest)
   * @param config.env - Environment variables for the child process
   * @param config.timeout - Maximum run time in milliseconds
   * @yields {TestEvent} Test progress events
   */
  async *run(config: RunConfig): AsyncGenerator<TestEvent> {
    const suiteName = `vitest:${config.target}`;
    const suiteStart = Date.now();
    let passed = 0;
    let failed = 0;
    const skipped = 0;

    yield { type: 'suite_start', suite: suiteName, timestamp: Date.now() };

    const args = ['vitest', 'run', '--reporter=verbose'];
    if (config.target) {
      args.push(config.target);
    }

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

    const proc = spawn('npx', args, {
      cwd: config.cwd,
      env: { ...process.env, ...config.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: config.timeout,
    });

    const processLine = (line: string) => {
      const trimmed = line.trim();

      // Detect pass/fail patterns from Vitest verbose output
      // ✓ test name (duration)
      const passMatch = trimmed.match(/^[✓√✔]\s+(.+?)(?:\s+\(\d+\s*m?s\))?$/);
      if (passMatch) {
        const testName = passMatch[1]!.trim();
        push({ type: 'case_start', suite: suiteName, name: testName, timestamp: Date.now() });
        push({ type: 'case_pass', suite: suiteName, name: testName, duration: 0, timestamp: Date.now() });
        passed++;
        return;
      }

      // × test name or ✗ test name
      const failMatch = trimmed.match(/^[×✗✘x]\s+(.+?)(?:\s+\(\d+\s*m?s\))?$/);
      if (failMatch) {
        const testName = failMatch[1]!.trim();
        push({ type: 'case_start', suite: suiteName, name: testName, timestamp: Date.now() });
        push({ type: 'case_fail', suite: suiteName, name: testName, error: 'Test failed', duration: 0, timestamp: Date.now() });
        failed++;
        return;
      }

      // Log all other output
      if (trimmed) {
        push({ type: 'log', level: 'info', message: trimmed, timestamp: Date.now() });
      }
    };

    let stdoutBuffer = '';
    let stderrBuffer = '';

    proc.stdout.on('data', (data: Buffer) => {
      stdoutBuffer += data.toString();
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() ?? '';
      for (const line of lines) {
        processLine(line);
      }
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderrBuffer += data.toString();
      const lines = stderrBuffer.split('\n');
      stderrBuffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) {
          push({ type: 'log', level: 'error', message: line.trim(), timestamp: Date.now() });
        }
      }
    });

    proc.on('close', (code) => {
      // Process remaining buffers
      if (stdoutBuffer.trim()) processLine(stdoutBuffer);
      if (stderrBuffer.trim()) {
        push({ type: 'log', level: 'error', message: stderrBuffer.trim(), timestamp: Date.now() });
      }

      if (code !== 0 && failed === 0) {
        // The process failed but we didn't detect any individual test failures
        failed++;
        push({
          type: 'case_fail',
          suite: suiteName,
          name: 'vitest-process',
          error: `Vitest exited with code ${code}`,
          duration: 0,
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
        name: 'vitest-process',
        error: `Failed to spawn vitest: ${err.message}`,
        duration: 0,
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
   * Check if Vitest is available.
   *
   * Attempts to run `npx vitest --version` to verify availability.
   *
   * @returns `true` if vitest is accessible
   */
  async available(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const proc = spawn('npx', ['vitest', '--version'], {
        stdio: 'ignore',
        timeout: 10_000,
      });
      proc.on('close', (code) => resolve(code === 0));
      proc.on('error', () => resolve(false));
    });
  }
}
