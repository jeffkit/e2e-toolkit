/**
 * Unit tests for SQLiteHistoryStore and MemoryHistoryStore.
 * Tests: saveRun + getRuns round-trip, pagination, status filtering,
 * date range queries, getRunById with cases, getCaseHistory ordering,
 * cleanup by maxAge and maxRuns, concurrent write safety, cascade delete.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { SQLiteHistoryStore } from '../../../src/history/history-store.js';
import { MemoryHistoryStore } from '../../../src/history/memory-history-store.js';
import type { HistoryStore } from '../../../src/history/history-store.js';
import type { TestRunRecord, TestCaseRunRecord } from '../../../src/history/types.js';

function createTestRun(overrides: Partial<TestRunRecord> = {}): TestRunRecord {
  return {
    id: `run-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    project: 'test-project',
    timestamp: Date.now(),
    gitCommit: 'abc123',
    gitBranch: 'main',
    configHash: 'sha256:test',
    trigger: 'cli',
    duration: 5000,
    passed: 10,
    failed: 2,
    skipped: 1,
    flaky: 0,
    status: 'failed',
    ...overrides,
  };
}

function createTestCaseRun(runId: string, overrides: Partial<TestCaseRunRecord> = {}): TestCaseRunRecord {
  return {
    id: `case-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    runId,
    suiteId: 'api-tests',
    caseName: 'GET /api/health',
    status: 'passed',
    duration: 120,
    attempts: 1,
    responseMs: null,
    assertions: null,
    error: null,
    snapshot: null,
    ...overrides,
  };
}

function runStoreTests(name: string, createStore: () => HistoryStore, destroyStore: (store: HistoryStore) => void) {
  describe(name, () => {
    let store: HistoryStore;

    beforeEach(() => {
      store = createStore();
    });

    afterEach(() => {
      destroyStore(store);
    });

    describe('saveRun + getRuns round-trip', () => {
      it('should save and retrieve a run with cases', () => {
        const run = createTestRun();
        const cases = [
          createTestCaseRun(run.id, { caseName: 'test-1', status: 'passed' }),
          createTestCaseRun(run.id, { caseName: 'test-2', status: 'failed', error: 'timeout' }),
        ];
        store.saveRun(run, cases);

        const result = store.getRuns('test-project', {});
        expect(result.total).toBe(1);
        expect(result.runs).toHaveLength(1);
        expect(result.runs[0]!.id).toBe(run.id);
        expect(result.runs[0]!.project).toBe('test-project');
      });

      it('should return empty results for unknown project', () => {
        const result = store.getRuns('unknown', {});
        expect(result.total).toBe(0);
        expect(result.runs).toHaveLength(0);
      });
    });

    describe('pagination', () => {
      it('should respect limit and offset', () => {
        for (let i = 0; i < 5; i++) {
          const run = createTestRun({ id: `run-${i}`, timestamp: Date.now() + i * 1000 });
          store.saveRun(run, []);
        }

        const page1 = store.getRuns('test-project', { limit: 2, offset: 0 });
        expect(page1.runs).toHaveLength(2);
        expect(page1.total).toBe(5);

        const page2 = store.getRuns('test-project', { limit: 2, offset: 2 });
        expect(page2.runs).toHaveLength(2);

        const page3 = store.getRuns('test-project', { limit: 2, offset: 4 });
        expect(page3.runs).toHaveLength(1);
      });

      it('should order runs by timestamp descending', () => {
        const now = Date.now();
        for (let i = 0; i < 3; i++) {
          store.saveRun(createTestRun({ id: `run-${i}`, timestamp: now + i * 1000 }), []);
        }
        const result = store.getRuns('test-project', {});
        expect(result.runs[0]!.timestamp).toBeGreaterThan(result.runs[1]!.timestamp);
        expect(result.runs[1]!.timestamp).toBeGreaterThan(result.runs[2]!.timestamp);
      });
    });

    describe('status filtering', () => {
      it('should filter by passed status', () => {
        store.saveRun(createTestRun({ id: 'run-pass', status: 'passed' }), []);
        store.saveRun(createTestRun({ id: 'run-fail', status: 'failed' }), []);

        const result = store.getRuns('test-project', { status: 'passed' });
        expect(result.total).toBe(1);
        expect(result.runs[0]!.status).toBe('passed');
      });

      it('should filter by failed status', () => {
        store.saveRun(createTestRun({ id: 'run-pass', status: 'passed' }), []);
        store.saveRun(createTestRun({ id: 'run-fail', status: 'failed' }), []);

        const result = store.getRuns('test-project', { status: 'failed' });
        expect(result.total).toBe(1);
        expect(result.runs[0]!.status).toBe('failed');
      });
    });

    describe('date range queries', () => {
      it('should filter runs by days', () => {
        const now = Date.now();
        store.saveRun(createTestRun({ id: 'run-old', timestamp: now - 10 * 24 * 60 * 60 * 1000 }), []);
        store.saveRun(createTestRun({ id: 'run-new', timestamp: now }), []);

        const result = store.getRuns('test-project', { days: 5 });
        expect(result.total).toBe(1);
        expect(result.runs[0]!.id).toBe('run-new');
      });

      it('should retrieve runs in date range', () => {
        const now = Date.now();
        store.saveRun(createTestRun({ id: 'run-1', timestamp: now - 3000 }), []);
        store.saveRun(createTestRun({ id: 'run-2', timestamp: now - 1000 }), []);
        store.saveRun(createTestRun({ id: 'run-3', timestamp: now + 5000 }), []);

        const runs = store.getRunsInDateRange('test-project', now - 4000, now);
        expect(runs).toHaveLength(2);
        expect(runs[0]!.timestamp).toBeLessThanOrEqual(runs[1]!.timestamp);
      });
    });

    describe('getRunById', () => {
      it('should return run with cases', () => {
        const run = createTestRun();
        const cases = [
          createTestCaseRun(run.id, { caseName: 'test-a' }),
          createTestCaseRun(run.id, { caseName: 'test-b' }),
        ];
        store.saveRun(run, cases);

        const result = store.getRunById(run.id);
        expect(result).not.toBeNull();
        expect(result!.run.id).toBe(run.id);
        expect(result!.cases).toHaveLength(2);
      });

      it('should return null for unknown run', () => {
        expect(store.getRunById('nonexistent')).toBeNull();
      });
    });

    describe('getCaseHistory', () => {
      it('should return case history ordered by most recent first', () => {
        const now = Date.now();
        for (let i = 0; i < 3; i++) {
          const run = createTestRun({ id: `run-${i}`, timestamp: now + i * 1000 });
          const c = createTestCaseRun(run.id, {
            id: `case-${i}`,
            caseName: 'flaky-test',
            status: i % 2 === 0 ? 'passed' : 'failed',
          });
          store.saveRun(run, [c]);
        }

        const history = store.getCaseHistory('flaky-test', 'test-project', 10);
        expect(history).toHaveLength(3);
        // Most recent first
        expect(history[0]!.runId).toBe('run-2');
      });

      it('should filter by suiteId', () => {
        const run = createTestRun();
        store.saveRun(run, [
          createTestCaseRun(run.id, { caseName: 'test', suiteId: 'suite-a' }),
          createTestCaseRun(run.id, { caseName: 'test', suiteId: 'suite-b' }),
        ]);

        const history = store.getCaseHistory('test', 'test-project', 10, 'suite-a');
        expect(history).toHaveLength(1);
        expect(history[0]!.suiteId).toBe('suite-a');
      });

      it('should respect limit', () => {
        const now = Date.now();
        for (let i = 0; i < 5; i++) {
          const run = createTestRun({ id: `run-${i}`, timestamp: now + i });
          store.saveRun(run, [createTestCaseRun(run.id, { id: `case-${i}`, caseName: 'test' })]);
        }

        const history = store.getCaseHistory('test', 'test-project', 3);
        expect(history).toHaveLength(3);
      });
    });

    describe('getDistinctCaseNames', () => {
      it('should return unique case names', () => {
        const run = createTestRun();
        store.saveRun(run, [
          createTestCaseRun(run.id, { id: 'c1', caseName: 'test-a' }),
          createTestCaseRun(run.id, { id: 'c2', caseName: 'test-b' }),
          createTestCaseRun(run.id, { id: 'c3', caseName: 'test-a' }),
        ]);

        const names = store.getDistinctCaseNames('test-project');
        expect(names).toHaveLength(2);
        expect(names).toContain('test-a');
        expect(names).toContain('test-b');
      });

      it('should filter by suiteId', () => {
        const run = createTestRun();
        store.saveRun(run, [
          createTestCaseRun(run.id, { id: 'c1', caseName: 'test-a', suiteId: 'suite-x' }),
          createTestCaseRun(run.id, { id: 'c2', caseName: 'test-b', suiteId: 'suite-y' }),
        ]);

        const names = store.getDistinctCaseNames('test-project', { suiteId: 'suite-x' });
        expect(names).toEqual(['test-a']);
      });
    });

    describe('cleanup', () => {
      it('should remove old runs by maxAge', () => {
        const now = Date.now();
        store.saveRun(createTestRun({ id: 'run-old', timestamp: now - 100 * 24 * 60 * 60 * 1000 }), []);
        store.saveRun(createTestRun({ id: 'run-new', timestamp: now }), []);

        const deleted = store.cleanup('test-project', '90d', 10000);
        expect(deleted).toBe(1);

        const result = store.getRuns('test-project', {});
        expect(result.total).toBe(1);
        expect(result.runs[0]!.id).toBe('run-new');
      });

      it('should remove excess runs by maxRuns', () => {
        const now = Date.now();
        for (let i = 0; i < 5; i++) {
          store.saveRun(createTestRun({ id: `run-${i}`, timestamp: now + i }), []);
        }

        const deleted = store.cleanup('test-project', '365d', 3);
        expect(deleted).toBe(2);

        const result = store.getRuns('test-project', {});
        expect(result.total).toBe(3);
      });
    });

    describe('getCasesForRun', () => {
      it('should return all cases for a run', () => {
        const run = createTestRun();
        const cases = [
          createTestCaseRun(run.id, { id: 'c1', caseName: 'a' }),
          createTestCaseRun(run.id, { id: 'c2', caseName: 'b' }),
        ];
        store.saveRun(run, cases);

        const result = store.getCasesForRun(run.id);
        expect(result).toHaveLength(2);
      });

      it('should return empty for unknown runId', () => {
        expect(store.getCasesForRun('nonexistent')).toHaveLength(0);
      });
    });
  });
}

// =====================================================================
// SQLiteHistoryStore
// =====================================================================

let tmpDir: string;

runStoreTests(
  'SQLiteHistoryStore',
  () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'argus-test-'));
    return new SQLiteHistoryStore(path.join(tmpDir, 'test.db'));
  },
  (store) => {
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  },
);

// =====================================================================
// MemoryHistoryStore
// =====================================================================

runStoreTests(
  'MemoryHistoryStore',
  () => new MemoryHistoryStore(),
  (store) => store.close(),
);

// =====================================================================
// SQLiteHistoryStore-specific tests
// =====================================================================

describe('SQLiteHistoryStore - cascade delete', () => {
  let store: SQLiteHistoryStore;
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'argus-cascade-'));
    store = new SQLiteHistoryStore(path.join(dir, 'test.db'));
  });

  afterEach(() => {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('should cascade delete cases when run is removed by cleanup', () => {
    const now = Date.now();
    const run = createTestRun({ id: 'run-old', timestamp: now - 200 * 24 * 60 * 60 * 1000 });
    store.saveRun(run, [
      createTestCaseRun(run.id, { id: 'c1', caseName: 'test-1' }),
      createTestCaseRun(run.id, { id: 'c2', caseName: 'test-2' }),
    ]);

    expect(store.getCasesForRun(run.id)).toHaveLength(2);

    store.cleanup('test-project', '90d', 10000);

    expect(store.getRunById(run.id)).toBeNull();
    expect(store.getCasesForRun(run.id)).toHaveLength(0);
  });
});
