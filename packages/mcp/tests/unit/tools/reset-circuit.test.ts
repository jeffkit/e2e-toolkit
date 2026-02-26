/**
 * Unit tests for argus_reset_circuit tool handler.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionManager } from '../../../src/session.js';
import { handleResetCircuit } from '../../../src/tools/reset-circuit.js';

function mockConfig(cbEnabled = true) {
  return {
    version: '1',
    project: { name: 'test-project' },
    network: { name: 'test-net' },
    resilience: {
      preflight: { enabled: true, diskSpaceThreshold: '2GB', cleanOrphans: false },
      container: { restartOnFailure: true, maxRestarts: 3, restartDelay: '2s', restartBackoff: 'exponential' as const },
      network: { portConflictStrategy: 'auto' as const, verifyConnectivity: true },
      circuitBreaker: { enabled: cbEnabled, failureThreshold: 5, resetTimeoutMs: 30000 },
    },
  };
}

describe('handleResetCircuit', () => {
  let sessionManager: SessionManager;

  beforeEach(() => {
    sessionManager = new SessionManager();
    vi.clearAllMocks();
  });

  it('should reset an open circuit to half-open', async () => {
    sessionManager.create('/test/project', mockConfig() as never, '/test/project/e2e.yaml');
    const session = sessionManager.getOrThrow('/test/project');
    const cb = session.circuitBreaker!;

    // Force the circuit into open state by recording failures
    for (let i = 0; i < 5; i++) {
      try {
        await cb.execute(async () => { throw new Error('Docker down'); });
      } catch { /* expected */ }
    }

    expect(cb.getState().state).toBe('open');

    const result = await handleResetCircuit(
      { projectPath: '/test/project' },
      sessionManager,
    );

    expect(result.previousState).toBe('open');
    expect(result.currentState).toBe('half-open');
    expect(result.failureHistory.length).toBeGreaterThan(0);
    expect(result.message).toContain('transitioned');
  });

  it('should handle already-closed circuit as no-op', async () => {
    sessionManager.create('/test/project', mockConfig() as never, '/test/project/e2e.yaml');

    const result = await handleResetCircuit(
      { projectPath: '/test/project' },
      sessionManager,
    );

    expect(result.previousState).toBe('closed');
    expect(result.currentState).toBe('closed');
    expect(result.message).toContain('no action taken');
  });

  it('should throw when session does not exist', async () => {
    await expect(
      handleResetCircuit({ projectPath: '/nonexistent' }, sessionManager),
    ).rejects.toThrow('No active session');
  });

  it('should throw when circuit breaker is not configured', async () => {
    sessionManager.create('/test/project', mockConfig(false) as never, '/test/project/e2e.yaml');

    await expect(
      handleResetCircuit({ projectPath: '/test/project' }, sessionManager),
    ).rejects.toThrow('No circuit breaker');
  });
});
