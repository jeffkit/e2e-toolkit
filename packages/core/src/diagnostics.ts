/**
 * @module diagnostics
 * DiagnosticCollector — gathers container logs, health status,
 * mock service request records, and Docker network info on test failure.
 *
 * All collection is parallel with timeouts via Promise.allSettled,
 * so a single unreachable service won't block diagnostics.
 */

import { getContainerLogs, getContainerStatus } from './docker-engine.js';
import type { DiagnosticReport, ContainerStatus, RestartHistory } from './types.js';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFileCb);

export interface DiagnosticCollectorOptions {
  containerNames?: string[];
  mockEndpoints?: Array<{ name: string; port: number }>;
  networkName?: string;
  logLines?: number;
  timeoutMs?: number;
}

export class DiagnosticCollector {
  private readonly defaultLogLines = 50;
  private readonly defaultTimeout = 5000;

  /**
   * Collect all diagnostic information for a failing test case.
   * Runs container logs, health checks, mock requests, and network info in parallel.
   *
   * @param options - Which containers, mocks, and network to inspect
   * @returns Aggregated diagnostic report with all collected data
   */
  async collect(options: DiagnosticCollectorOptions): Promise<DiagnosticReport> {
    const logLines = options.logLines ?? this.defaultLogLines;
    const timeoutMs = options.timeoutMs ?? this.defaultTimeout;

    const [containerLogs, containerHealth, mockRequests, networkInfo] =
      await Promise.all([
        this.collectContainerLogs(options.containerNames ?? [], logLines, timeoutMs),
        this.collectContainerHealth(options.containerNames ?? [], timeoutMs),
        this.collectMockRequests(options.mockEndpoints ?? [], timeoutMs),
        options.networkName
          ? this.collectNetworkInfo(options.networkName, timeoutMs)
          : Promise.resolve(undefined),
      ]);

    return {
      containerLogs,
      containerHealth,
      mockRequests,
      networkInfo,
      collectedAt: Date.now(),
    };
  }

  /**
   * Fetch the last N log lines from each container. Skips unreachable containers.
   *
   * @param containerNames - Docker container names to query
   * @param logLines - Number of tail lines to retrieve per container
   * @param timeoutMs - Per-container timeout in milliseconds
   * @returns Array of log entries (only for reachable containers)
   */
  async collectContainerLogs(
    containerNames: string[],
    logLines: number,
    timeoutMs: number,
  ): Promise<DiagnosticReport['containerLogs']> {
    const results = await Promise.allSettled(
      containerNames.map(async (name) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const rawLogs = await getContainerLogs(name, logLines);
          const lines = rawLogs.split('\n').filter(Boolean);
          return { containerName: name, lines, lineCount: lines.length };
        } finally {
          clearTimeout(timer);
        }
      }),
    );

    return results
      .filter((r): r is PromiseFulfilledResult<DiagnosticReport['containerLogs'][number]> =>
        r.status === 'fulfilled')
      .map(r => r.value);
  }

  /**
   * Query Docker health status and health log for each container.
   *
   * @param containerNames - Docker container names to inspect
   * @param timeoutMs - Per-container timeout in milliseconds
   * @returns Array of health status entries (only for reachable containers)
   */
  async collectContainerHealth(
    containerNames: string[],
    timeoutMs: number,
  ): Promise<DiagnosticReport['containerHealth']> {
    const results = await Promise.allSettled(
      containerNames.map(async (name) => {
        const status: ContainerStatus = await getContainerStatus(name);
        let healthLog: string | undefined;
        try {
          const { stdout } = await execFileAsync('docker', [
            'inspect', '--format', '{{.State.Health.Log}}', name,
          ], { encoding: 'utf-8', timeout: timeoutMs });
          healthLog = stdout.trim();
          if (healthLog === '<nil>' || healthLog === '') healthLog = undefined;
        } catch {
          // Health log not available
        }
        return { containerName: name, status, healthLog };
      }),
    );

    const fulfilled: DiagnosticReport['containerHealth'] = [];
    for (const r of results) {
      if (r.status === 'fulfilled') fulfilled.push(r.value);
    }
    return fulfilled;
  }

  /**
   * Fetch recorded HTTP requests from mock service `/_mock/requests` endpoints.
   *
   * @param mockEndpoints - Mock services to query (name + port)
   * @param timeoutMs - Per-mock timeout in milliseconds
   * @returns Array of request records per mock (empty array for unreachable mocks)
   */
  async collectMockRequests(
    mockEndpoints: Array<{ name: string; port: number }>,
    timeoutMs: number,
  ): Promise<DiagnosticReport['mockRequests']> {
    const results = await Promise.allSettled(
      mockEndpoints.map(async (mock) => {
        const resp = await fetch(`http://localhost:${mock.port}/_mock/requests`, {
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!resp.ok) return { mockName: mock.name, requests: [] };
        const data = await resp.json() as {
          requests: Array<{
            method: string;
            url: string;
            body: unknown;
            headers: Record<string, string | string[] | undefined>;
            timestamp: string;
          }>;
        };
        return { mockName: mock.name, requests: data.requests };
      }),
    );

    return results
      .filter((r): r is PromiseFulfilledResult<DiagnosticReport['mockRequests'][number]> =>
        r.status === 'fulfilled')
      .map(r => r.value);
  }

  /**
   * Inspect a Docker network to list connected containers.
   *
   * @param networkName - Docker network name to inspect
   * @param timeoutMs - Timeout for the docker inspect command
   * @returns Network info with connected container names, or undefined if unreachable
   */
  async collectNetworkInfo(
    networkName: string,
    timeoutMs: number,
  ): Promise<DiagnosticReport['networkInfo'] | undefined> {
    try {
      const { stdout } = await execFileAsync('docker', ['network', 'inspect', networkName, '--format', '{{range .Containers}}{{.Name}} {{end}}'], {
        encoding: 'utf-8',
        timeout: timeoutMs,
      });
      const output = stdout.trim();

      const connectedContainers = output.split(/\s+/).filter(Boolean);
      return { networkName, connectedContainers };
    } catch {
      return undefined;
    }
  }
}

/**
 * Format a RestartHistory into a human-readable diagnostic string.
 *
 * Includes container name, final status, and per-attempt details
 * (exit code, OOM status, delay, and log tail).
 */
export function formatRestartHistory(history: RestartHistory): string {
  const lines: string[] = [];
  lines.push(`Container: ${history.containerName}`);
  lines.push(`Final Status: ${history.finalStatus}`);
  lines.push(`Total Attempts: ${history.attempts.length}`);
  lines.push('---');

  for (const attempt of history.attempts) {
    lines.push(`Attempt #${attempt.attemptNumber} (delay: ${attempt.delayMs}ms)`);
    lines.push(`  Exit Code: ${attempt.exitCode ?? 'N/A'}`);
    lines.push(`  OOM Killed: ${attempt.oomKilled ? 'Yes' : 'No'}`);
    if (attempt.memoryStats) {
      lines.push(`  Memory: peak=${attempt.memoryStats.peak}B / limit=${attempt.memoryStats.limit}B`);
    }
    const logTail = attempt.logs.slice(-5);
    if (logTail.length > 0) {
      lines.push(`  Last ${logTail.length} log lines:`);
      for (const log of logTail) {
        lines.push(`    ${log}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}
