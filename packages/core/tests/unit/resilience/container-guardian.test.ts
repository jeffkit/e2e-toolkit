/**
 * Unit tests for resilience/container-guardian module.
 *
 * Mocks docker-engine and retry-engine to avoid real Docker calls.
 * Covers: captureDiagnostics, monitorAndRestart (success/exhaustion/backoff).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ResilienceConfig, SSEBus, SSEMessage } from '../../../src/types.js';

vi.mock('../../../src/docker-engine.js', () => ({
  getContainerStatus: vi.fn(),
  getContainerLogs: vi.fn(),
  stopContainer: vi.fn(),
  startContainer: vi.fn(),
  dockerExec: vi.fn(),
}));

import {
  getContainerStatus,
  getContainerLogs,
  stopContainer,
  startContainer,
  dockerExec,
} from '../../../src/docker-engine.js';
import { ContainerGuardian } from '../../../src/resilience/container-guardian.js';
import { ArgusError } from '../../../src/resilience/error-codes.js';

const mockGetContainerStatus = vi.mocked(getContainerStatus);
const mockGetContainerLogs = vi.mocked(getContainerLogs);
const mockStopContainer = vi.mocked(stopContainer);
const mockStartContainer = vi.mocked(startContainer);
const mockDockerExec = vi.mocked(dockerExec);

const defaultContainerConfig: ResilienceConfig['container'] = {
  restartOnFailure: true,
  maxRestarts: 3,
  restartDelay: '100ms',
  restartBackoff: 'exponential',
};

function createMockBus(): SSEBus & { events: Array<{ channel: string; msg: SSEMessage }> } {
  const events: Array<{ channel: string; msg: SSEMessage }> = [];
  return {
    events,
    emit(channel: string, msg: SSEMessage) {
      events.push({ channel, msg });
    },
    subscribe: () => () => {},
  };
}

describe('ContainerGuardian', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // =================================================================
  // captureDiagnostics
  // =================================================================

  describe('captureDiagnostics', () => {
    it('should capture exit code and OOM status from docker inspect', async () => {
      mockDockerExec.mockImplementation(async (args: string[]) => {
        if (args[0] === 'inspect' && args[1] === '--format' && args[2] === '{{json .State}}') {
          return JSON.stringify({ ExitCode: 137, OOMKilled: true });
        }
        if (args[0] === 'inspect' && args[2] === '{{.Id}}') {
          return 'abc123def456';
        }
        if (args[0] === 'stats') {
          return JSON.stringify({ MemUsage: '256MiB / 512MiB' });
        }
        return '';
      });
      mockGetContainerLogs.mockResolvedValue('line1\nline2\nline3');

      const guardian = new ContainerGuardian(defaultContainerConfig);
      const diag = await guardian.captureDiagnostics('test-container');

      expect(diag.exitCode).toBe(137);
      expect(diag.oomKilled).toBe(true);
      expect(diag.containerName).toBe('test-container');
      expect(diag.logs).toEqual(['line1', 'line2', 'line3']);
      expect(diag.containerId).toBe('abc123def456');
    });

    it('should handle docker inspect failures gracefully', async () => {
      mockDockerExec.mockRejectedValue(new Error('container not found'));
      mockGetContainerLogs.mockRejectedValue(new Error('no logs'));

      const guardian = new ContainerGuardian(defaultContainerConfig);
      const diag = await guardian.captureDiagnostics('gone-container');

      expect(diag.exitCode).toBeNull();
      expect(diag.oomKilled).toBe(false);
      expect(diag.logs).toEqual([]);
      expect(diag.memoryStats).toBeNull();
    });
  });

  // =================================================================
  // monitorAndRestart
  // =================================================================

  describe('monitorAndRestart', () => {
    const runOptions = {
      name: 'test-api',
      image: 'test-api:latest',
      ports: ['3000:3000'],
      network: 'test-net',
    };

    it('should return null when container is running', async () => {
      mockGetContainerStatus.mockResolvedValue('running');

      const guardian = new ContainerGuardian(defaultContainerConfig);
      const result = await guardian.monitorAndRestart('test-api', runOptions, {});

      expect(result).toBeNull();
    });

    it('should return null when restartOnFailure is disabled', async () => {
      mockGetContainerStatus.mockResolvedValue('exited');

      const guardian = new ContainerGuardian({
        ...defaultContainerConfig,
        restartOnFailure: false,
      });
      const result = await guardian.monitorAndRestart('test-api', runOptions, {});

      expect(result).toBeNull();
    });

    it('should restart successfully on second attempt', async () => {
      let statusCallCount = 0;
      mockGetContainerStatus.mockImplementation(async () => {
        statusCallCount++;
        if (statusCallCount === 1) return 'exited';
        if (statusCallCount === 2) return 'exited';
        return 'running';
      });

      mockDockerExec.mockImplementation(async (args: string[]) => {
        if (args[0] === 'inspect' && args[2] === '{{json .State}}') {
          return JSON.stringify({ ExitCode: 1, OOMKilled: false });
        }
        if (args[0] === 'inspect' && args[2] === '{{.Id}}') {
          return 'abc123';
        }
        return '';
      });
      mockGetContainerLogs.mockResolvedValue('error log');
      mockStopContainer.mockResolvedValue(undefined);
      mockStartContainer.mockResolvedValue('abc123');

      const bus = createMockBus();
      const guardian = new ContainerGuardian(defaultContainerConfig, bus);
      const result = await guardian.monitorAndRestart('test-api', runOptions, {});

      expect(result).not.toBeNull();
      expect(result!.finalStatus).toBe('recovered');
      expect(result!.attempts.length).toBeGreaterThanOrEqual(1);

      const successEvents = bus.events.filter(
        e => (e.msg as { event: string }).event === 'restart_success',
      );
      expect(successEvents.length).toBe(1);
    });

    it('should throw CONTAINER_RESTART_EXHAUSTED after maxRestarts', async () => {
      mockGetContainerStatus.mockResolvedValue('exited');
      mockDockerExec.mockImplementation(async (args: string[]) => {
        if (args[0] === 'inspect' && args[2] === '{{json .State}}') {
          return JSON.stringify({ ExitCode: 137, OOMKilled: true });
        }
        if (args[0] === 'inspect' && args[2] === '{{.Id}}') {
          return 'abc123';
        }
        return '';
      });
      mockGetContainerLogs.mockResolvedValue('OOM killed');
      mockStopContainer.mockResolvedValue(undefined);
      mockStartContainer.mockResolvedValue('abc123');

      const bus = createMockBus();
      const guardian = new ContainerGuardian(
        { ...defaultContainerConfig, maxRestarts: 2 },
        bus,
      );

      await expect(
        guardian.monitorAndRestart('test-api', runOptions, {}),
      ).rejects.toThrow(ArgusError);

      try {
        await guardian.monitorAndRestart('test-api', runOptions, {});
      } catch (err) {
        expect(err).toBeInstanceOf(ArgusError);
        expect((err as ArgusError).code).toBe('CONTAINER_RESTART_EXHAUSTED');
      }

      const exhaustedEvents = bus.events.filter(
        e => (e.msg as { event: string }).event === 'restart_exhausted',
      );
      expect(exhaustedEvents.length).toBeGreaterThanOrEqual(1);
    });

    it('should apply exponential backoff delays', async () => {
      mockGetContainerStatus.mockResolvedValue('exited');
      mockDockerExec.mockResolvedValue(
        JSON.stringify({ ExitCode: 1, OOMKilled: false }),
      );
      mockGetContainerLogs.mockResolvedValue('');
      mockStopContainer.mockResolvedValue(undefined);
      mockStartContainer.mockResolvedValue('abc123');

      const bus = createMockBus();
      const guardian = new ContainerGuardian(
        { ...defaultContainerConfig, maxRestarts: 3, restartDelay: '100ms', restartBackoff: 'exponential' },
        bus,
      );

      try {
        await guardian.monitorAndRestart('test-api', runOptions, {});
      } catch {
        // expected
      }

      const attemptEvents = bus.events
        .filter(e => (e.msg as { event: string }).event === 'restart_attempt')
        .map(e => (e.msg as { data: { delay: number } }).data.delay);

      // computeBackoffDelay: attempt 1 → base, attempt 2 → base*2^0=100, attempt 3 → base*2^1=200
      expect(attemptEvents[0]).toBe(100);
      expect(attemptEvents[1]).toBe(100);
      expect(attemptEvents[2]).toBe(200);
    });

    it('should apply linear backoff delays', async () => {
      mockGetContainerStatus.mockResolvedValue('exited');
      mockDockerExec.mockResolvedValue(
        JSON.stringify({ ExitCode: 1, OOMKilled: false }),
      );
      mockGetContainerLogs.mockResolvedValue('');
      mockStopContainer.mockResolvedValue(undefined);
      mockStartContainer.mockResolvedValue('abc123');

      const bus = createMockBus();
      const guardian = new ContainerGuardian(
        { ...defaultContainerConfig, maxRestarts: 3, restartDelay: '100ms', restartBackoff: 'linear' },
        bus,
      );

      try {
        await guardian.monitorAndRestart('test-api', runOptions, {});
      } catch {
        // expected
      }

      const attemptEvents = bus.events
        .filter(e => (e.msg as { event: string }).event === 'restart_attempt')
        .map(e => (e.msg as { data: { delay: number } }).data.delay);

      expect(attemptEvents[0]).toBe(100);
      expect(attemptEvents[1]).toBe(200);
      expect(attemptEvents[2]).toBe(400);
    });
  });
});
