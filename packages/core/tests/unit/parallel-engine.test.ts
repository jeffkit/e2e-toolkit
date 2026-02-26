/**
 * Unit tests for ParallelSuiteExecutor.
 *
 * Tests cover:
 * - Concurrent execution (timing verification)
 * - Concurrency limit enforcement
 * - Variable context isolation (no cross-contamination)
 * - Event attribution correctness (suite names)
 * - Promise.allSettled behavior when one suite fails
 * - Streaming mode
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ParallelSuiteExecutor } from '../../src/parallel-engine.js';
import type { TestEvent, YAMLTestSuite, VariableContext } from '../../src/types.js';
import type { YAMLEngineOptions } from '../../src/yaml-engine.js';

vi.mock('../../src/yaml-engine.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/yaml-engine.js')>();
  return {
    ...original,
    executeYAMLSuite: vi.fn(),
  };
});

import { executeYAMLSuite } from '../../src/yaml-engine.js';

function makeSuite(name: string): YAMLTestSuite {
  return {
    name,
    cases: [{ name: `${name}-case-1`, request: { method: 'GET', path: '/test' } }],
  };
}

function makeOptions(overrides?: Partial<YAMLEngineOptions>): YAMLEngineOptions {
  return {
    baseUrl: 'http://localhost:3000',
    variables: {
      config: { key: 'original' },
      runtime: {},
      env: {},
    },
    ...overrides,
  };
}

describe('ParallelSuiteExecutor', () => {
  let executor: ParallelSuiteExecutor;

  beforeEach(() => {
    executor = new ParallelSuiteExecutor();
    vi.clearAllMocks();
  });

  describe('execute', () => {
    it('executes suites concurrently', async () => {
      const startTimes: number[] = [];

      const mockExecute = executeYAMLSuite as ReturnType<typeof vi.fn>;
      mockExecute.mockImplementation(async function* (suite: YAMLTestSuite) {
        startTimes.push(Date.now());
        await new Promise(resolve => setTimeout(resolve, 50));
        yield {
          type: 'suite_start' as const,
          suite: suite.name,
          timestamp: Date.now(),
        };
        yield {
          type: 'case_pass' as const,
          suite: suite.name,
          name: 'test',
          duration: 50,
          timestamp: Date.now(),
        };
        yield {
          type: 'suite_end' as const,
          suite: suite.name,
          passed: 1,
          failed: 0,
          skipped: 0,
          duration: 50,
          timestamp: Date.now(),
        };
      });

      const configs = [
        { suite: makeSuite('suite-a'), options: makeOptions() },
        { suite: makeSuite('suite-b'), options: makeOptions() },
        { suite: makeSuite('suite-c'), options: makeOptions() },
      ];

      const events = await executor.execute(configs);

      expect(events.length).toBeGreaterThanOrEqual(6);
      expect(mockExecute).toHaveBeenCalledTimes(3);

      // All suites should start roughly at the same time (within 100ms)
      if (startTimes.length >= 2) {
        const timeDiff = Math.abs(startTimes[startTimes.length - 1]! - startTimes[0]!);
        expect(timeDiff).toBeLessThan(100);
      }
    });

    it('enforces concurrency limit', async () => {
      let activeTasks = 0;
      let maxConcurrent = 0;

      const mockExecute = executeYAMLSuite as ReturnType<typeof vi.fn>;
      mockExecute.mockImplementation(async function* (suite: YAMLTestSuite) {
        activeTasks++;
        maxConcurrent = Math.max(maxConcurrent, activeTasks);
        await new Promise(resolve => setTimeout(resolve, 50));
        yield {
          type: 'suite_start' as const,
          suite: suite.name,
          timestamp: Date.now(),
        };
        yield {
          type: 'suite_end' as const,
          suite: suite.name,
          passed: 0,
          failed: 0,
          skipped: 0,
          duration: 50,
          timestamp: Date.now(),
        };
        activeTasks--;
      });

      const configs = [
        { suite: makeSuite('s1'), options: makeOptions() },
        { suite: makeSuite('s2'), options: makeOptions() },
        { suite: makeSuite('s3'), options: makeOptions() },
        { suite: makeSuite('s4'), options: makeOptions() },
      ];

      await executor.execute(configs, { concurrency: 2 });

      expect(maxConcurrent).toBeLessThanOrEqual(2);
      expect(mockExecute).toHaveBeenCalledTimes(4);
    });

    it('isolates variable contexts between suites', async () => {
      const capturedContexts: VariableContext[] = [];

      const mockExecute = executeYAMLSuite as ReturnType<typeof vi.fn>;
      mockExecute.mockImplementation(async function* (
        suite: YAMLTestSuite,
        options: YAMLEngineOptions,
      ) {
        capturedContexts.push(options.variables);
        options.variables.runtime['modified'] = suite.name;
        yield {
          type: 'suite_start' as const,
          suite: suite.name,
          timestamp: Date.now(),
        };
        yield {
          type: 'suite_end' as const,
          suite: suite.name,
          passed: 0,
          failed: 0,
          skipped: 0,
          duration: 0,
          timestamp: Date.now(),
        };
      });

      const sharedOptions = makeOptions();

      const configs = [
        { suite: makeSuite('a'), options: sharedOptions },
        { suite: makeSuite('b'), options: sharedOptions },
      ];

      await executor.execute(configs);

      expect(capturedContexts).toHaveLength(2);
      // Each suite should have received its own context object
      expect(capturedContexts[0]).not.toBe(capturedContexts[1]);
      // Original options should NOT be modified
      expect(sharedOptions.variables.runtime).not.toHaveProperty('modified');
    });

    it('correctly attributes events to their suites', async () => {
      const mockExecute = executeYAMLSuite as ReturnType<typeof vi.fn>;
      mockExecute.mockImplementation(async function* (suite: YAMLTestSuite) {
        yield { type: 'suite_start' as const, suite: suite.name, timestamp: Date.now() };
        yield {
          type: 'case_pass' as const,
          suite: suite.name,
          name: `test-in-${suite.name}`,
          duration: 10,
          timestamp: Date.now(),
        };
        yield {
          type: 'suite_end' as const,
          suite: suite.name,
          passed: 1,
          failed: 0,
          skipped: 0,
          duration: 10,
          timestamp: Date.now(),
        };
      });

      const configs = [
        { suite: makeSuite('alpha'), options: makeOptions() },
        { suite: makeSuite('beta'), options: makeOptions() },
      ];

      const events = await executor.execute(configs);

      const alphaEvents = events.filter(
        e => 'suite' in e && (e as { suite: string }).suite === 'alpha',
      );
      const betaEvents = events.filter(
        e => 'suite' in e && (e as { suite: string }).suite === 'beta',
      );

      expect(alphaEvents.length).toBeGreaterThanOrEqual(2);
      expect(betaEvents.length).toBeGreaterThanOrEqual(2);
    });

    it('handles suite execution failure gracefully', async () => {
      const mockExecute = executeYAMLSuite as ReturnType<typeof vi.fn>;

      let callCount = 0;
      mockExecute.mockImplementation(async function* (suite: YAMLTestSuite) {
        callCount++;
        if (callCount === 1) {
          throw new Error('Suite execution crashed');
        }
        yield {
          type: 'suite_start' as const,
          suite: suite.name,
          timestamp: Date.now(),
        };
        yield {
          type: 'suite_end' as const,
          suite: suite.name,
          passed: 0,
          failed: 0,
          skipped: 0,
          duration: 0,
          timestamp: Date.now(),
        };
      });

      const configs = [
        { suite: makeSuite('failing'), options: makeOptions() },
        { suite: makeSuite('passing'), options: makeOptions() },
      ];

      const events = await executor.execute(configs);

      const errorLogs = events.filter(
        e => e.type === 'log' && (e as Extract<TestEvent, { type: 'log' }>).level === 'error',
      );
      expect(errorLogs.length).toBeGreaterThanOrEqual(1);

      const passingEvents = events.filter(
        e => 'suite' in e && (e as { suite: string }).suite === 'passing',
      );
      expect(passingEvents.length).toBeGreaterThan(0);
    });
  });

  describe('stream', () => {
    it('yields events as they arrive from parallel suites', async () => {
      const mockExecute = executeYAMLSuite as ReturnType<typeof vi.fn>;
      mockExecute.mockImplementation(async function* (suite: YAMLTestSuite) {
        yield { type: 'suite_start' as const, suite: suite.name, timestamp: Date.now() };
        yield {
          type: 'case_pass' as const,
          suite: suite.name,
          name: 'test',
          duration: 10,
          timestamp: Date.now(),
        };
        yield {
          type: 'suite_end' as const,
          suite: suite.name,
          passed: 1,
          failed: 0,
          skipped: 0,
          duration: 10,
          timestamp: Date.now(),
        };
      });

      const configs = [
        { suite: makeSuite('s1'), options: makeOptions() },
        { suite: makeSuite('s2'), options: makeOptions() },
      ];

      const events: TestEvent[] = [];
      for await (const event of executor.stream(configs)) {
        events.push(event);
      }

      expect(events.length).toBeGreaterThanOrEqual(4);
      expect(events.some(e => e.type === 'suite_start')).toBe(true);
      expect(events.some(e => e.type === 'suite_end')).toBe(true);
    });
  });
});
