/**
 * @module resilience/preflight
 * Preflight environment health checker.
 *
 * Validates Docker daemon connectivity, disk space, and orphaned resources
 * before setup/build operations, returning a structured HealthReport.
 */

import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { platform as osPlatform } from 'node:os';
import type {
  CheckStatus,
  OverallHealth,
  HealthCheckResult,
  HealthReport,
  ResilienceConfig,
  SSEBus,
} from '../types.js';
import { ArgusError } from './error-codes.js';

const execFileAsync = promisify(execFileCb);

// =====================================================================
// PreflightChecker
// =====================================================================

export class PreflightChecker {
  constructor(private eventBus?: SSEBus) {}

  /**
   * Check Docker daemon connectivity by running `docker info` with a 5s timeout.
   */
  async checkDockerDaemon(): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      await execFileAsync('docker', ['info'], {
        encoding: 'utf-8',
        timeout: 5_000,
      });
      return {
        name: 'docker_daemon',
        status: 'pass',
        message: 'Docker daemon is reachable',
        details: {},
        duration: Date.now() - start,
      };
    } catch (err) {
      return {
        name: 'docker_daemon',
        status: 'fail',
        message: 'Docker daemon is not reachable',
        details: {
          error: err instanceof Error ? err.message : String(err),
          errorCode: 'DOCKER_UNAVAILABLE',
        },
        duration: Date.now() - start,
      };
    }
  }

  /**
   * Check available disk space against a configurable threshold.
   *
   * Parses `df` output for the root filesystem. Uses `-BG` on Linux
   * and `-g` on macOS for gigabyte units.
   */
  async checkDiskSpace(threshold = '2GB'): Promise<HealthCheckResult> {
    const start = Date.now();
    const requiredGB = parseDiskThreshold(threshold);

    try {
      const isMac = osPlatform() === 'darwin';
      const dfArgs = isMac ? ['-g', '/'] : ['-BG', '/'];

      const { stdout } = await execFileAsync('df', dfArgs, {
        encoding: 'utf-8',
        timeout: 5_000,
      });

      const availableGB = parseDfOutput(stdout, isMac);

      if (availableGB === null) {
        return {
          name: 'disk_space',
          status: 'warn',
          message: 'Could not parse disk space information',
          details: { rawOutput: stdout.trim() },
          duration: Date.now() - start,
        };
      }

      let status: CheckStatus;
      if (availableGB < requiredGB) {
        status = 'fail';
      } else if (availableGB < requiredGB * 2) {
        status = 'warn';
      } else {
        status = 'pass';
      }

      return {
        name: 'disk_space',
        status,
        message: `${availableGB}GB available (threshold: ${requiredGB}GB)`,
        details: { availableGB, requiredGB, threshold },
        duration: Date.now() - start,
      };
    } catch (err) {
      return {
        name: 'disk_space',
        status: 'warn',
        message: 'Could not check disk space',
        details: { error: err instanceof Error ? err.message : String(err) },
        duration: Date.now() - start,
      };
    }
  }

  /**
   * Check for orphaned ArgusAI containers and networks for a given project.
   *
   * Runs `docker ps -a --filter label=argusai.project=<name>` and
   * `docker network ls --filter label=argusai.project=<name>`.
   */
  async checkOrphans(projectName: string, currentRunId?: string): Promise<HealthCheckResult> {
    const start = Date.now();
    const orphans: Array<{ type: string; name: string; id: string }> = [];

    try {
      const { stdout: containerOutput } = await execFileAsync('docker', [
        'ps', '-a',
        '--filter', `label=argusai.project=${projectName}`,
        '--format', '{{.ID}}\t{{.Names}}\t{{.Labels}}',
      ], { encoding: 'utf-8', timeout: 10_000 });

      for (const line of containerOutput.trim().split('\n')) {
        if (!line.trim()) continue;
        const [id, name, labels] = line.split('\t');
        if (!id || !name) continue;
        if (currentRunId && labels?.includes(`argusai.run-id=${currentRunId}`)) continue;
        orphans.push({ type: 'container', name: name.trim(), id: id.trim() });
      }
    } catch {
      // Docker ps failed — skip container check
    }

    try {
      const { stdout: networkOutput } = await execFileAsync('docker', [
        'network', 'ls',
        '--filter', `label=argusai.project=${projectName}`,
        '--format', '{{.ID}}\t{{.Name}}',
      ], { encoding: 'utf-8', timeout: 10_000 });

      for (const line of networkOutput.trim().split('\n')) {
        if (!line.trim()) continue;
        const [id, name] = line.split('\t');
        if (!id || !name) continue;
        orphans.push({ type: 'network', name: name.trim(), id: id.trim() });
      }
    } catch {
      // Docker network ls failed — skip network check
    }

    const status: CheckStatus = orphans.length > 0 ? 'warn' : 'pass';
    return {
      name: 'orphan_resources',
      status,
      message: orphans.length > 0
        ? `Found ${orphans.length} orphaned resource(s)`
        : 'No orphaned resources detected',
      details: { orphans, count: orphans.length },
      duration: Date.now() - start,
    };
  }

  /**
   * Run all preflight checks and aggregate into a HealthReport.
   *
   * Overall status: `unhealthy` if any check fails, `degraded` if any warns,
   * `healthy` otherwise.
   */
  async runAll(
    config: ResilienceConfig['preflight'],
    projectName: string,
    currentRunId?: string,
  ): Promise<HealthReport> {
    const start = Date.now();

    this.eventBus?.emit('resilience', {
      event: 'preflight_start',
      data: { type: 'preflight_start', project: projectName, timestamp: Date.now() },
    });

    const checks: HealthCheckResult[] = [];

    // Docker daemon check (always run)
    const dockerResult = await this.checkDockerDaemon();
    checks.push(dockerResult);
    this.emitCheckEvent(dockerResult);

    // Disk space check
    const diskResult = await this.checkDiskSpace(config.diskSpaceThreshold);
    checks.push(diskResult);
    this.emitCheckEvent(diskResult);

    // Orphan check
    const orphanResult = await this.checkOrphans(projectName, currentRunId);
    checks.push(orphanResult);
    this.emitCheckEvent(orphanResult);

    const overall = computeOverallHealth(checks);
    const duration = Date.now() - start;

    this.eventBus?.emit('resilience', {
      event: 'preflight_end',
      data: { type: 'preflight_end', overall, duration, timestamp: Date.now() },
    });

    return { overall, checks, timestamp: Date.now(), duration };
  }

  private emitCheckEvent(result: HealthCheckResult): void {
    this.eventBus?.emit('resilience', {
      event: 'preflight_check',
      data: {
        type: 'preflight_check',
        name: result.name,
        status: result.status,
        message: result.message,
        timestamp: Date.now(),
      },
    });
  }
}

