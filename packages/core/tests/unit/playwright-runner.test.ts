/**
 * Unit tests for PlaywrightRunner.
 *
 * Tests cover:
 * - JSON output parsing into TestEvent stream
 * - Nested suite title construction
 * - Error formatting with screenshots/traces
 * - Availability check
 * - Process failure handling (non-JSON output)
 * - Skipped test handling
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlaywrightRunner } from '../../src/runners/playwright-runner.js';
import type { TestEvent } from '../../src/types.js';

vi.mock('node:child_process', () => {
  const EventEmitter = require('node:events');

  function createMockProc(
    stdoutData: string,
    stderrData: string,
    exitCode: number,
  ) {
    const proc = new EventEmitter();
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    proc.stdout = stdout;
    proc.stderr = stderr;
    proc.stdin = null;

    setTimeout(() => {
      if (stdoutData) stdout.emit('data', Buffer.from(stdoutData));
      if (stderrData) stderr.emit('data', Buffer.from(stderrData));
      proc.emit('close', exitCode);
    }, 10);

    return proc;
  }

  return {
    spawn: vi.fn((_cmd: string, _args: string[]) => {
      return createMockProc('', '', 0);
    }),
  };
});

import { spawn } from 'node:child_process';

async function collectEvents(gen: AsyncGenerator<TestEvent>): Promise<TestEvent[]> {
  const events: TestEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

function mockPlaywrightOutput(report: unknown, exitCode = 0, stderr = '') {
  const EventEmitter = require('node:events');

  (spawn as ReturnType<typeof vi.fn>).mockImplementation(() => {
    const proc = new EventEmitter();
    const stdout = new EventEmitter();
    const stderrEmitter = new EventEmitter();
    proc.stdout = stdout;
    proc.stderr = stderrEmitter;
    proc.stdin = null;

    setTimeout(() => {
      stdout.emit('data', Buffer.from(JSON.stringify(report)));
      if (stderr) stderrEmitter.emit('data', Buffer.from(stderr));
      proc.emit('close', exitCode);
    }, 10);

    return proc;
  });
}

function mockPlaywrightRawOutput(stdout: string, exitCode = 1, stderr = '') {
  const EventEmitter = require('node:events');

  (spawn as ReturnType<typeof vi.fn>).mockImplementation(() => {
    const proc = new EventEmitter();
    const stdoutEmitter = new EventEmitter();
    const stderrEmitter = new EventEmitter();
    proc.stdout = stdoutEmitter;
    proc.stderr = stderrEmitter;
    proc.stdin = null;

    setTimeout(() => {
      if (stdout) stdoutEmitter.emit('data', Buffer.from(stdout));
      if (stderr) stderrEmitter.emit('data', Buffer.from(stderr));
      proc.emit('close', exitCode);
    }, 10);

    return proc;
  });
}

describe('PlaywrightRunner', () => {
  let runner: PlaywrightRunner;

  beforeEach(() => {
    runner = new PlaywrightRunner();
    vi.clearAllMocks();
  });

  it('has correct id', () => {
    expect(runner.id).toBe('playwright');
  });

  describe('run', () => {
    it('parses passing tests from JSON report', async () => {
      const report = {
        suites: [
          {
            title: 'login.spec.ts',
            specs: [
              {
                title: 'should log in with valid credentials',
                ok: true,
                tests: [
                  {
                    expectedStatus: 'passed',
                    status: 'expected',
                    results: [{ status: 'passed', duration: 1234 }],
                  },
                ],
              },
            ],
            suites: [],
          },
        ],
        errors: [],
      };

      mockPlaywrightOutput(report);

      const events = await collectEvents(
        runner.run({ cwd: '/tmp', target: 'tests/', env: {}, timeout: 30_000 }),
      );

      const passEvents = events.filter(e => e.type === 'case_pass');
      expect(passEvents).toHaveLength(1);
      expect(passEvents[0]!).toMatchObject({
        type: 'case_pass',
        name: expect.stringContaining('should log in with valid credentials'),
      });
    });

    it('parses failing tests with error details', async () => {
      const report = {
        suites: [
          {
            title: 'checkout.spec.ts',
            specs: [
              {
                title: 'should complete purchase',
                ok: false,
                tests: [
                  {
                    expectedStatus: 'passed',
                    status: 'unexpected',
                    results: [
                      {
                        status: 'failed',
                        duration: 5000,
                        error: {
                          message: 'Expected element to be visible',
                          snippet: 'await expect(page.locator(".cart")).toBeVisible()',
                        },
                        attachments: [
                          { name: 'screenshot', path: '/tmp/screenshot.png', contentType: 'image/png' },
                          { name: 'trace', path: '/tmp/trace.zip', contentType: 'application/zip' },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
            suites: [],
          },
        ],
        errors: [],
      };

      mockPlaywrightOutput(report, 1);

      const events = await collectEvents(
        runner.run({ cwd: '/tmp', target: 'tests/', env: {}, timeout: 30_000 }),
      );

      const failEvents = events.filter(e => e.type === 'case_fail');
      expect(failEvents).toHaveLength(1);

      const fail = failEvents[0] as Extract<TestEvent, { type: 'case_fail' }>;
      expect(fail.error).toContain('Expected element to be visible');
      expect(fail.error).toContain('/tmp/screenshot.png');
      expect(fail.error).toContain('/tmp/trace.zip');
    });

    it('parses skipped tests', async () => {
      const report = {
        suites: [
          {
            title: 'skipped.spec.ts',
            specs: [
              {
                title: 'this is skipped',
                ok: true,
                tests: [
                  {
                    expectedStatus: 'skipped',
                    status: 'skipped',
                    results: [{ status: 'skipped', duration: 0 }],
                  },
                ],
              },
            ],
            suites: [],
          },
        ],
        errors: [],
      };

      mockPlaywrightOutput(report);

      const events = await collectEvents(
        runner.run({ cwd: '/tmp', target: 'tests/', env: {}, timeout: 30_000 }),
      );

      const skipEvents = events.filter(e => e.type === 'case_skip');
      expect(skipEvents).toHaveLength(1);
    });

    it('handles nested suites with correct title construction', async () => {
      const report = {
        suites: [
          {
            title: 'auth',
            specs: [],
            suites: [
              {
                title: 'login',
                specs: [
                  {
                    title: 'should work',
                    ok: true,
                    tests: [
                      {
                        expectedStatus: 'passed',
                        status: 'expected',
                        results: [{ status: 'passed', duration: 100 }],
                      },
                    ],
                  },
                ],
                suites: [],
              },
            ],
          },
        ],
        errors: [],
      };

      mockPlaywrightOutput(report);

      const events = await collectEvents(
        runner.run({ cwd: '/tmp', target: '', env: {}, timeout: 30_000 }),
      );

      const passEvents = events.filter(e => e.type === 'case_pass');
      expect(passEvents).toHaveLength(1);
      expect((passEvents[0] as Extract<TestEvent, { type: 'case_pass' }>).name).toBe(
        'auth > login > should work',
      );
    });

    it('falls back to error event when JSON parsing fails', async () => {
      mockPlaywrightRawOutput('not json', 1, 'Some error output');

      const events = await collectEvents(
        runner.run({ cwd: '/tmp', target: 'tests/', env: {}, timeout: 30_000 }),
      );

      const failEvents = events.filter(e => e.type === 'case_fail');
      expect(failEvents).toHaveLength(1);
      expect(
        (failEvents[0] as Extract<TestEvent, { type: 'case_fail' }>).error,
      ).toContain('Some error output');
    });

    it('emits suite_start and suite_end events', async () => {
      const report = { suites: [], errors: [] };
      mockPlaywrightOutput(report);

      const events = await collectEvents(
        runner.run({ cwd: '/tmp', target: 'tests/', env: {}, timeout: 30_000 }),
      );

      expect(events[0]!.type).toBe('suite_start');
      expect(events[events.length - 1]!.type).toBe('suite_end');

      const suiteEnd = events[events.length - 1] as Extract<
        TestEvent,
        { type: 'suite_end' }
      >;
      expect(suiteEnd.passed).toBe(0);
      expect(suiteEnd.failed).toBe(0);
      expect(suiteEnd.skipped).toBe(0);
    });
  });

  describe('available', () => {
    it('returns true when playwright is installed', async () => {
      const EventEmitter = require('node:events');
      (spawn as ReturnType<typeof vi.fn>).mockImplementation(() => {
        const proc = new EventEmitter();
        setTimeout(() => proc.emit('close', 0), 10);
        return proc;
      });

      const result = await runner.available();
      expect(result).toBe(true);
    });

    it('returns false when playwright is not installed', async () => {
      const EventEmitter = require('node:events');
      (spawn as ReturnType<typeof vi.fn>).mockImplementation(() => {
        const proc = new EventEmitter();
        setTimeout(() => proc.emit('error', new Error('not found')), 10);
        return proc;
      });

      const result = await runner.available();
      expect(result).toBe(false);
    });
  });
});
