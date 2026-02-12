/**
 * @module runners/pytest-runner
 * Pytest test runner implementation.
 *
 * Implements the {@link TestRunner} interface by spawning `pytest`
 * and parsing stdout/stderr into {@link TestEvent} entries.
 */

import { spawn } from 'node:child_process';
import type { TestRunner, RunConfig, TestEvent } from '../types.js';

/**
 * Pytest Python test runner.
 *
 * Executes tests via `pytest` in a child process with verbose output,
 * then parses the result lines to produce {@link TestEvent} entries.
 */
export class PytestRunner implements TestRunner {
  id = 'pytest';

  /**
   * Execute pytest tests.
   *
   * @param config - Run configuration
   * @param config.cwd - Working directory for pytest
   * @param config.target - Test file or directory (passed as argument to pytest)
   * @param config.env - Environment variables for the child process
   * @param config.timeout - Maximum run time in milliseconds
   * @yields {TestEvent} Test progress events
   */
  async *run(config: RunConfig): AsyncGenerator<TestEvent> {
    const suiteName = `pytest:${config.target}`;
    const suiteStart = Date.now();
    let passed = 0;
    let failed = 0;
    let skipped = 0;

    yield { type: 'suite_start', suite: suiteName, timestamp: Date.now() };

    const args = ['-v', '--tb=short', '--no-header'];
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

    const proc = spawn('pytest', args, {
      cwd: config.cwd,
      env: { ...process.env, ...config.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: config.timeout,
    });

    const processLine = (line: string) => {
      const trimmed = line.trim();

      // Detect PASSED lines: test_file.py::test_name PASSED
      const passMatch = trimmed.match(/^(.+?::.+?)\s+PASSED/);
      if (passMatch) {
        const testName = passMatch[1]!.trim();
        push({ type: 'case_start', suite: suiteName, name: testName, timestamp: Date.now() });
        push({ type: 'case_pass', suite: suiteName, name: testName, duration: 0, timestamp: Date.now() });
        passed++;
        return;
      }

      // Detect FAILED lines: test_file.py::test_name FAILED
      const failMatch = trimmed.match(/^(.+?::.+?)\s+FAILED/);
      if (failMatch) {
        const testName = failMatch[1]!.trim();
        push({ type: 'case_start', suite: suiteName, name: testName, timestamp: Date.now() });
        push({ type: 'case_fail', suite: suiteName, name: testName, error: 'Test failed', duration: 0, timestamp: Date.now() });
        failed++;
        return;
      }

      // Detect SKIPPED lines: test_file.py::test_name SKIPPED
      const skipMatch = trimmed.match(/^(.+?::.+?)\s+SKIPPED/);
      if (skipMatch) {
        const testName = skipMatch[1]!.trim();
        push({ type: 'case_skip', suite: suiteName, name: testName, timestamp: Date.now() });
        skipped++;
        return;
      }

      // Detect ERROR lines: ERROR test_file.py::test_name
      const errorMatch = trimmed.match(/^ERROR\s+(.+?::.+?)(?:\s|$)/);
      if (errorMatch) {
        const testName = errorMatch[1]!.trim();
        push({ type: 'case_start', suite: suiteName, name: testName, timestamp: Date.now() });
        push({ type: 'case_fail', suite: suiteName, name: testName, error: 'Test error', duration: 0, timestamp: Date.now() });
        failed++;
        return;
      }

      // Log all other non-empty output
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
          name: 'pytest-process',
          error: `pytest exited with code ${code}`,
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
        name: 'pytest-process',
        error: `Failed to spawn pytest: ${err.message}`,
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
   * Check if pytest is available.
   *
   * Attempts to run `pytest --version` to verify availability.
   *
   * @returns `true` if pytest is accessible
   */
  async available(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const proc = spawn('pytest', ['--version'], {
        stdio: 'ignore',
        timeout: 10_000,
      });
      proc.on('close', (code) => resolve(code === 0));
      proc.on('error', () => resolve(false));
    });
  }
}
