/**
 * @module formatters/result-formatter
 * Converts TestEvents into AIFriendlyTestResult for MCP output.
 *
 * Passing tests get minimal output (status + timing).
 * Failing tests get full diagnostics including request/response context,
 * assertion details, container logs, mock requests, and NL summary.
 */

import type {
  TestEvent,
  AIFriendlyTestResult,
  DiagnosticReport,
  TestReport,
  SuiteReport,
} from 'argusai-core';

/**
 * Converts raw test engine output into the structured AIFriendlyTestResult format
 * consumed by MCP tool responses. Passing tests get minimal output (status + timing);
 * failing tests get full diagnostics with NL summaries.
 */
export class ResultFormatter {
  /**
   * Convert a flat list of TestEvents from a single suite into
   * AIFriendlyTestResult entries.
   *
   * @param events - Raw TestEvents from executing a test suite
   * @param suiteName - Display name of the suite for attribution
   * @returns Array of AI-friendly results, one per test case
   */
  formatEvents(events: TestEvent[], suiteName: string): AIFriendlyTestResult[] {
    const results: AIFriendlyTestResult[] = [];

    for (const event of events) {
      if (event.type === 'case_pass') {
        results.push({
          name: event.name,
          suite: suiteName,
          status: 'passed',
          duration: event.duration,
          timestamp: event.timestamp,
          attempts: event.attempts,
        });
      } else if (event.type === 'case_fail') {
        results.push({
          name: event.name,
          suite: suiteName,
          status: 'failed',
          duration: event.duration,
          timestamp: event.timestamp,
          failure: {
            error: event.error,
            summary: generateSummary(event),
            request: event.request,
            response: event.response,
            assertions: event.assertions ?? [],
            diagnostics: event.diagnostics ?? emptyDiagnostics(),
          },
          attempts: event.attempts,
        });
      } else if (event.type === 'case_skip') {
        results.push({
          name: event.name,
          suite: suiteName,
          status: 'skipped',
          duration: 0,
          timestamp: event.timestamp,
        });
      }
    }

    return results;
  }

  /**
   * Convert a complete TestReport into AIFriendlyTestResult entries grouped by suite.
   *
   * @param report - Complete test report from the runner
   * @returns Map of suite name → AI-friendly results
   */
  formatReport(report: TestReport): Map<string, AIFriendlyTestResult[]> {
    const result = new Map<string, AIFriendlyTestResult[]>();

    for (const suite of report.suites) {
      const cases: AIFriendlyTestResult[] = suite.cases.map(c => {
        if (c.status === 'passed') {
          return {
            name: c.name,
            suite: suite.suite,
            status: 'passed' as const,
            duration: c.duration,
            timestamp: report.timestamp,
            attempts: c.attempts,
          };
        }
        if (c.status === 'failed') {
          return {
            name: c.name,
            suite: suite.suite,
            status: 'failed' as const,
            duration: c.duration,
            timestamp: report.timestamp,
            failure: {
              error: c.error ?? 'Unknown error',
              summary: `Test "${c.name}" failed: ${c.error ?? 'Unknown error'}`,
              assertions: [],
              diagnostics: c.diagnostics ?? emptyDiagnostics(),
            },
            attempts: c.attempts,
          };
        }
        return {
          name: c.name,
          suite: suite.suite,
          status: 'skipped' as const,
          duration: 0,
          timestamp: report.timestamp,
        };
      });

      result.set(suite.suite, cases);
    }

    return result;
  }
}

/**
 * Generate a one-sentence natural-language summary of a test failure.
 * Parses the error message, HTTP context, assertion details, and container
 * logs to produce a concise AI-friendly description of what went wrong.
 *
 * @param event - The case_fail TestEvent containing failure details
 * @returns Human-readable failure summary string
 */
export function generateSummary(event: Extract<TestEvent, { type: 'case_fail' }>): string {
  const parts: string[] = [];

  if (event.request) {
    parts.push(`${event.request.method} ${event.request.url}`);
  }

  if (event.response) {
    parts.push(`returned ${event.response.status}`);
  }

  if (event.assertions && event.assertions.length > 0) {
    const firstFail = event.assertions.find(a => !a.passed);
    if (firstFail) {
      parts.push(`expected ${firstFail.path} ${firstFail.operator} ${JSON.stringify(firstFail.expected)} but got ${JSON.stringify(firstFail.actual)}`);
    }
  } else if (event.error) {
    const errorSummary = event.error.split('\n')[0]!;
    if (errorSummary.length <= 120) {
      parts.push(errorSummary);
    } else {
      parts.push(errorSummary.slice(0, 117) + '...');
    }
  }

  if (event.diagnostics?.containerLogs?.some(c => c.lines.some(l =>
    l.includes('ECONNREFUSED') || l.includes('ENOTFOUND') || l.includes('ETIMEDOUT'),
  ))) {
    parts.push('container logs show connectivity issues');
  }

  if (parts.length === 0) {
    return `Test "${event.name}" failed`;
  }

  return parts.join(', ');
}

function emptyDiagnostics(): DiagnosticReport {
  return {
    containerLogs: [],
    containerHealth: [],
    mockRequests: [],
    collectedAt: Date.now(),
  };
}
