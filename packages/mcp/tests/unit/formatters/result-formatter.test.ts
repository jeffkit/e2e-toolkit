/**
 * Unit tests for ResultFormatter.
 * Tests passing-test minimal output, failing-test full diagnostics,
 * NL summary generation, and mixed results.
 */

import { describe, it, expect } from 'vitest';
import { ResultFormatter, generateSummary } from '../../../src/formatters/result-formatter.js';
import type { TestEvent, TestReport } from '@preflight/core';

describe('ResultFormatter', () => {
  const formatter = new ResultFormatter();

  describe('formatEvents', () => {
    it('should format passing test with minimal output', () => {
      const events: TestEvent[] = [
        { type: 'case_pass', suite: 'API', name: 'GET /health', duration: 50, timestamp: 1000 },
      ];

      const results = formatter.formatEvents(events, 'API Tests');

      expect(results).toHaveLength(1);
      expect(results[0]!.name).toBe('GET /health');
      expect(results[0]!.suite).toBe('API Tests');
      expect(results[0]!.status).toBe('passed');
      expect(results[0]!.duration).toBe(50);
      expect(results[0]!.failure).toBeUndefined();
    });

    it('should format failing test with full diagnostics', () => {
      const events: TestEvent[] = [
        {
          type: 'case_fail',
          suite: 'API',
          name: 'POST /create',
          error: 'Expected 200 got 500',
          duration: 200,
          timestamp: 2000,
          request: { method: 'POST', url: 'http://localhost:3000/create', headers: { 'content-type': 'application/json' }, body: { name: 'test' } },
          response: { status: 500, headers: { 'content-type': 'application/json' }, body: { error: 'Internal Server Error' } },
          assertions: [{ path: 'status', operator: '==', expected: 200, actual: 500, passed: false, message: 'Status: expected 200 got 500' }],
          diagnostics: {
            containerLogs: [{ containerName: 'app', lines: ['ECONNREFUSED'], lineCount: 1 }],
            containerHealth: [{ containerName: 'app', status: 'running' }],
            mockRequests: [],
            collectedAt: 2000,
          },
        },
      ];

      const results = formatter.formatEvents(events, 'API Tests');

      expect(results).toHaveLength(1);
      const result = results[0]!;
      expect(result.status).toBe('failed');
      expect(result.failure).toBeDefined();
      expect(result.failure!.error).toBe('Expected 200 got 500');
      expect(result.failure!.request).toBeDefined();
      expect(result.failure!.request!.method).toBe('POST');
      expect(result.failure!.response).toBeDefined();
      expect(result.failure!.response!.status).toBe(500);
      expect(result.failure!.assertions).toHaveLength(1);
      expect(result.failure!.diagnostics.containerLogs).toHaveLength(1);
    });

    it('should format skipped test', () => {
      const events: TestEvent[] = [
        { type: 'case_skip', suite: 'API', name: 'disabled test', reason: 'not ready', timestamp: 3000 },
      ];

      const results = formatter.formatEvents(events, 'API Tests');

      expect(results).toHaveLength(1);
      expect(results[0]!.status).toBe('skipped');
      expect(results[0]!.duration).toBe(0);
    });

    it('should handle mixed results', () => {
      const events: TestEvent[] = [
        { type: 'suite_start', suite: 'API', timestamp: 100 },
        { type: 'case_pass', suite: 'API', name: 'test 1', duration: 50, timestamp: 200 },
        { type: 'case_fail', suite: 'API', name: 'test 2', error: 'fail', duration: 100, timestamp: 300 },
        { type: 'case_skip', suite: 'API', name: 'test 3', timestamp: 400 },
        { type: 'suite_end', suite: 'API', passed: 1, failed: 1, skipped: 1, duration: 400, timestamp: 500 },
      ];

      const results = formatter.formatEvents(events, 'Suite 1');

      expect(results).toHaveLength(3);
      expect(results.filter(r => r.status === 'passed')).toHaveLength(1);
      expect(results.filter(r => r.status === 'failed')).toHaveLength(1);
      expect(results.filter(r => r.status === 'skipped')).toHaveLength(1);
    });

    it('should include attempt history when present', () => {
      const events: TestEvent[] = [
        {
          type: 'case_pass',
          suite: 'API',
          name: 'flaky test',
          duration: 300,
          timestamp: 1000,
          attempts: [
            { attempt: 1, passed: false, error: 'timeout', duration: 100, timestamp: 700 },
            { attempt: 2, passed: true, duration: 200, timestamp: 800 },
          ],
        },
      ];

      const results = formatter.formatEvents(events, 'API Tests');

      expect(results[0]!.attempts).toHaveLength(2);
      expect(results[0]!.attempts![0]!.passed).toBe(false);
      expect(results[0]!.attempts![1]!.passed).toBe(true);
    });
  });

  describe('formatReport', () => {
    it('should convert TestReport to AIFriendlyTestResult map', () => {
      const report: TestReport = {
        project: 'test',
        timestamp: 1000,
        duration: 500,
        suites: [
          {
            suite: 'API Tests',
            passed: 1,
            failed: 1,
            skipped: 0,
            duration: 500,
            cases: [
              { name: 'test 1', status: 'passed', duration: 100 },
              { name: 'test 2', status: 'failed', duration: 200, error: 'assertion error' },
            ],
          },
        ],
        totals: { passed: 1, failed: 1, skipped: 0 },
      };

      const resultMap = formatter.formatReport(report);

      expect(resultMap.size).toBe(1);
      const cases = resultMap.get('API Tests')!;
      expect(cases).toHaveLength(2);
      expect(cases[0]!.status).toBe('passed');
      expect(cases[1]!.status).toBe('failed');
      expect(cases[1]!.failure!.error).toBe('assertion error');
    });
  });
});

