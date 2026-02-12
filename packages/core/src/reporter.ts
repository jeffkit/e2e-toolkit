/**
 * @module reporter
 * Test result reporters for e2e-toolkit.
 *
 * Provides three built-in {@link Reporter} implementations:
 * - {@link ConsoleReporter} — streams coloured output to stdout
 * - {@link JSONReporter}    — collects events and generates a JSON report
 * - {@link HTMLReporter}    — generates a self-contained HTML report file
 */

import fs from 'node:fs/promises';
import type { TestEvent, TestReport, SuiteReport, Reporter } from './types.js';

// =====================================================================
// ANSI helpers (no external dependency)
// =====================================================================

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GRAY = '\x1b[90m';

// =====================================================================
// Console Reporter
// =====================================================================

/**
 * Reporter that streams coloured test results to stdout in real-time.
 */
export class ConsoleReporter implements Reporter {
  id = 'console';
  private events: TestEvent[] = [];

  /**
   * Handle an incoming test event.
   * Prints a human-readable line to stdout immediately.
   */
  onEvent(event: TestEvent): void {
    this.events.push(event);

    switch (event.type) {
      case 'suite_start':
        console.log(`\n${BOLD}Suite: ${event.suite}${RESET}`);
        break;
      case 'case_start':
        // Intentionally silent — result is printed on pass/fail
        break;
      case 'case_pass':
        console.log(`  ${GREEN}✓${RESET} ${event.name} ${GRAY}(${event.duration}ms)${RESET}`);
        break;
      case 'case_fail':
        console.log(`  ${RED}✗${RESET} ${event.name} ${GRAY}(${event.duration}ms)${RESET}`);
        console.log(`    ${RED}${event.error}${RESET}`);
        break;
      case 'case_skip':
        console.log(`  ${YELLOW}○${RESET} ${event.name}${event.reason ? ` — ${event.reason}` : ''}`);
        break;
      case 'suite_end':
        console.log(
          `\n  ${GREEN}${event.passed} passed${RESET}` +
            (event.failed > 0 ? `, ${RED}${event.failed} failed${RESET}` : '') +
            (event.skipped > 0 ? `, ${YELLOW}${event.skipped} skipped${RESET}` : '') +
            ` ${GRAY}(${event.duration}ms)${RESET}`,
        );
        break;
      case 'log':
        {
          const colour = event.level === 'error' ? RED : event.level === 'warn' ? YELLOW : GRAY;
          console.log(`  ${colour}[${event.level}]${RESET} ${event.message}`);
        }
        break;
    }
  }

  /**
   * Generate a structured {@link TestReport} from all collected events.
   */
  generate(): TestReport {
    return buildReport(this.events);
  }
}

// =====================================================================
// JSON Reporter
// =====================================================================

/**
 * Reporter that collects events silently and produces a JSON-friendly
 * {@link TestReport} via `generate()`.
 */
export class JSONReporter implements Reporter {
  id = 'json';
  private events: TestEvent[] = [];

  /**
   * Record an event (no stdout output).
   */
  onEvent(event: TestEvent): void {
    this.events.push(event);
  }

  /**
   * Generate a structured {@link TestReport} from all collected events.
   */
  generate(): TestReport {
    return buildReport(this.events);
  }
}

// =====================================================================
// HTML Reporter
// =====================================================================

/**
 * Reporter that generates a self-contained HTML report file.
 *
 * Collects events silently and produces a single HTML file with
 * embedded CSS — no external dependencies required.
 */
export class HTMLReporter implements Reporter {
  id = 'html';
  private events: TestEvent[] = [];

  /**
   * Record an event (no stdout output).
   */
  onEvent(event: TestEvent): void {
    this.events.push(event);
  }

  /**
   * Generate a structured {@link TestReport} from all collected events.
   */
  generate(): TestReport {
    return buildReport(this.events);
  }

  /**
   * Write a self-contained HTML report to the specified path.
   *
   * @param outputPath - File path for the output HTML
   */
  async writeReport(outputPath: string): Promise<void> {
    const report = this.generate();
    const html = renderHTML(report);
    await fs.writeFile(outputPath, html, 'utf-8');
  }
}

/**
 * Render a {@link TestReport} as a self-contained HTML string.
 */
