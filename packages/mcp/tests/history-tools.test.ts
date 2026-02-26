/**
 * Unit tests for MCP history tool handlers:
 * argus_history, argus_trends, argus_flaky, argus_compare.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryHistoryStore } from 'argusai-core';
import type { TestRunRecord, TestCaseRunRecord, E2EConfig, HistoryConfig } from 'argusai-core';
import { SessionManager } from '../src/session.js';
import type { ProjectSession } from '../src/session.js';
import { handleHistory } from '../src/tools/history.js';
import { handleTrends } from '../src/tools/trends.js';
import { handleFlaky } from '../src/tools/flaky.js';
import { handleCompare } from '../src/tools/compare.js';

function makeConfig(overrides?: Partial<E2EConfig>): E2EConfig {
  return {
    version: '1',
    project: { name: 'test-project' },
    history: { enabled: true, storage: 'memory', retention: { maxAge: '90d', maxRuns: 1000 }, flakyWindow: 10 },
    ...overrides,
  } as E2EConfig;
}

function makeRun(id: string, ts: number, overrides?: Partial<TestRunRecord>): TestRunRecord {
  return {
    id, project: 'test-project', timestamp: ts,
    gitCommit: 'abc123', gitBranch: 'main', configHash: 'sha256:test',
    trigger: 'mcp', duration: 5000, passed: 10, failed: 2, skipped: 1,
    flaky: 0, status: 'failed',
    ...overrides,
  };
}

function makeCase(runId: string, caseName: string, status: 'passed' | 'failed' | 'skipped', suiteId = 'api-tests'): TestCaseRunRecord {
  return {
    id: `case-${runId}-${caseName}`, runId, suiteId, caseName,
    status, duration: 100, attempts: 1,
    responseMs: null, assertions: null, error: status === 'failed' ? 'test error' : null, snapshot: null,
  };
}

function setupSession(sm: SessionManager, store: MemoryHistoryStore): void {
  const config = makeConfig();
  const session = sm.create('/test/project', config, '/test/project/e2e.yaml');
  session.historyStore = store;
  session.state = 'running';
}

describe('argus_history', () => {
  let sm: SessionManager;
  let store: MemoryHistoryStore;

  beforeEach(() => {
    sm = new SessionManager();
    store = new MemoryHistoryStore();
    setupSession(sm, store);
  });

  it('should return paginated runs', async () => {
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      store.saveRun(makeRun(`run-${i}`, now + i * 1000), []);
    }

    const result = await handleHistory({ projectPath: '/test/project', limit: 2, offset: 0 }, sm);
    expect(result.runs).toHaveLength(2);
    expect(result.total).toBe(5);
    expect(result.hasMore).toBe(true);
  });

  it('should filter by status', async () => {
    store.saveRun(makeRun('run-pass', Date.now(), { status: 'passed' }), []);
    store.saveRun(makeRun('run-fail', Date.now() + 1000, { status: 'failed' }), []);

    const result = await handleHistory({ projectPath: '/test/project', status: 'failed' }, sm);
    expect(result.runs).toHaveLength(1);
    expect(result.runs[0]!.status).toBe('failed');
  });

  it('should filter by days', async () => {
    const now = Date.now();
    store.saveRun(makeRun('run-old', now - 30 * 24 * 60 * 60 * 1000), []);
    store.saveRun(makeRun('run-new', now), []);

    const result = await handleHistory({ projectPath: '/test/project', days: 7 }, sm);
    expect(result.total).toBe(1);
    expect(result.runs[0]!.id).toBe('run-new');
  });

  it('should return empty results when no runs', async () => {
    const result = await handleHistory({ projectPath: '/test/project' }, sm);
    expect(result.runs).toHaveLength(0);
    expect(result.total).toBe(0);
    expect(result.hasMore).toBe(false);
  });

  it('should throw when history is disabled', async () => {
    const session = sm.getOrThrow('/test/project');
    session.historyStore = undefined;

    await expect(handleHistory({ projectPath: '/test/project' }, sm))
      .rejects.toThrow('History is disabled');
  });
});

describe('argus_trends', () => {
  let sm: SessionManager;
  let store: MemoryHistoryStore;

  beforeEach(() => {
    sm = new SessionManager();
    store = new MemoryHistoryStore();
    setupSession(sm, store);
  });

  it('should compute pass-rate trend', async () => {
    const now = Date.now();
    store.saveRun(makeRun('run-1', now - 2 * 24 * 60 * 60 * 1000, { passed: 8, failed: 2, skipped: 0, status: 'failed' }), []);
    store.saveRun(makeRun('run-2', now, { passed: 10, failed: 0, skipped: 0, status: 'passed' }), []);

    const result = await handleTrends({ projectPath: '/test/project', metric: 'pass-rate', days: 7 }, sm);
    expect(result.metric).toBe('pass-rate');
    expect(result.dataPoints.length).toBeGreaterThanOrEqual(1);
    expect(result.summary).toBeDefined();
    expect(result.period.from).toBeDefined();
    expect(result.period.to).toBeDefined();
  });

  it('should compute duration trend', async () => {
    const now = Date.now();
    store.saveRun(makeRun('run-1', now, { duration: 10000 }), []);

    const result = await handleTrends({ projectPath: '/test/project', metric: 'duration', days: 7 }, sm);
    expect(result.metric).toBe('duration');
    expect(result.dataPoints[0]!.value).toBe(10000);
  });

  it('should compute flaky trend', async () => {
    const now = Date.now();
    store.saveRun(makeRun('run-1', now, { flaky: 3 }), []);

    const result = await handleTrends({ projectPath: '/test/project', metric: 'flaky', days: 7 }, sm);
    expect(result.metric).toBe('flaky');
    expect(result.dataPoints[0]!.value).toBe(3);
  });

  it('should return empty data for no runs', async () => {
    const result = await handleTrends({ projectPath: '/test/project', metric: 'pass-rate', days: 7 }, sm);
    expect(result.dataPoints).toHaveLength(0);
    expect(result.summary.direction).toBe('stable');
  });
});

describe('argus_flaky', () => {
  let sm: SessionManager;
  let store: MemoryHistoryStore;

  beforeEach(() => {
    sm = new SessionManager();
    store = new MemoryHistoryStore();
    setupSession(sm, store);
  });

  it('should return flaky cases sorted by score', async () => {
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      const run = makeRun(`run-${i}`, now + i * 1000);
      store.saveRun(run, [
        makeCase(run.id, 'stable-test', 'passed'),
        makeCase(run.id, 'flaky-test', i % 2 === 0 ? 'passed' : 'failed'),
        makeCase(run.id, 'broken-test', 'failed'),
      ]);
    }

    const result = await handleFlaky({ projectPath: '/test/project', topN: 10, minScore: 0.01 }, sm);
    expect(result.cases.length).toBeGreaterThan(0);
    expect(result.analysisWindow).toBe(10);
    // First should be the one with highest score
    expect(result.cases[0]!.score).toBeGreaterThanOrEqual(result.cases[result.cases.length - 1]!.score);
  });

  it('should respect topN limiting', async () => {
    const now = Date.now();
    for (let i = 0; i < 3; i++) {
      const run = makeRun(`run-${i}`, now + i * 1000);
      const cases: TestCaseRunRecord[] = [];
      for (let j = 0; j < 10; j++) {
        cases.push(makeCase(run.id, `test-${j}`, i % 2 === 0 ? 'passed' : 'failed'));
      }
      store.saveRun(run, cases);
    }

    const result = await handleFlaky({ projectPath: '/test/project', topN: 3, minScore: 0.01 }, sm);
    expect(result.cases.length).toBeLessThanOrEqual(3);
  });

  it('should filter by minScore', async () => {
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      const run = makeRun(`run-${i}`, now + i * 1000);
      store.saveRun(run, [
        makeCase(run.id, 'stable-test', 'passed'),
        makeCase(run.id, 'flaky-test', i < 3 ? 'passed' : 'failed'),
      ]);
    }

    const result = await handleFlaky({ projectPath: '/test/project', minScore: 0.5 }, sm);
    for (const c of result.cases) {
      expect(c.score).toBeGreaterThanOrEqual(0.5);
    }
  });
});

describe('argus_compare', () => {
  let sm: SessionManager;
  let store: MemoryHistoryStore;

  beforeEach(() => {
    sm = new SessionManager();
    store = new MemoryHistoryStore();
    setupSession(sm, store);
  });

  it('should detect new failures', async () => {
    const now = Date.now();
    store.saveRun(makeRun('run-base', now), [
      makeCase('run-base', 'test-a', 'passed'),
      makeCase('run-base', 'test-b', 'passed'),
    ]);
    store.saveRun(makeRun('run-compare', now + 1000), [
      makeCase('run-compare', 'test-a', 'passed'),
      makeCase('run-compare', 'test-b', 'failed'),
    ]);

    const result = await handleCompare({
      projectPath: '/test/project', baseRunId: 'run-base', compareRunId: 'run-compare',
    }, sm);

    expect(result.newFailures).toHaveLength(1);
    expect(result.newFailures[0]!.caseName).toBe('test-b');
    expect(result.newFailures[0]!.baseStatus).toBe('passed');
    expect(result.newFailures[0]!.compareStatus).toBe('failed');
  });

  it('should detect fixes', async () => {
    const now = Date.now();
    store.saveRun(makeRun('run-base', now), [
      makeCase('run-base', 'test-a', 'failed'),
    ]);
    store.saveRun(makeRun('run-compare', now + 1000), [
      makeCase('run-compare', 'test-a', 'passed'),
    ]);

    const result = await handleCompare({
      projectPath: '/test/project', baseRunId: 'run-base', compareRunId: 'run-compare',
    }, sm);

    expect(result.fixed).toHaveLength(1);
    expect(result.fixed[0]!.caseName).toBe('test-a');
    expect(result.fixed[0]!.baseStatus).toBe('failed');
    expect(result.fixed[0]!.compareStatus).toBe('passed');
  });

  it('should detect consistent cases', async () => {
    const now = Date.now();
    store.saveRun(makeRun('run-base', now), [
      makeCase('run-base', 'test-a', 'passed'),
      makeCase('run-base', 'test-b', 'failed'),
    ]);
    store.saveRun(makeRun('run-compare', now + 1000), [
      makeCase('run-compare', 'test-a', 'passed'),
      makeCase('run-compare', 'test-b', 'failed'),
    ]);

    const result = await handleCompare({
      projectPath: '/test/project', baseRunId: 'run-base', compareRunId: 'run-compare',
    }, sm);

    expect(result.consistent.passed).toBe(1);
    expect(result.consistent.failed).toBe(1);
    expect(result.newFailures).toHaveLength(0);
    expect(result.fixed).toHaveLength(0);
  });

  it('should detect new and removed cases', async () => {
    const now = Date.now();
    store.saveRun(makeRun('run-base', now), [
      makeCase('run-base', 'test-old', 'passed'),
      makeCase('run-base', 'test-both', 'passed'),
    ]);
    store.saveRun(makeRun('run-compare', now + 1000), [
      makeCase('run-compare', 'test-new', 'passed'),
      makeCase('run-compare', 'test-both', 'passed'),
    ]);

    const result = await handleCompare({
      projectPath: '/test/project', baseRunId: 'run-base', compareRunId: 'run-compare',
    }, sm);

    expect(result.newCases).toContain('test-new');
    expect(result.removedCases).toContain('test-old');
  });

  it('should throw RUN_NOT_FOUND for missing base run', async () => {
    store.saveRun(makeRun('run-compare', Date.now()), []);

    await expect(handleCompare({
      projectPath: '/test/project', baseRunId: 'run-missing', compareRunId: 'run-compare',
    }, sm)).rejects.toThrow('Base run not found');
  });

  it('should throw RUN_NOT_FOUND for missing compare run', async () => {
    store.saveRun(makeRun('run-base', Date.now()), []);

    await expect(handleCompare({
      projectPath: '/test/project', baseRunId: 'run-base', compareRunId: 'run-missing',
    }, sm)).rejects.toThrow('Compare run not found');
  });

  it('should throw DIFFERENT_PROJECTS when runs differ', async () => {
    const now = Date.now();
    store.saveRun(makeRun('run-a', now, { project: 'project-a' }), []);
    store.saveRun(makeRun('run-b', now + 1000, { project: 'project-b' }), []);

    await expect(handleCompare({
      projectPath: '/test/project', baseRunId: 'run-a', compareRunId: 'run-b',
    }, sm)).rejects.toThrow('different projects');
  });
});
