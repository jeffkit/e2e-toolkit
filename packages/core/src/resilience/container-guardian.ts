/**
 * @module resilience/container-guardian
 * Container auto-restart with configurable backoff and diagnostics capture.
 *
 * Monitors containers for failure (exited / dead) and automatically
 * restarts them up to `maxRestarts` times, capturing diagnostics
 * before each attempt.
 */

import type {
  ResilienceConfig,
  ContainerDiagnostics,
  RestartHistory,
  SSEBus,
} from '../types.js';
import {
  getContainerStatus,
  getContainerLogs,
  stopContainer,
  startContainer,
  dockerExec,
} from '../docker-engine.js';
import type { DockerRunOptions } from '../docker-engine.js';
import { computeBackoffDelay, parseDelay } from '../retry-engine.js';
import { ArgusError } from './error-codes.js';

// =====================================================================
// ContainerGuardian
// =====================================================================

export class ContainerGuardian {
  private readonly baseDelayMs: number;

  constructor(
    private config: ResilienceConfig['container'],
    private eventBus?: SSEBus,
  ) {
    this.baseDelayMs = parseDelay(config.restartDelay);
  }

  /**
   * Capture a diagnostic snapshot for a container.
   *
   * Gathers exit code, OOM status, recent logs, and memory stats.
   */
  async captureDiagnostics(containerName: string): Promise<ContainerDiagnostics> {
    let exitCode: number | null = null;
    let oomKilled = false;
    let containerId = '';
    let logs: string[] = [];
    let memoryStats: { limit: number; peak: number } | null = null;

    try {
      const stateJson = await dockerExec([
        'inspect', '--format', '{{json .State}}', containerName,
      ]);
      const state = JSON.parse(stateJson) as {
        ExitCode?: number;
        OOMKilled?: boolean;
      };
      exitCode = state.ExitCode ?? null;
      oomKilled = state.OOMKilled ?? false;
    } catch {
      // inspect may fail if container was removed
    }

    try {
      const idStr = await dockerExec([
        'inspect', '--format', '{{.Id}}', containerName,
      ]);
      containerId = idStr.slice(0, 12);
    } catch {
      // best-effort
    }

    try {
      const logOutput = await getContainerLogs(containerName, 100);
      logs = logOutput.split('\n').filter(Boolean);
    } catch {
      // logs may not be available
    }

    try {
      const statsJson = await dockerExec([
        'stats', '--no-stream', '--format', '{{json .}}', containerName,
      ]);
      const stats = JSON.parse(statsJson) as {
        MemUsage?: string;
      };
      if (stats.MemUsage) {
        const parts = stats.MemUsage.split('/').map(s => s.trim());
        memoryStats = {
          peak: parseMemoryString(parts[0] ?? '0'),
          limit: parseMemoryString(parts[1] ?? '0'),
        };
      }
    } catch {
      // stats may not be available for stopped containers
    }

    return {
      containerId,
      containerName,
      exitCode,
      oomKilled,
      logs,
      memoryStats,
      timestamp: Date.now(),
    };
  }

  /**
   * Monitor a container and restart it on failure with backoff.
   *
   * Returns `null` if the container is healthy, or a `RestartHistory`
   * if restart attempts were made.
   *
   * @throws {ArgusError} CONTAINER_RESTART_EXHAUSTED when maxRestarts is exceeded
   */
  async monitorAndRestart(
    containerName: string,
    runOptions: DockerRunOptions,
    labels: Record<string, string>,
  ): Promise<RestartHistory | null> {
    const status = await getContainerStatus(containerName);

    if (status !== 'exited' && status !== 'dead') {
      return null;
    }

    if (!this.config.restartOnFailure) {
      return null;
    }

    const history: RestartHistory = {
      containerName,
      attempts: [],
      finalStatus: 'exhausted',
    };

    for (let attempt = 1; attempt <= this.config.maxRestarts; attempt++) {
      const diag = await this.captureDiagnostics(containerName);
      const reason = diag.oomKilled ? 'OOM' : `exit code ${diag.exitCode}`;

      const delayMs = computeBackoffDelay(
        this.baseDelayMs,
        attempt,
        this.config.restartBackoff,
      );

      this.eventBus?.emit('resilience', {
        event: 'restart_attempt',
        data: {
          type: 'restart_attempt',
          container: containerName,
          attempt,
          reason,
          delay: delayMs,
          timestamp: Date.now(),
        },
      });

      history.attempts.push({
        ...diag,
        attemptNumber: attempt,
        delayMs,
      });

      await sleep(delayMs);

      try {
        await stopContainer(containerName);
      } catch {
        // force-remove may fail if already gone
      }

      const restartStart = Date.now();
      try {
        await startContainer({
          ...runOptions,
          labels: { ...runOptions.labels, ...labels },
        });
      } catch {
        continue;
      }

      await sleep(1000);
      const newStatus = await getContainerStatus(containerName);

      if (newStatus === 'running') {
        const duration = Date.now() - restartStart;
        history.finalStatus = 'recovered';

        this.eventBus?.emit('resilience', {
          event: 'restart_success',
          data: {
            type: 'restart_success',
            container: containerName,
            attempt,
            duration,
            timestamp: Date.now(),
          },
        });

        return history;
      }
    }

    this.eventBus?.emit('resilience', {
      event: 'restart_exhausted',
      data: {
        type: 'restart_exhausted',
        container: containerName,
        attempts: history.attempts.length,
        timestamp: Date.now(),
      },
    });

    throw new ArgusError(
      'CONTAINER_RESTART_EXHAUSTED',
      `Container "${containerName}" failed after ${this.config.maxRestarts} restart attempts`,
      { history },
    );
  }
}

// =====================================================================
// Helpers
// =====================================================================

function parseMemoryString(s: string): number {
  const match = s.trim().match(/^([\d.]+)\s*(B|KiB|MiB|GiB|kB|MB|GB)?$/i);
  if (!match) return 0;
  const value = parseFloat(match[1]!);
  const unit = (match[2] ?? 'B').toLowerCase();
  const multipliers: Record<string, number> = {
    b: 1,
    kb: 1000,
    kib: 1024,
    mb: 1_000_000,
    mib: 1_048_576,
    gb: 1_000_000_000,
    gib: 1_073_741_824,
  };
  return Math.round(value * (multipliers[unit] ?? 1));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