function renderHTML(report: TestReport): string {
  const ts = new Date(report.timestamp).toISOString();
  const totalTests = report.totals.passed + report.totals.failed + report.totals.skipped;
  const passRate = totalTests > 0 ? ((report.totals.passed / totalTests) * 100).toFixed(1) : '0.0';

  const suitesHTML = report.suites
    .map((suite) => {
      const casesHTML = suite.cases
        .map((c) => {
          const icon = c.status === 'passed' ? '✓' : c.status === 'failed' ? '✗' : '○';
          const cls = c.status;
          const errorHTML = c.error ? `<div class="error">${escapeHTML(c.error)}</div>` : '';
          return `<div class="case ${cls}"><span class="icon">${icon}</span> ${escapeHTML(c.name)} <span class="dur">${c.duration}ms</span>${errorHTML}</div>`;
        })
        .join('\n');

      return `
      <div class="suite">
        <h3>${escapeHTML(suite.suite)}</h3>
        <div class="suite-summary">
          <span class="passed">${suite.passed} passed</span>
          <span class="failed">${suite.failed} failed</span>
          <span class="skipped">${suite.skipped} skipped</span>
          <span class="dur">${suite.duration}ms</span>
        </div>
        <div class="cases">${casesHTML}</div>
      </div>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>E2E Toolkit Test Report — ${escapeHTML(report.project || 'unnamed')}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8f9fa; color: #212529; padding: 2rem; max-width: 960px; margin: 0 auto; }
  h1 { font-size: 1.5rem; margin-bottom: .25rem; }
  .meta { color: #6c757d; font-size: .85rem; margin-bottom: 1.5rem; }
  .totals { display: flex; gap: 1.5rem; margin-bottom: 2rem; padding: 1rem; background: #fff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
  .totals .stat { text-align: center; }
  .totals .stat .num { font-size: 1.75rem; font-weight: 700; }
  .totals .stat .label { font-size: .75rem; color: #6c757d; text-transform: uppercase; }
  .totals .passed .num { color: #198754; }
  .totals .failed .num { color: #dc3545; }
  .totals .skipped .num { color: #ffc107; }
  .totals .rate .num { color: #0d6efd; }
  .suite { background: #fff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); margin-bottom: 1rem; padding: 1rem 1.25rem; }
  .suite h3 { font-size: 1rem; margin-bottom: .5rem; }
  .suite-summary { font-size: .8rem; color: #6c757d; margin-bottom: .75rem; display: flex; gap: 1rem; }
  .suite-summary .passed { color: #198754; }
  .suite-summary .failed { color: #dc3545; }
  .suite-summary .skipped { color: #ffc107; }
  .case { padding: .35rem 0; font-size: .9rem; border-bottom: 1px solid #f0f0f0; }
  .case:last-child { border-bottom: none; }
  .case .icon { display: inline-block; width: 1.25rem; text-align: center; }
  .case.passed .icon { color: #198754; }
  .case.failed .icon { color: #dc3545; }
  .case.skipped .icon { color: #ffc107; }
  .case .dur { color: #adb5bd; font-size: .8rem; }
  .error { background: #fff5f5; color: #dc3545; padding: .4rem .6rem; margin-top: .25rem; border-radius: 4px; font-size: .8rem; font-family: monospace; white-space: pre-wrap; }
</style>
</head>
<body>
  <h1>E2E Toolkit — Test Report</h1>
  <div class="meta">Project: ${escapeHTML(report.project || 'unnamed')} · ${ts} · Duration: ${report.duration}ms</div>
  <div class="totals">
    <div class="stat passed"><div class="num">${report.totals.passed}</div><div class="label">Passed</div></div>
    <div class="stat failed"><div class="num">${report.totals.failed}</div><div class="label">Failed</div></div>
    <div class="stat skipped"><div class="num">${report.totals.skipped}</div><div class="label">Skipped</div></div>
    <div class="stat rate"><div class="num">${passRate}%</div><div class="label">Pass Rate</div></div>
  </div>
  ${suitesHTML}
</body>
</html>`;
}

/** Escape HTML special characters */
function escapeHTML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// =====================================================================
// Shared report builder
// =====================================================================

/**
 * Build a {@link TestReport} from a flat list of {@link TestEvent}s.
 */
function buildReport(events: TestEvent[]): TestReport {
  const suites: SuiteReport[] = [];
  let currentSuite: SuiteReport | null = null;
  let caseStart: number | null = null;

  let firstTs = Infinity;
  let lastTs = 0;

  for (const event of events) {
    if (event.timestamp < firstTs) firstTs = event.timestamp;
    if (event.timestamp > lastTs) lastTs = event.timestamp;

    switch (event.type) {
      case 'suite_start':
        currentSuite = {
          suite: event.suite,
          passed: 0,
          failed: 0,
          skipped: 0,
          duration: 0,
          cases: [],
        };
        break;

      case 'case_start':
        caseStart = event.timestamp;
        break;

      case 'case_pass':
        if (currentSuite) {
          currentSuite.passed++;
          currentSuite.cases.push({
            name: event.name,
            status: 'passed',
            duration: event.duration,
          });
        }
        caseStart = null;
        break;

      case 'case_fail':
        if (currentSuite) {
          currentSuite.failed++;
          currentSuite.cases.push({
            name: event.name,
            status: 'failed',
            duration: event.duration,
            error: event.error,
          });
        }
        caseStart = null;
        break;

      case 'case_skip':
        if (currentSuite) {
          currentSuite.skipped++;
          currentSuite.cases.push({
            name: event.name,
            status: 'skipped',
            duration: 0,
          });
        }
        break;

      case 'suite_end':
        if (currentSuite) {
          currentSuite.duration = event.duration;
          suites.push(currentSuite);
          currentSuite = null;
        }
        break;

      case 'log':
        // Logs are not included in the report structure
        break;
    }
  }

  // Handle case where suite_end was never emitted
  if (currentSuite) {
    suites.push(currentSuite);
  }

  const totals = {
    passed: suites.reduce((sum, s) => sum + s.passed, 0),
    failed: suites.reduce((sum, s) => sum + s.failed, 0),
    skipped: suites.reduce((sum, s) => sum + s.skipped, 0),
  };

  return {
    project: '',
    timestamp: firstTs === Infinity ? Date.now() : firstTs,
    duration: lastTs > firstTs ? lastTs - firstTs : 0,
    suites,
    totals,
  };
}