describe('generateSummary', () => {
  it('should generate summary with HTTP context', () => {
    const event = {
      type: 'case_fail' as const,
      suite: 'API',
      name: 'POST /create',
      error: 'Expected 200 got 500',
      duration: 200,
      timestamp: 1000,
      request: { method: 'POST', url: 'http://localhost:3000/create', headers: {} },
      response: { status: 500, headers: {} },
    };

    const summary = generateSummary(event);

    expect(summary).toContain('POST');
    expect(summary).toContain('500');
  });

  it('should generate summary with assertion details', () => {
    const event = {
      type: 'case_fail' as const,
      suite: 'API',
      name: 'test',
      error: 'assertion failed',
      duration: 100,
      timestamp: 1000,
      assertions: [
        { path: 'body.count', operator: '>', expected: 0, actual: 0, passed: false, message: 'expected > 0' },
      ],
    };

    const summary = generateSummary(event);

    expect(summary).toContain('body.count');
    expect(summary).toContain('>');
  });

  it('should include connectivity issues from diagnostics', () => {
    const event = {
      type: 'case_fail' as const,
      suite: 'API',
      name: 'test',
      error: 'connection failed',
      duration: 100,
      timestamp: 1000,
      diagnostics: {
        containerLogs: [{ containerName: 'app', lines: ['Error: ECONNREFUSED 127.0.0.1:5432'], lineCount: 1 }],
        containerHealth: [],
        mockRequests: [],
        collectedAt: 1000,
      },
    };

    const summary = generateSummary(event);

    expect(summary).toContain('connectivity issues');
  });

  it('should truncate long error messages', () => {
    const longError = 'A'.repeat(200);
    const event = {
      type: 'case_fail' as const,
      suite: 'API',
      name: 'test',
      error: longError,
      duration: 100,
      timestamp: 1000,
    };

    const summary = generateSummary(event);

    expect(summary.length).toBeLessThan(200);
    expect(summary).toContain('...');
  });

  it('should handle event with no context', () => {
    const event = {
      type: 'case_fail' as const,
      suite: 'API',
      name: 'unknown test',
      error: '',
      duration: 100,
      timestamp: 1000,
    };

    const summary = generateSummary(event);

    expect(summary).toContain('unknown test');
  });
});
