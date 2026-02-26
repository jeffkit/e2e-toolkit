/**
 * Unit tests for resilience/preflight module.
 *
 * Mocks child_process.execFile to avoid real Docker daemon calls.
 * Covers: checkDockerDaemon, checkDiskSpace, checkOrphans, runAll aggregation.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { execFile as execFileCb } from 'node:child_process';
import { PreflightChecker, computeOverallHealth } from '../../../src/resilience/preflight.js';
import type { HealthCheckResult, SSEBus } from '../../../src/types.js';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

const execFileMock = execFileCb as unknown as Mock;

function mockExecFile(impl: (bin: string, args: string[]) => { stdout: string; stderr: string }) {
  execFileMock.mockImplementation(
    (bin: string, args: string[], opts: unknown, callback?: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
      if (typeof opts === 'function') {
        callback = opts as (err: Error | null, result: { stdout: string; stderr: string }) => void;
      }
      try {
        const result = impl(bin, args);
        callback?.(null, result);
      } catch (err) {
        callback?.(err as Error, { stdout: '', stderr: '' });
      }
    },
  );
}

function mockExecFileReject(errorMessage: string) {
  execFileMock.mockImplementation(
    (_bin: string, _args: string[], _opts: unknown, callback?: (err: Error | null) => void) => {
      if (typeof _opts === 'function') {
        callback = _opts as (err: Error | null) => void;
      }
      callback?.(new Error(errorMessage));
    },
  );
}

describe('preflight', () => {
  let checker: PreflightChecker;

  beforeEach(() => {
    vi.clearAllMocks();
    checker = new PreflightChecker();
  });

  // =================================================================
  // checkDockerDaemon
  // =================================================================

  describe('checkDockerDaemon', () => {
    it('should return pass when docker info succeeds', async () => {
      mockExecFile((bin, args) => {
        if (bin === 'docker' && args[0] === 'info') {
          return { stdout: 'Server Version: 24.0.7\n', stderr: '' };
        }
        return { stdout: '', stderr: '' };
      });

      const result = await checker.checkDockerDaemon();

      expect(result.name).toBe('docker_daemon');
      expect(result.status).toBe('pass');
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('should return fail when docker info fails', async () => {
      mockExecFileReject('Cannot connect to the Docker daemon');

      const result = await checker.checkDockerDaemon();

      expect(result.name).toBe('docker_daemon');
      expect(result.status).toBe('fail');
      expect(result.details).toHaveProperty('errorCode', 'DOCKER_UNAVAILABLE');
    });
  });

  // =================================================================
  // checkDiskSpace
  // =================================================================

  describe('checkDiskSpace', () => {
    it('should return pass when disk space is above threshold', async () => {
      mockExecFile((bin) => {
        if (bin === 'df') {
          return {
            stdout: 'Filesystem     1G-blocks  Used Available Use% Mounted on\n/dev/sda1          100    50        50  50% /\n',
            stderr: '',
          };
        }
        return { stdout: '', stderr: '' };
      });

      const result = await checker.checkDiskSpace('2GB');

      expect(result.name).toBe('disk_space');
      expect(result.status).toBe('pass');
      expect(result.details).toHaveProperty('availableGB', 50);
    });

    it('should return fail when disk space is below threshold', async () => {
      mockExecFile((bin) => {
        if (bin === 'df') {
          return {
            stdout: 'Filesystem     1G-blocks  Used Available Use% Mounted on\n/dev/sda1          100    99         1  99% /\n',
            stderr: '',
          };
        }
        return { stdout: '', stderr: '' };
      });

      const result = await checker.checkDiskSpace('2GB');

      expect(result.name).toBe('disk_space');
      expect(result.status).toBe('fail');
      expect(result.details).toHaveProperty('availableGB', 1);
    });

    it('should return warn when disk space is close to threshold', async () => {
      mockExecFile((bin) => {
        if (bin === 'df') {
          return {
            stdout: 'Filesystem     1G-blocks  Used Available Use% Mounted on\n/dev/sda1          100    97         3  97% /\n',
            stderr: '',
          };
        }
        return { stdout: '', stderr: '' };
      });

      const result = await checker.checkDiskSpace('2GB');

      expect(result.name).toBe('disk_space');
      expect(result.status).toBe('warn');
    });

    it('should return warn when df command fails', async () => {
      mockExecFileReject('df not found');

      const result = await checker.checkDiskSpace('2GB');

      expect(result.name).toBe('disk_space');
      expect(result.status).toBe('warn');
    });
  });

  // =================================================================
  // checkOrphans
  // =================================================================

  describe('checkOrphans', () => {
    it('should return pass when no orphans found', async () => {
      mockExecFile(() => ({ stdout: '', stderr: '' }));

      const result = await checker.checkOrphans('my-project');

      expect(result.name).toBe('orphan_resources');
      expect(result.status).toBe('pass');
      expect(result.details).toHaveProperty('count', 0);
    });

    it('should return warn when orphan containers found', async () => {
      mockExecFile((bin, args) => {
        if (bin === 'docker' && args.includes('ps')) {
          return { stdout: 'abc123\tmy-container\targusai.run-id=old-run\n', stderr: '' };
        }
        return { stdout: '', stderr: '' };
      });

      const result = await checker.checkOrphans('my-project', 'current-run');

      expect(result.name).toBe('orphan_resources');
      expect(result.status).toBe('warn');
      expect(result.details).toHaveProperty('count', 1);
    });

    it('should exclude containers with current runId', async () => {
      mockExecFile((bin, args) => {
        if (bin === 'docker' && args.includes('ps')) {
          return { stdout: 'abc123\tmy-container\targusai.run-id=current-run\n', stderr: '' };
        }
        return { stdout: '', stderr: '' };
      });

      const result = await checker.checkOrphans('my-project', 'current-run');

      expect(result.status).toBe('pass');
      expect(result.details).toHaveProperty('count', 0);
    });
  });

  // =================================================================
  // runAll
  // =================================================================

  describe('runAll', () => {
    it('should return healthy when all checks pass', async () => {
      mockExecFile((bin, args) => {
        if (bin === 'docker' && args[0] === 'info') {
          return { stdout: 'Server Version: 24.0.7\n', stderr: '' };
        }
        if (bin === 'df') {
          return { stdout: 'Filesystem  1G  Used Available Use%\n/dev/sda1  100  50  50  50%\n', stderr: '' };
        }
        return { stdout: '', stderr: '' };
      });

      const report = await checker.runAll(
        { enabled: true, diskSpaceThreshold: '2GB', cleanOrphans: false },
        'my-project',
      );

      expect(report.overall).toBe('healthy');
      expect(report.checks.length).toBe(3);
      expect(report.duration).toBeGreaterThanOrEqual(0);
    });

    it('should return unhealthy when Docker check fails', async () => {
      let callIdx = 0;
      execFileMock.mockImplementation(
        (bin: string, args: string[], opts: unknown, callback?: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
          if (typeof opts === 'function') {
            callback = opts as (err: Error | null, result: { stdout: string; stderr: string }) => void;
          }
          if (bin === 'docker' && args[0] === 'info') {
            callback?.(new Error('Cannot connect'), { stdout: '', stderr: '' });
            return;
          }
          if (bin === 'df') {
            callback?.(null, { stdout: 'Filesystem  1G  Used Available Use%\n/dev/sda1  100  50  50  50%\n', stderr: '' });
            return;
          }
          callback?.(null, { stdout: '', stderr: '' });
        },
      );

      const report = await checker.runAll(
        { enabled: true, diskSpaceThreshold: '2GB', cleanOrphans: false },
        'test-project',
      );

      expect(report.overall).toBe('unhealthy');
    });

    it('should return degraded when orphans are found', async () => {
      execFileMock.mockImplementation(
        (bin: string, args: string[], opts: unknown, callback?: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
          if (typeof opts === 'function') {
            callback = opts as (err: Error | null, result: { stdout: string; stderr: string }) => void;
          }
          if (bin === 'docker' && args[0] === 'info') {
            callback?.(null, { stdout: 'Server Version: 24.0.7', stderr: '' });
            return;
          }
          if (bin === 'df') {
            callback?.(null, { stdout: 'Filesystem  1G  Used Available Use%\n/dev/sda1  100  50  50  50%\n', stderr: '' });
            return;
          }
          if (bin === 'docker' && args.includes('ps')) {
            callback?.(null, { stdout: 'abc123\torphan-container\targusai.run-id=old\n', stderr: '' });
            return;
          }
          callback?.(null, { stdout: '', stderr: '' });
        },
      );

      const report = await checker.runAll(
        { enabled: true, diskSpaceThreshold: '2GB', cleanOrphans: false },
        'test-project',
        'current-run',
      );

      expect(report.overall).toBe('degraded');
    });

    it('should emit SSE events when eventBus is provided', async () => {
      const emitted: Array<{ channel: string; event: string }> = [];
      const mockBus: SSEBus = {
        emit: (channel, msg) => {
          emitted.push({ channel, event: (msg as { event: string }).event });
        },
        subscribe: () => () => {},
      };

      const checkerWithBus = new PreflightChecker(mockBus);

      mockExecFile(() => ({ stdout: 'OK\nFilesystem  1G  Used Available Use%\n/dev/sda1  100  50  50  50%\n', stderr: '' }));

      await checkerWithBus.runAll(
        { enabled: true, diskSpaceThreshold: '2GB', cleanOrphans: false },
        'test-project',
      );

      const events = emitted.map(e => e.event);
      expect(events).toContain('preflight_start');
      expect(events).toContain('preflight_check');
      expect(events).toContain('preflight_end');
    });
  });

  // =================================================================
  // computeOverallHealth
  // =================================================================

  describe('computeOverallHealth', () => {
    it('should return healthy when all pass', () => {
      const checks: HealthCheckResult[] = [
        { name: 'a', status: 'pass', message: '', details: {}, duration: 0 },
        { name: 'b', status: 'pass', message: '', details: {}, duration: 0 },
      ];
      expect(computeOverallHealth(checks)).toBe('healthy');
    });

    it('should return degraded when any warn', () => {
      const checks: HealthCheckResult[] = [
        { name: 'a', status: 'pass', message: '', details: {}, duration: 0 },
        { name: 'b', status: 'warn', message: '', details: {}, duration: 0 },
      ];
      expect(computeOverallHealth(checks)).toBe('degraded');
    });

    it('should return unhealthy when any fail', () => {
      const checks: HealthCheckResult[] = [
        { name: 'a', status: 'pass', message: '', details: {}, duration: 0 },
        { name: 'b', status: 'fail', message: '', details: {}, duration: 0 },
      ];
      expect(computeOverallHealth(checks)).toBe('unhealthy');
    });

    it('should prioritize fail over warn', () => {
      const checks: HealthCheckResult[] = [
        { name: 'a', status: 'warn', message: '', details: {}, duration: 0 },
        { name: 'b', status: 'fail', message: '', details: {}, duration: 0 },
      ];
      expect(computeOverallHealth(checks)).toBe('unhealthy');
    });

    it('should return healthy for empty checks', () => {
      expect(computeOverallHealth([])).toBe('healthy');
    });
  });
});
