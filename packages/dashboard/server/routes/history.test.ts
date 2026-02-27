/**
 * Integration tests for history REST API endpoints.
 * Uses MemoryHistoryStore to seed data and Fastify injection to test routes.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { MemoryHistoryStore, type TestRunRecord, type TestCaseRunRecord } from 'argusai-core';
import { initAppState } from '../app-state.js';
import { createEventBus } from 'argusai-core';
import { historyRoutes } from './history.js';

let app: FastifyInstance;
let store: MemoryHistoryStore;

function makeRun(id: string, ts: number, overrides?: Partial<TestRunRecord>): TestRunRecord {
  return {
    id, project: 'test-project', timestamp: ts,
    gitCommit: 'abc123', gitBranch: 'main', configHash: 'sha256:test',
    trigger: 'cli', duration: 5000, passed: 10, failed: 2, skipped: 1,
    flaky: 0, status: 'failed',
    ...overrides,
  };
}

function makeCase(
  runId: string,
  caseName: string,
  status: 'passed' | 'failed' | 'skipped',
  suiteId = 'api-tests',
): TestCaseRunRecord {
  return {
    id: `case-${runId}-${caseName}`, runId, suiteId, caseName,
    status, duration: 100, attempts: 1,
    responseMs: null, assertions: null,
    error: status === 'failed' ? `Error in ${caseName}` : null, snapshot: null,
  };
}

function seedRuns(count: number, startTs = Date.now() - 7 * 86400000): void {
  const dayMs = 86400000;
  for (let i = 0; i < count; i++) {
    const ts = startTs + i * dayMs;
    const run = makeRun(`run-${i}`, ts, {
      status: i % 3 === 0 ? 'failed' : 'passed',
      passed: 8 + (i % 3),
      failed: i % 3 === 0 ? 2 : 0,
      skipped: 1,
    });
    const cases = [
      makeCase(run.id, 'test-login', i % 3 === 0 ? 'failed' : 'passed'),
      makeCase(run.id, 'test-signup', 'passed'),
      makeCase(run.id, 'test-api', i % 5 === 0 ? 'failed' : 'passed'),
    ];
    store.saveRun(run, cases);
  }
}

beforeEach(async () => {
  store = new MemoryHistoryStore();

  initAppState({
    config: {
      version: '1',
      project: { name: 'test-project' },
      history: { enabled: true, storage: 'memory', retention: { maxAge: '90d', maxRuns: 1000 }, flakyWindow: 10 },
    } as never,
    configDir: '/test',
    configPath: '/test/e2e.yaml',
    eventBus: createEventBus(),
    activities: [],
    historyStore: store,
  });

  app = Fastify();
  await app.register(historyRoutes, { prefix: '/api' });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

// ─── GET /api/trends/pass-rate ───────────────────────────────────────

describe('GET /api/trends/pass-rate', () => {
  it('should return daily pass-rate data points', async () => {
    seedRuns(7);

    const res = await app.inject({ method: 'GET', url: '/api/trends/pass-rate?days=30' });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.granularity).toBe('daily');
    expect(body.dataPoints.length).toBeGreaterThan(0);
    expect(body.period).toHaveProperty('from');
    expect(body.period).toHaveProperty('to');

    const point = body.dataPoints[0];
    expect(point).toHaveProperty('date');
    expect(point).toHaveProperty('passRate');
    expect(point).toHaveProperty('passed');
    expect(point).toHaveProperty('failed');
    expect(point).toHaveProperty('skipped');
    expect(point).toHaveProperty('runCount');
  });

  it('should return empty data points when no runs exist', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/trends/pass-rate?days=7' });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.dataPoints).toEqual([]);
  });
});

// ─── GET /api/trends/duration ────────────────────────────────────────

describe('GET /api/trends/duration', () => {
  it('should return duration trend with avg/min/max', async () => {
    seedRuns(5);

    const res = await app.inject({ method: 'GET', url: '/api/trends/duration?days=14' });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.dataPoints.length).toBeGreaterThan(0);

    const point = body.dataPoints[0];
    expect(point).toHaveProperty('avgDuration');
    expect(point).toHaveProperty('minDuration');
    expect(point).toHaveProperty('maxDuration');
    expect(point).toHaveProperty('runCount');
  });
});

// ─── GET /api/trends/flaky ──────────────────────────────────────────

describe('GET /api/trends/flaky', () => {
  it('should return flaky test ranking', async () => {
    seedRuns(10);

    const res = await app.inject({ method: 'GET', url: '/api/trends/flaky?topN=5&minScore=0.01' });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body).toHaveProperty('cases');
    expect(body).toHaveProperty('totalFlaky');
    expect(body).toHaveProperty('analysisWindow');
    expect(Array.isArray(body.cases)).toBe(true);
  });

  it('should limit results to topN', async () => {
    seedRuns(10);

    const res = await app.inject({ method: 'GET', url: '/api/trends/flaky?topN=1' });
    const body = JSON.parse(res.body);

    expect(body.cases.length).toBeLessThanOrEqual(1);
  });
});

// ─── GET /api/trends/failures ───────────────────────────────────────

describe('GET /api/trends/failures', () => {
  it('should return failure trend for a case', async () => {
    seedRuns(7);

    const res = await app.inject({
      method: 'GET',
      url: '/api/trends/failures?caseName=test-login&days=14',
    });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.caseName).toBe('test-login');
    expect(body).toHaveProperty('period');
    expect(body).toHaveProperty('dataPoints');
    expect(body).toHaveProperty('summary');
    expect(body.summary).toHaveProperty('flakyScore');
    expect(body.summary).toHaveProperty('level');
  });

  it('should return 400 when caseName is missing', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/trends/failures' });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain('caseName');
  });
});

// ─── GET /api/runs ──────────────────────────────────────────────────

describe('GET /api/runs', () => {
  it('should return paginated run list', async () => {
    seedRuns(10);

    const res = await app.inject({ method: 'GET', url: '/api/runs?limit=3&offset=0' });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.runs.length).toBe(3);
    expect(body.pagination.total).toBe(10);
    expect(body.pagination.hasMore).toBe(true);
  });

  it('should filter by status', async () => {
    seedRuns(6);

    const res = await app.inject({ method: 'GET', url: '/api/runs?status=passed' });
    const body = JSON.parse(res.body);

    expect(body.runs.every((r: TestRunRecord) => r.status === 'passed')).toBe(true);
  });

  it('should return empty list when no runs', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/runs' });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.runs).toEqual([]);
    expect(body.pagination.total).toBe(0);
    expect(body.pagination.hasMore).toBe(false);
  });
});

// ─── GET /api/runs/:id ─────────────────────────────────────────────

describe('GET /api/runs/:id', () => {
  it('should return run detail with cases and flaky info', async () => {
    const run = makeRun('run-detail-1', Date.now());
    const cases = [
      makeCase(run.id, 'test-a', 'passed'),
      makeCase(run.id, 'test-b', 'failed'),
    ];
    store.saveRun(run, cases);

    const res = await app.inject({ method: 'GET', url: '/api/runs/run-detail-1' });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.run.id).toBe('run-detail-1');
    expect(body.cases).toHaveLength(2);
    expect(body.flaky).toHaveLength(1);
  });

  it('should return 404 for missing run', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/runs/nonexistent' });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error).toContain('Run not found');
  });
});

// ─── GET /api/runs/:id/compare/:compareId ───────────────────────────

// ─── 503 when no project loaded ─────────────────────────────────────

describe('History endpoints without active project', () => {
  it('should return 503 when historyStore is not available', async () => {
    const noProjectApp = Fastify();
    initAppState({
      config: null,
      configDir: '/test',
      configPath: null,
      eventBus: createEventBus(),
      activities: [],
    });
    await noProjectApp.register(historyRoutes, { prefix: '/api' });
    await noProjectApp.ready();

    const endpoints = [
      '/api/trends/pass-rate',
      '/api/trends/duration',
      '/api/trends/flaky',
      '/api/runs',
      '/api/runs/nonexistent',
    ];

    for (const url of endpoints) {
      const res = await noProjectApp.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(503);
    }

    await noProjectApp.close();

    // Re-initialize for remaining tests
    initAppState({
      config: {
        version: '1',
        project: { name: 'test-project' },
        history: { enabled: true, storage: 'memory', retention: { maxAge: '90d', maxRuns: 1000 }, flakyWindow: 10 },
      } as never,
      configDir: '/test',
      configPath: '/test/e2e.yaml',
      eventBus: createEventBus(),
      activities: [],
      historyStore: store,
    });
  });
});

// ─── GET /api/runs/:id/compare/:compareId ───────────────────────────

describe('GET /api/runs/:id/compare/:compareId', () => {
  it('should compare two runs', async () => {
    const run1 = makeRun('run-cmp-1', Date.now());
    const cases1 = [
      makeCase(run1.id, 'test-a', 'passed'),
      makeCase(run1.id, 'test-b', 'failed'),
    ];
    store.saveRun(run1, cases1);

    const run2 = makeRun('run-cmp-2', Date.now() + 1000);
    const cases2 = [
      makeCase(run2.id, 'test-a', 'failed'),
      makeCase(run2.id, 'test-b', 'passed'),
      makeCase(run2.id, 'test-c', 'passed'),
    ];
    store.saveRun(run2, cases2);

    const res = await app.inject({ method: 'GET', url: '/api/runs/run-cmp-1/compare/run-cmp-2' });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.newFailures).toHaveLength(1);
    expect(body.newFailures[0].caseName).toBe('test-a');
    expect(body.fixed).toHaveLength(1);
    expect(body.fixed[0].caseName).toBe('test-b');
    expect(body.newCases).toContain('test-c');
  });

  it('should return 404 for missing base run', async () => {
    store.saveRun(makeRun('run-existing', Date.now()), []);

    const res = await app.inject({ method: 'GET', url: '/api/runs/missing/compare/run-existing' });
    expect(res.statusCode).toBe(404);
  });

  it('should return 404 for missing compare run', async () => {
    store.saveRun(makeRun('run-existing', Date.now()), []);

    const res = await app.inject({ method: 'GET', url: '/api/runs/run-existing/compare/missing' });
    expect(res.statusCode).toBe(404);
  });
});
