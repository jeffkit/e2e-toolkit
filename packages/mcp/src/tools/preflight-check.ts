/**
 * @module tools/preflight-check
 * argus_preflight_check — Run preflight health checks on the environment.
 *
 * Validates Docker daemon, disk space, and orphaned resources.
 * Optionally auto-fixes by cleaning orphans.
 */

import {
  PreflightChecker,
  computeOverallHealth,
  OrphanCleaner,
  type HealthReport,
  type HealthCheckResult,
  type CircuitBreakerState,
} from 'argusai-core';
import { SessionManager } from '../session.js';

export interface PreflightCheckResult {
  healthReport: HealthReport;
  circuitBreakerState?: CircuitBreakerState;
  autoFixApplied: boolean;
}

/**
 * Handle the argus_preflight_check MCP tool call.
 *
 * Runs preflight checks with optional skip flags, then optionally
 * auto-fixes by cleaning orphaned resources.
 *
 * @param params - Tool input with projectPath and optional skip/autoFix flags
 * @param sessionManager - Session store for tracking project state
 * @returns Preflight health report with optional circuit breaker state
 */
export async function handlePreflightCheck(
  params: {
    projectPath: string;
    skipDiskCheck?: boolean;
    skipOrphanCheck?: boolean;
    autoFix?: boolean;
  },
  sessionManager: SessionManager,
): Promise<PreflightCheckResult> {
  const session = sessionManager.getOrThrow(params.projectPath);
  const config = session.config;
  const bus = sessionManager.eventBus;

  const preflightConfig = config.resilience?.preflight ?? {
    enabled: true,
    diskSpaceThreshold: '2GB',
    cleanOrphans: false,
  };

  const checker = new PreflightChecker(bus);
  const start = Date.now();

  bus?.emit('resilience', {
    event: 'preflight_start',
    data: { type: 'preflight_start', project: config.project.name, timestamp: Date.now() },
  });

  const checks: HealthCheckResult[] = [];

  const dockerResult = await checker.checkDockerDaemon();
  checks.push(dockerResult);

  if (!params.skipDiskCheck) {
    const diskResult = await checker.checkDiskSpace(preflightConfig.diskSpaceThreshold);
    checks.push(diskResult);
  }

  if (!params.skipOrphanCheck) {
    const orphanResult = await checker.checkOrphans(config.project.name, session.runId);
    checks.push(orphanResult);
  }

  const overall = computeOverallHealth(checks);
  const duration = Date.now() - start;

  bus?.emit('resilience', {
    event: 'preflight_end',
    data: { type: 'preflight_end', overall, duration, timestamp: Date.now() },
  });

  const healthReport: HealthReport = { overall, checks, timestamp: Date.now(), duration };

  let autoFixApplied = false;
  if (params.autoFix) {
    const cleaner = new OrphanCleaner(config.project.name, session.runId, bus);
    await cleaner.detectAndCleanup();
    autoFixApplied = true;
  }

  const circuitBreakerState = session.circuitBreaker?.getState();

  return {
    healthReport,
    circuitBreakerState,
    autoFixApplied,
  };
}