// =====================================================================
// Helpers
// =====================================================================

/** Compute overall health from individual check results. */
export function computeOverallHealth(checks: HealthCheckResult[]): OverallHealth {
  if (checks.some(c => c.status === 'fail')) return 'unhealthy';
  if (checks.some(c => c.status === 'warn')) return 'degraded';
  return 'healthy';
}

/** Parse a threshold string like "2GB" or "500MB" into gigabytes. */
function parseDiskThreshold(threshold: string): number {
  const match = threshold.trim().match(/^(\d+(?:\.\d+)?)\s*(GB|MB|TB)$/i);
  if (!match) return 2;

  const value = parseFloat(match[1]!);
  const unit = match[2]!.toUpperCase();

  switch (unit) {
    case 'TB': return value * 1024;
    case 'GB': return value;
    case 'MB': return value / 1024;
    default: return 2;
  }
}

/**
 * Parse `df` output to extract available space in GB.
 *
 * Expects the second line of df output with columns:
 * Filesystem  Size  Used  Avail  Use%  Mounted
 */
function parseDfOutput(output: string, isMac: boolean): number | null {
  const lines = output.trim().split('\n');
  if (lines.length < 2) return null;

  const dataLine = lines[1]!;
  const parts = dataLine.trim().split(/\s+/);
  // Available is typically the 4th column (index 3)
  if (parts.length < 4) return null;

  const availStr = parts[3]!;
  const parsed = parseInt(availStr, 10);
  if (isNaN(parsed)) return null;

  return parsed;
}
