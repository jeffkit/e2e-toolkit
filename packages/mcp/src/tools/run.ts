/**
 * @module tools/run
 * preflight_run + preflight_run_suite — Execute test suites.
 */

import path from 'node:path';
import {
  loadYAMLTests,
  executeYAMLSuite,
  createDefaultRegistry,
  type TestEvent,
  type TestSuiteConfig,
  type AIFriendlyTestResult,
} from '@preflight/core';
import { SessionManager, SessionError } from '../session.js';
import type { ResultFormatter } from '../formatters/result-formatter.js';

export interface RunResult {
  status: 'passed' | 'failed';
  totals: { passed: number; failed: number; skipped: number; total: number };
  duration: number;
  suites: Array<{
    id: string;
    name: string;
    status: 'passed' | 'failed';
    duration: number;
    passed: number;
    failed: number;
    skipped: number;
    cases: AIFriendlyTestResult[];
  }>;
}

/**
 * Handle the preflight_run MCP tool call.
 * Executes all (or filtered) test suites and returns AI-friendly results.
 *
 * @param params - Tool input with projectPath, optional suite filter and parallel override
 * @param sessionManager - Session store for tracking project state
 * @param formatter - Converts raw TestEvents into AIFriendlyTestResult format
 * @returns Structured run result with per-suite/per-case outcomes and diagnostics
 * @throws {SessionError} NOT_RUNNING if setup not done, SUITE_NOT_FOUND if filter matches nothing
 */
export async function handleRun(
  params: { projectPath: string; filter?: string; parallel?: boolean },
  sessionManager: SessionManager,
  formatter: ResultFormatter,
): Promise<RunResult> {
  const session = sessionManager.getOrThrow(params.projectPath);

  if (session.state !== 'running') {
    throw new SessionError('NOT_RUNNING', 'Environment not set up. Call preflight_setup first.');
  }

  const config = session.config;
  if (!config.tests?.suites || config.tests.suites.length === 0) {
    return {
      status: 'passed',
      totals: { passed: 0, failed: 0, skipped: 0, total: 0 },
      duration: 0,
      suites: [],
    };
  }

  let suites = config.tests.suites;

  if (params.filter) {
    const filterIds = params.filter.split(',').map(s => s.trim());
    suites = suites.filter((s: TestSuiteConfig) => filterIds.includes(s.id));
    if (suites.length === 0) {
      throw new SessionError('SUITE_NOT_FOUND', `No suites found matching filter: ${params.filter}`);
    }
  }

  return executeSuites(suites, session, formatter);
}

/**
 * Handle the preflight_run_suite MCP tool call.
 * Executes a single test suite by ID and returns AI-friendly results.
 *
 * @param params - Tool input with projectPath and suiteId
 * @param sessionManager - Session store for tracking project state
 * @param formatter - Converts raw TestEvents into AIFriendlyTestResult format
 * @returns Structured run result for the single suite
 * @throws {SessionError} NOT_RUNNING if setup not done, SUITE_NOT_FOUND if suiteId not found
 */
export async function handleRunSuite(
  params: { projectPath: string; suiteId: string },
  sessionManager: SessionManager,
  formatter: ResultFormatter,
): Promise<RunResult> {
  const session = sessionManager.getOrThrow(params.projectPath);

  if (session.state !== 'running') {
    throw new SessionError('NOT_RUNNING', 'Environment not set up. Call preflight_setup first.');
  }

  const config = session.config;
  const suites = (config.tests?.suites ?? []).filter(
    (s: TestSuiteConfig) => s.id === params.suiteId,
  );

  if (suites.length === 0) {
    throw new SessionError('SUITE_NOT_FOUND', `Suite "${params.suiteId}" not found in configuration`);
  }

  return executeSuites(suites, session, formatter);
}

async function executeSuites(
  suites: TestSuiteConfig[],
  session: import('../session.js').ProjectSession,
  formatter: ResultFormatter,
): Promise<RunResult> {
  const totalStart = Date.now();
  const suiteResults: RunResult['suites'] = [];
  let totalPassed = 0;
  let totalFailed = 0;
  let totalSkipped = 0;

  const containerName = getContainerName(session.config);
  const baseUrl = getBaseUrl(session.config);

  for (const suiteConfig of suites) {
    const events: TestEvent[] = [];
    const suiteStart = Date.now();

    if (suiteConfig.runner === 'yaml' || !suiteConfig.runner) {
      if (suiteConfig.file) {
        const filePath = path.resolve(session.projectPath, suiteConfig.file);
        const yamlSuite = await loadYAMLTests(filePath);

        for await (const event of executeYAMLSuite(yamlSuite, {
          baseUrl,
          variables: { config: {}, runtime: {}, env: { ...process.env } as Record<string, string> },
          containerName,
        })) {
          events.push(event);
        }
      }
    } else {
      const registry = await createDefaultRegistry();
      const runner = registry.get(suiteConfig.runner);
      if (runner) {
        const cwd = session.projectPath;
        const target = suiteConfig.file ?? suiteConfig.command ?? '';
        for await (const event of runner.run({
          cwd,
          target,
          env: process.env as Record<string, string>,
          timeout: 300_000,
        })) {
          events.push(event);
        }
      }
    }

    const cases = formatter.formatEvents(events, suiteConfig.name);
    let suitePassed = 0;
    let suiteFailed = 0;
    let suiteSkipped = 0;

    for (const c of cases) {
      if (c.status === 'passed') suitePassed++;
      else if (c.status === 'failed') suiteFailed++;
      else suiteSkipped++;
    }

    totalPassed += suitePassed;
    totalFailed += suiteFailed;
    totalSkipped += suiteSkipped;

    suiteResults.push({
      id: suiteConfig.id,
      name: suiteConfig.name,
      status: suiteFailed > 0 ? 'failed' : 'passed',
      duration: Date.now() - suiteStart,
      passed: suitePassed,
      failed: suiteFailed,
      skipped: suiteSkipped,
      cases,
    });
  }

  const total = totalPassed + totalFailed + totalSkipped;

  return {
    status: totalFailed > 0 ? 'failed' : 'passed',
    totals: { passed: totalPassed, failed: totalFailed, skipped: totalSkipped, total },
    duration: Date.now() - totalStart,
    suites: suiteResults,
  };
}

function getContainerName(config: import('@preflight/core').E2EConfig): string | undefined {
  if (config.services && config.services.length > 0) {
    return config.services[0]!.container.name;
  }
  return config.service?.container.name;
}

function getBaseUrl(config: import('@preflight/core').E2EConfig): string {
  const svc = config.services?.[0] ?? config.service;
  if (!svc) return 'http://localhost:3000';

  const ports = svc.container.ports;
  if (ports.length > 0) {
    const hostPort = ports[0]!.split(':')[0];
    return `http://localhost:${hostPort}`;
  }
  return 'http://localhost:3000';
}
