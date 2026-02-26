/**
 * Unit tests for FlakyDetector.
 * Tests: all 5 stability levels with exact threshold boundaries,
 * insufficient data fallback, suggestion text, analyzeAll with
 * filtering and sorting, empty history.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { FlakyDetector } from '../../../src/history/flaky-detector.js';
import { MemoryHistoryStore } from '../../../src/history/memory-history-store.js';
import type { TestRunRecord, TestCaseRunRecord } from '../../../src/history/types.js';

function makeRun(id: string, project: string, ts: number): TestRunRecord {
  return {
    id, project, timestamp: ts, gitCommit: null, gitBranch: null,
    configHash: 'sha256:test', trigger: 'cli', duration: 1000,
    passed: 1, failed: 0, skipped: 0, flaky: 0, status: 'passed',
  };
}

function makeCase(runId: string, caseName: string, status: 'passed' | 'failed' | 'skipped', suiteId = 'suite-a'): TestCaseRunRecord {
  return {
    id: `case-${runId}-${caseName}-${Math.random().toString(36).slice(2, 6)}`,
    runId, suiteId, caseName, status, duration: 100,
    attempts: 1, responseMs: null, assertions: null, error: null, snapshot: null,
  };
}

let seedCounter = 0;

function seedHistory(
  store: MemoryHistoryStore,
  caseName: string,
  statuses: Array<'passed' | 'failed' | 'skipped'>,
  project = 'test-project',
  suiteId = 'suite-a',
): void {
  const now = Date.now();
  const prefix = seedCounter++;
  for (let i = 0; i < statuses.length; i++) {
    const runId = `run-${prefix}-${i}`;
    const run = makeRun(runId, project, now + prefix * 100000 + i * 1000);
    const caseRecord = makeCase(run.id, caseName, statuses[i]!, suiteId);
    store.saveRun(run, [caseRecord]);
  }
}

describe('FlakyDetector', () => {
  let store: MemoryHistoryStore;
  let detector: FlakyDetector;

  beforeEach(() => {
    store = new MemoryHistoryStore();
    detector = new FlakyDetector(store, 10);
  });

  describe('stability levels', () => {
    it('should classify score=0 as STABLE', () => {
      seedHistory(store, 'test-stable', ['passed', 'passed', 'passed', 'passed', 'passed']);
      const result = detector.analyze('test-stable', 'test-project');
      expect(result.level).toBe('STABLE');
      expect(result.score).toBe(0);
      expect(result.isFlaky).toBe(false);
      expect(result.failCount).toBe(0);
      expect(result.totalRuns).toBe(5);
    });

    it('should classify score=0.1 as MOSTLY_STABLE', () => {
      // 1 fail out of 10
      seedHistory(store, 'test-ms', [
        'passed', 'passed', 'passed', 'passed', 'passed',
        'passed', 'passed', 'passed', 'passed', 'failed',
      ]);
      const result = detector.analyze('test-ms', 'test-project');
      expect(result.level).toBe('MOSTLY_STABLE');
      expect(result.score).toBeCloseTo(0.1);
      expect(result.isFlaky).toBe(true);
    });

    it('should classify score=0.2 as MOSTLY_STABLE (boundary)', () => {
      // 2 fail out of 10
      seedHistory(store, 'test-boundary', [
        'passed', 'passed', 'passed', 'passed', 'passed',
        'passed', 'passed', 'passed', 'failed', 'failed',
      ]);
      const result = detector.analyze('test-boundary', 'test-project');
      expect(result.level).toBe('MOSTLY_STABLE');
      expect(result.score).toBeCloseTo(0.2);
    });

    it('should classify score=0.3 as FLAKY', () => {
      // 3 fail out of 10
      seedHistory(store, 'test-flaky', [
        'passed', 'passed', 'passed', 'passed', 'passed',
        'passed', 'passed', 'failed', 'failed', 'failed',
      ]);
      const result = detector.analyze('test-flaky', 'test-project');
      expect(result.level).toBe('FLAKY');
      expect(result.score).toBeCloseTo(0.3);
      expect(result.isFlaky).toBe(true);
    });

    it('should classify score=0.5 as FLAKY (boundary)', () => {
      // 5 fail out of 10
      seedHistory(store, 'test-half', [
        'passed', 'failed', 'passed', 'failed', 'passed',
        'failed', 'passed', 'failed', 'passed', 'failed',
      ]);
      const result = detector.analyze('test-half', 'test-project');
      expect(result.level).toBe('FLAKY');
      expect(result.score).toBeCloseTo(0.5);
    });

    it('should classify score=0.7 as VERY_FLAKY', () => {
      // 7 fail out of 10
      seedHistory(store, 'test-vf', [
        'failed', 'failed', 'failed', 'failed', 'failed',
        'failed', 'failed', 'passed', 'passed', 'passed',
      ]);
      const result = detector.analyze('test-vf', 'test-project');
      expect(result.level).toBe('VERY_FLAKY');
      expect(result.score).toBeCloseTo(0.7);
      expect(result.isFlaky).toBe(true);
    });

    it('should classify score=1.0 as BROKEN', () => {
      seedHistory(store, 'test-broken', [
        'failed', 'failed', 'failed', 'failed', 'failed',
      ]);
      const result = detector.analyze('test-broken', 'test-project');
      expect(result.level).toBe('BROKEN');
      expect(result.score).toBe(1.0);
      expect(result.isFlaky).toBe(false);
      expect(result.failCount).toBe(5);
      expect(result.totalRuns).toBe(5);
    });
  });

  describe('insufficient data', () => {
    it('should return STABLE for 0 history runs', () => {
      const result = detector.analyze('no-history', 'test-project');
      expect(result.level).toBe('STABLE');
      expect(result.isFlaky).toBe(false);
      expect(result.totalRuns).toBe(0);
      expect(result.suggestion).toContain('Insufficient');
    });

    it('should return STABLE for 1 history run', () => {
      seedHistory(store, 'one-run', ['failed']);
      const result = detector.analyze('one-run', 'test-project');
      expect(result.level).toBe('STABLE');
      expect(result.isFlaky).toBe(false);
      expect(result.totalRuns).toBe(1);
    });
  });

  describe('suggestion text', () => {
    it('should generate appropriate suggestion for STABLE', () => {
      seedHistory(store, 'test-s', ['passed', 'passed']);
      const result = detector.analyze('test-s', 'test-project');
      expect(result.suggestion).toContain('stable');
    });

    it('should generate appropriate suggestion for BROKEN', () => {
      seedHistory(store, 'test-b', ['failed', 'failed', 'failed']);
      const result = detector.analyze('test-b', 'test-project');
      expect(result.suggestion).toContain('bug');
    });

    it('should include failure rate in suggestion for FLAKY', () => {
      seedHistory(store, 'test-f', ['passed', 'failed', 'passed', 'failed', 'passed']);
      const result = detector.analyze('test-f', 'test-project');
      expect(result.suggestion).toMatch(/\d+%/);
    });
  });

  describe('analyzeAll', () => {
    it('should return all cases sorted by score descending', () => {
      seedHistory(store, 'stable-test', ['passed', 'passed', 'passed']);
      seedHistory(store, 'flaky-test', ['passed', 'failed', 'passed']);
      seedHistory(store, 'broken-test', ['failed', 'failed', 'failed']);

      const results = detector.analyzeAll('test-project');
      expect(results.length).toBe(3);
      expect(results[0]!.caseName).toBe('broken-test');
      expect(results[2]!.caseName).toBe('stable-test');
    });

    it('should filter by minScore', () => {
      seedHistory(store, 'stable-test', ['passed', 'passed', 'passed']);
      seedHistory(store, 'flaky-test', ['passed', 'failed', 'failed']);

      const results = detector.analyzeAll('test-project', { minScore: 0.5 });
      expect(results.length).toBe(1);
      expect(results[0]!.caseName).toBe('flaky-test');
    });

    it('should limit by topN', () => {
      for (let i = 0; i < 10; i++) {
        seedHistory(store, `test-${i}`, ['passed', 'failed']);
      }

      const results = detector.analyzeAll('test-project', { topN: 3 });
      expect(results.length).toBe(3);
    });

    it('should filter by suiteId', () => {
      seedHistory(store, 'test-a', ['passed', 'failed'], 'test-project', 'suite-a');
      seedHistory(store, 'test-b', ['passed', 'failed'], 'test-project', 'suite-b');

      const results = detector.analyzeAll('test-project', { suiteId: 'suite-a' });
      expect(results.length).toBe(1);
      expect(results[0]!.suiteId).toBe('suite-a');
    });

    it('should return empty for no history', () => {
      const results = detector.analyzeAll('empty-project');
      expect(results).toHaveLength(0);
    });
  });

  describe('FlakyInfo fields', () => {
    it('should include failCount and totalRuns', () => {
      seedHistory(store, 'test-fc', ['passed', 'failed', 'passed', 'failed', 'passed']);
      const result = detector.analyze('test-fc', 'test-project');
      expect(result.failCount).toBe(2);
      expect(result.totalRuns).toBe(5);
    });

    it('should include recentResults array', () => {
      seedHistory(store, 'test-rr', ['passed', 'failed', 'passed']);
      const result = detector.analyze('test-rr', 'test-project');
      expect(result.recentResults).toHaveLength(3);
      expect(result.recentResults.every(r => ['passed', 'failed', 'skipped'].includes(r))).toBe(true);
    });
  });
});
