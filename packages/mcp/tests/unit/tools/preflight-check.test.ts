/**
 * Unit tests for argus_preflight_check tool handler.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionManager } from '../../../src/session.js';

const mockCheckDockerDaemon = vi.fn().mockResolvedValue({
  name: 'docker_daemon',
  status: 'pass',
  message: 'Docker daemon is reachable',
  details: {},
  duration: 10,
});
const mockCheckDiskSpace = vi.fn().mockResolvedValue({
  name: 'disk_space',
  status: 'pass',
  message: '50GB available (threshold: 2GB)',
  details: { availableGB: 50, requiredGB: 2 },
  duration: 5,
});
const mockCheckOrphans = vi.fn().mockResolvedValue({
  name: 'orphan_resources',
  status: 'pass',
  message: 'No orphaned resources detected',
  details: { orphans: [], count: 0 },
  duration: 8,
});
const mockDetectAndCleanup = vi.fn().mockResolvedValue({
  found: [],
  removed: [],
  failed: [],
  duration: 0,
});

vi.mock('argusai-core', async (importOriginal) => {
  const original = await importOriginal<typeof import('argusai-core')>();
  return {
    ...original,
    PreflightChecker: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
      this.checkDockerDaemon = mockCheckDockerDaemon;
      this.checkDiskSpace = mockCheckDiskSpace;
      this.checkOrphans = mockCheckOrphans;
      this.runAll = vi.fn();
    }),
    computeOverallHealth: vi.fn().mockReturnValue('healthy'),
    OrphanCleaner: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
      this.detectAndCleanup = mockDetectAndCleanup;
    }),
  };
});

import { handlePreflightCheck } from '../../../src/tools/preflight-check.js';
import { OrphanCleaner } from 'argusai-core';

function mockConfig() {
  return {
    version: '1',
    project: { name: 'test-project' },
    network: { name: 'test-net' },
    resilience: {
      preflight: { enabled: true, diskSpaceThreshold: '2GB', cleanOrphans: false },
      container: { restartOnFailure: true, maxRestarts: 3, restartDelay: '2s', restartBackoff: 'exponential' as const },
      network: { portConflictStrategy: 'auto' as const, verifyConnectivity: true },
      circuitBreaker: { enabled: true, failureThreshold: 5, resetTimeoutMs: 30000 },
    },
  };
}

describe('handlePreflightCheck', () => {
  let sessionManager: SessionManager;

  beforeEach(() => {
    sessionManager = new SessionManager();
    vi.clearAllMocks();
    mockCheckDockerDaemon.mockResolvedValue({
      name: 'docker_daemon', status: 'pass', message: 'Docker daemon is reachable', details: {}, duration: 10,
    });
    mockCheckDiskSpace.mockResolvedValue({
      name: 'disk_space', status: 'pass', message: '50GB available', details: {}, duration: 5,
    });
    mockCheckOrphans.mockResolvedValue({
      name: 'orphan_resources', status: 'pass', message: 'No orphans', details: { orphans: [], count: 0 }, duration: 8,
    });
  });

  it('should run all checks and return healthy report', async () => {
    sessionManager.create('/test/project', mockConfig() as never, '/test/project/e2e.yaml');

    const result = await handlePreflightCheck(
      { projectPath: '/test/project' },
      sessionManager,
    );

    expect(result.healthReport.overall).toBe('healthy');
    expect(result.healthReport.checks).toHaveLength(3);
    expect(result.autoFixApplied).toBe(false);
    expect(result.circuitBreakerState).toBeDefined();
    expect(result.circuitBreakerState?.state).toBe('closed');
  });

  it('should skip disk check when skipDiskCheck is true', async () => {
    sessionManager.create('/test/project', mockConfig() as never, '/test/project/e2e.yaml');

    const result = await handlePreflightCheck(
      { projectPath: '/test/project', skipDiskCheck: true },
      sessionManager,
    );

    expect(result.healthReport.checks).toHaveLength(2);
    expect(mockCheckDiskSpace).not.toHaveBeenCalled();
  });

  it('should skip orphan check when skipOrphanCheck is true', async () => {
    sessionManager.create('/test/project', mockConfig() as never, '/test/project/e2e.yaml');

    const result = await handlePreflightCheck(
      { projectPath: '/test/project', skipOrphanCheck: true },
      sessionManager,
    );

    expect(result.healthReport.checks).toHaveLength(2);
    expect(mockCheckOrphans).not.toHaveBeenCalled();
  });

  it('should run OrphanCleaner when autoFix is true', async () => {
    sessionManager.create('/test/project', mockConfig() as never, '/test/project/e2e.yaml');

    const result = await handlePreflightCheck(
      { projectPath: '/test/project', autoFix: true },
      sessionManager,
    );

    expect(result.autoFixApplied).toBe(true);
    expect(OrphanCleaner).toHaveBeenCalled();
    expect(mockDetectAndCleanup).toHaveBeenCalled();
  });

  it('should throw when session does not exist', async () => {
    await expect(
      handlePreflightCheck({ projectPath: '/nonexistent' }, sessionManager),
    ).rejects.toThrow('No active session');
  });
});
