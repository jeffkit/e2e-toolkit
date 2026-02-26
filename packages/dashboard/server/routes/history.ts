/**
 * History & Trend Analysis REST API routes.
 *
 * Provides 7 endpoints for trend data, run listing, run detail, and run comparison.
 * All endpoints read from the HistoryStore attached to AppState.
 */

import { type FastifyPluginAsync } from 'fastify';
import { FlakyDetector, type HistoryStore, type TestRunRecord, type FlakyInfo } from 'argusai-core';
import { getAppState } from '../app-state.js';

function getHistoryStore(): HistoryStore {
  const state = getAppState();
  if (!state.historyStore) {
    throw { statusCode: 503, message: 'History is not available. No project loaded or history is disabled.' };
  }
  return state.historyStore;
}

function getProjectName(): string {
  const state = getAppState();
  return state.config?.project.name ?? 'unknown';
}

function getFlakyWindow(): number {
  const state = getAppState();
  const historyConfig = (state.config as Record<string, unknown> | null)?.['history'] as
    { flakyWindow?: number } | undefined;
  return historyConfig?.flakyWindow ?? 10;
}

function formatDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export const historyRoutes: FastifyPluginAsync = async (app) => {

  // ─── GET /trends/pass-rate ───────────────────────────────────────────

  app.get('/trends/pass-rate', async (request) => {
    const store = getHistoryStore();
    const project = getProjectName();
    const { days: rawDays, suiteId } = request.query as { days?: string; suiteId?: string };
    const days = Math.min(Math.max(parseInt(rawDays || '30', 10) || 30, 1), 365);

    const now = Date.now();
    const fromMs = now - days * 24 * 60 * 60 * 1000;
    const runs = store.getRunsInDateRange(project, fromMs, now);

    const filteredRuns = suiteId ? filterRunsBySuite(store, runs, suiteId) : runs;
    const dayMap = groupByDay(filteredRuns);

    const dataPoints = [...dayMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, dayRuns]) => {
        const passed = dayRuns.reduce((s, r) => s + r.passed, 0);
        const failed = dayRuns.reduce((s, r) => s + r.failed, 0);
        const skipped = dayRuns.reduce((s, r) => s + r.skipped, 0);
        const total = passed + failed + skipped;
        const passRate = total > 0 ? Math.round((passed / total) * 1000) / 10 : 0;
        return { date, passRate, passed, failed, skipped, runCount: dayRuns.length };
      });

    return {
      success: true as const,
      period: { from: formatDate(fromMs), to: formatDate(now) },
      granularity: 'daily' as const,
      dataPoints,
    };
  });

  // ─── GET /trends/duration ────────────────────────────────────────────

  app.get('/trends/duration', async (request) => {
    const store = getHistoryStore();
    const project = getProjectName();
    const { days: rawDays, suiteId } = request.query as { days?: string; suiteId?: string };
    const days = Math.min(Math.max(parseInt(rawDays || '14', 10) || 14, 1), 365);

    const now = Date.now();
    const fromMs = now - days * 24 * 60 * 60 * 1000;
    const runs = store.getRunsInDateRange(project, fromMs, now);

    const filteredRuns = suiteId ? filterRunsBySuite(store, runs, suiteId) : runs;
    const dayMap = groupByDay(filteredRuns);

    const dataPoints = [...dayMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, dayRuns]) => {
        const durations = dayRuns.map(r => r.duration);
        const avgDuration = Math.round(durations.reduce((s, d) => s + d, 0) / durations.length);
        const minDuration = Math.min(...durations);
        const maxDuration = Math.max(...durations);
        return { date, avgDuration, minDuration, maxDuration, runCount: dayRuns.length };
      });

    return {
      success: true as const,
      period: { from: formatDate(fromMs), to: formatDate(now) },
      dataPoints,
    };
  });

  // ─── GET /trends/flaky ──────────────────────────────────────────────

  app.get('/trends/flaky', async (request) => {
    const store = getHistoryStore();
    const project = getProjectName();
    const { topN: rawTopN, minScore: rawMinScore, suiteId } = request.query as {
      topN?: string;
      minScore?: string;
      suiteId?: string;
    };

    const topN = Math.min(Math.max(parseInt(rawTopN || '10', 10) || 10, 1), 50);
    const minScore = Math.max(parseFloat(rawMinScore || '0.01') || 0.01, 0);
    const flakyWindow = getFlakyWindow();

    const detector = new FlakyDetector(store, flakyWindow);
    const results = detector.analyzeAll(project, { topN, minScore, suiteId });

    return {
      success: true as const,
      cases: results.map(r => ({
        caseName: r.caseName,
        suiteId: r.suiteId,
        score: r.score,
        level: r.level,
        recentResults: r.recentResults,
        failCount: r.failCount,
        totalRuns: r.totalRuns,
      })),
      totalFlaky: results.filter(r => r.isFlaky).length,
      analysisWindow: flakyWindow,
    };
  });

  // ─── GET /trends/failures ───────────────────────────────────────────

  app.get('/trends/failures', async (request, reply) => {
    const store = getHistoryStore();
    const project = getProjectName();
    const { caseName, days: rawDays, suiteId } = request.query as {
      caseName?: string;
      days?: string;
      suiteId?: string;
    };

    if (!caseName) {
      return reply.status(400).send({ success: false, error: 'caseName query parameter is required' });
    }

    const days = Math.min(Math.max(parseInt(rawDays || '7', 10) || 7, 1), 365);
    const now = Date.now();
    const fromMs = now - days * 24 * 60 * 60 * 1000;

    const caseHistory = store.getCaseHistory(caseName, project, 100, suiteId);
    const flakyWindow = getFlakyWindow();
    const detector = new FlakyDetector(store, flakyWindow);
    const flakyInfo = detector.analyze(caseName, project, suiteId);

    const dayMap = new Map<string, typeof caseHistory[0]>();
    for (const c of caseHistory) {
      const runs = store.getRunsInDateRange(project, c.duration, now);
      const matchRun = runs.find(r => r.id === c.runId);
      if (matchRun && matchRun.timestamp >= fromMs) {
        const date = formatDate(matchRun.timestamp);
        if (!dayMap.has(date)) {
          dayMap.set(date, c);
        }
      }
    }

    const allDates: string[] = [];
    for (let ts = fromMs; ts <= now; ts += 24 * 60 * 60 * 1000) {
      allDates.push(formatDate(ts));
    }

    const dataPoints = allDates.map(date => {
      const entry = dayMap.get(date);
      if (!entry) {
        return { date, status: 'no-run' as const, duration: null, error: null, runId: null };
      }
      return {
        date,
        status: entry.status,
        duration: entry.duration,
        error: entry.error,
        runId: entry.runId,
      };
    });

    return {
      success: true as const,
      caseName,
      period: { from: formatDate(fromMs), to: formatDate(now) },
      dataPoints,
      summary: {
        totalRuns: flakyInfo.totalRuns,
        failures: flakyInfo.failCount,
        flakyScore: flakyInfo.score,
        level: flakyInfo.level,
      },
    };
  });

  // ─── GET /runs ──────────────────────────────────────────────────────

  app.get('/runs', async (request) => {
    const store = getHistoryStore();
    const project = getProjectName();
    const { limit: rawLimit, offset: rawOffset, status, days: rawDays } = request.query as {
      limit?: string;
      offset?: string;
      status?: string;
      days?: string;
    };

    const limit = Math.min(Math.max(parseInt(rawLimit || '20', 10) || 20, 1), 100);
    const offset = Math.max(parseInt(rawOffset || '0', 10) || 0, 0);
    const validStatus = (status === 'passed' || status === 'failed') ? status : undefined;
    const days = rawDays ? Math.max(parseInt(rawDays, 10) || 0, 0) : undefined;

    const result = store.getRuns(project, { limit, offset, status: validStatus, days: days || undefined });

    return {
      success: true as const,
      runs: result.runs,
      pagination: {
        total: result.total,
        limit,
        offset,
        hasMore: offset + limit < result.total,
      },
    };
  });

  // ─── GET /runs/:id ─────────────────────────────────────────────────

  app.get('/runs/:id', async (request, reply) => {
    const store = getHistoryStore();
    const { id } = request.params as { id: string };

    const data = store.getRunById(id);
    if (!data) {
      return reply.status(404).send({ success: false, error: `Run not found: ${id}` });
    }

    const failedCases = data.cases.filter(c => c.status === 'failed');
    let flakyInfos: FlakyInfo[] = [];
    if (failedCases.length > 0) {
      const project = data.run.project;
      const flakyWindow = getFlakyWindow();
      const detector = new FlakyDetector(store, flakyWindow);
      flakyInfos = failedCases.map(c => detector.analyze(c.caseName, project, c.suiteId));
    }

    return {
      success: true as const,
      run: data.run,
      cases: data.cases,
      flaky: flakyInfos,
    };
  });

  // ─── GET /runs/:id/compare/:compareId ──────────────────────────────

  app.get('/runs/:id/compare/:compareId', async (request, reply) => {
    const store = getHistoryStore();
    const { id, compareId } = request.params as { id: string; compareId: string };

    const baseData = store.getRunById(id);
    if (!baseData) {
      return reply.status(404).send({ success: false, error: `Run not found: ${id}` });
    }

    const compareData = store.getRunById(compareId);
    if (!compareData) {
      return reply.status(404).send({ success: false, error: `Run not found: ${compareId}` });
    }

    if (baseData.run.project !== compareData.run.project) {
      return reply.status(400).send({ success: false, error: 'Cannot compare runs from different projects' });
    }

    const baseCases = new Map(baseData.cases.map(c => [c.caseName, c]));
    const compareCases = new Map(compareData.cases.map(c => [c.caseName, c]));

    const newFailures: Array<{ caseName: string; suiteId: string; error?: string | null; baseStatus: string; compareStatus: string }> = [];
    const fixed: Array<{ caseName: string; suiteId: string; baseStatus: string; compareStatus: string }> = [];
    const consistent = { passed: 0, failed: 0, skipped: 0 };
    const newCases: string[] = [];
    const removedCases: string[] = [];

    for (const [caseName, compareCase] of compareCases) {
      const baseCase = baseCases.get(caseName);
      if (!baseCase) {
        newCases.push(caseName);
        continue;
      }
      if (baseCase.status !== 'failed' && compareCase.status === 'failed') {
        newFailures.push({
          caseName,
          suiteId: compareCase.suiteId,
          error: compareCase.error,
          baseStatus: baseCase.status,
          compareStatus: 'failed',
        });
      } else if (baseCase.status === 'failed' && compareCase.status === 'passed') {
        fixed.push({
          caseName,
          suiteId: compareCase.suiteId,
          baseStatus: 'failed',
          compareStatus: 'passed',
        });
      } else {
        if (compareCase.status === 'passed') consistent.passed++;
        else if (compareCase.status === 'failed') consistent.failed++;
        else consistent.skipped++;
      }
    }

    for (const caseName of baseCases.keys()) {
      if (!compareCases.has(caseName)) {
        removedCases.push(caseName);
      }
    }

    return {
      success: true as const,
      baseRun: baseData.run,
      compareRun: compareData.run,
      newFailures,
      fixed,
      consistent,
      newCases,
      removedCases,
    };
  });
};

// =====================================================================
// Helpers
// =====================================================================

function groupByDay(runs: TestRunRecord[]): Map<string, TestRunRecord[]> {
  const dayMap = new Map<string, TestRunRecord[]>();
  for (const run of runs) {
    const date = formatDate(run.timestamp);
    const existing = dayMap.get(date) ?? [];
    existing.push(run);
    dayMap.set(date, existing);
  }
  return dayMap;
}

function filterRunsBySuite(
  store: HistoryStore,
  runs: TestRunRecord[],
  suiteId: string,
): TestRunRecord[] {
  return runs.filter(run => {
    const cases = store.getCasesForRun(run.id);
    return cases.some(c => c.suiteId === suiteId);
  });
}
