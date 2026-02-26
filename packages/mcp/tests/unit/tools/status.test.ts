/**
 * Unit tests for preflight_status, preflight_logs, preflight_clean,
 * and preflight_mock_requests tool handlers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionManager, SessionError } from '../../../src/session.js';
import { handleStatus } from '../../../src/tools/status.js';
import { handleLogs } from '../../../src/tools/logs.js';
import { handleClean } from '../../../src/tools/clean.js';
import { handleMockRequests } from '../../../src/tools/mock-requests.js';
import type { E2EConfig } from '@preflight/core';

vi.mock('@preflight/core', async (importOriginal) => {
  const orig = await importOriginal() as Record<string, unknown>;
  return {
    ...orig,
    getContainerStatus: vi.fn().mockResolvedValue('running'),
    getContainerLogs: vi.fn().mockResolvedValue('log line 1\nlog line 2'),
    isPortInUse: vi.fn().mockResolvedValue(true),
    stopContainer: vi.fn().mockResolvedValue(undefined),
    removeNetwork: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('node:child_process', async (importOriginal) => {
  const orig = await importOriginal() as Record<string, unknown>;
  return {
    ...orig,
    execFileSync: vi.fn().mockReturnValue('[{}]'),
  };
});

function createSession(
  manager: SessionManager,
  projectPath = '/test/project',
): void {
  const config: E2EConfig = {
    version: '1',
    project: { name: 'test' },
    service: {
      build: { dockerfile: 'Dockerfile', context: '.', image: 'test:latest' },
      container: { name: 'test-app', ports: ['3000:3000'] },
    },
    network: { name: 'test-net' },
  };
  const session = manager.create(projectPath, config, `${projectPath}/e2e.yaml`);
  session.containerIds.set('test-app', 'abc123');
  session.mockServers.set('api-mock', {
    server: { close: vi.fn().mockResolvedValue(undefined) as any },
    port: 9100,
  });
  manager.transition(projectPath, 'built');
  manager.transition(projectPath, 'running');
}

describe('handleStatus', () => {
  let sessionManager: SessionManager;

  beforeEach(() => {
    sessionManager = new SessionManager();
    vi.clearAllMocks();
  });

  it('should return status of all resources', async () => {
    createSession(sessionManager);

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ count: 5 }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );

    const result = await handleStatus({ projectPath: '/test/project' }, sessionManager);

    expect(result.state).toBe('running');
    expect(result.network.name).toBe('test-net');
    expect(result.services).toHaveLength(1);
    expect(result.services[0]!.name).toBe('test-app');
    expect(result.mocks).toHaveLength(1);

    fetchSpy.mockRestore();
  });

  it('should throw for missing session', async () => {
    await expect(handleStatus({ projectPath: '/missing' }, sessionManager))
      .rejects.toThrow(SessionError);
  });
});

describe('handleLogs', () => {
  let sessionManager: SessionManager;

  beforeEach(() => {
    sessionManager = new SessionManager();
    vi.clearAllMocks();
  });

  it('should return container logs', async () => {
    createSession(sessionManager);

    const result = await handleLogs(
      { projectPath: '/test/project', container: 'test-app' },
      sessionManager,
    );

    expect(result.container).toBe('test-app');
    expect(result.lines).toEqual(['log line 1', 'log line 2']);
    expect(result.lineCount).toBe(2);
  });

  it('should throw CONTAINER_NOT_FOUND for unknown container', async () => {
    createSession(sessionManager);

    await expect(handleLogs(
      { projectPath: '/test/project', container: 'unknown-app' },
      sessionManager,
    )).rejects.toThrow(SessionError);
  });
});

describe('handleClean', () => {
  let sessionManager: SessionManager;

  beforeEach(() => {
    sessionManager = new SessionManager();
    vi.clearAllMocks();
  });

  it('should clean up all resources', async () => {
    createSession(sessionManager);

    const result = await handleClean({ projectPath: '/test/project' }, sessionManager);

    expect(result.containers).toHaveLength(1);
    expect(result.containers[0]!.action).toBe('removed');
    expect(result.mocks).toHaveLength(1);
    expect(result.mocks[0]!.action).toBe('stopped');
    expect(result.sessionRemoved).toBe(true);
    expect(sessionManager.has('/test/project')).toBe(false);
  });

  it('should handle session not found gracefully', async () => {
    const result = await handleClean({ projectPath: '/missing' }, sessionManager);

    expect(result.containers).toEqual([]);
    expect(result.sessionRemoved).toBe(false);
  });
});

describe('handleMockRequests', () => {
  let sessionManager: SessionManager;

  beforeEach(() => {
    sessionManager = new SessionManager();
    vi.clearAllMocks();
  });

  it('should fetch mock requests', async () => {
    createSession(sessionManager);

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        requests: [
          { method: 'GET', url: '/data', body: null, headers: {}, timestamp: '2026-01-01T00:00:00Z' },
        ],
      }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );

    const result = await handleMockRequests(
      { projectPath: '/test/project' },
      sessionManager,
    );

    expect(result.mocks).toHaveLength(1);
    expect(result.mocks[0]!.totalRequests).toBe(1);

    fetchSpy.mockRestore();
  });

  it('should throw MOCKS_NOT_RUNNING when no mocks', async () => {
    const config: E2EConfig = {
      version: '1',
      project: { name: 'test' },
      service: {
        build: { dockerfile: 'Dockerfile', context: '.', image: 'test:latest' },
        container: { name: 'test-app', ports: ['3000:3000'] },
      },
    };
    sessionManager.create('/test/no-mocks', config, '/path');

    await expect(handleMockRequests(
      { projectPath: '/test/no-mocks' },
      sessionManager,
    )).rejects.toThrow(SessionError);
  });

  it('should throw MOCK_NOT_FOUND for unknown mock name', async () => {
    createSession(sessionManager);

    await expect(handleMockRequests(
      { projectPath: '/test/project', mockName: 'unknown-mock' },
      sessionManager,
    )).rejects.toThrow(SessionError);
  });
});
