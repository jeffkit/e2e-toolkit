/**
 * Unit tests for resilience configuration defaults.
 *
 * Validates that when no `resilience` section is present in e2e.yaml,
 * the defaults produce: preflight enabled, auto port resolution,
 * restart on failure with 3 max restarts.
 */

import { describe, it, expect } from 'vitest';
import { ResilienceConfigSchema } from '../../../src/config-loader.js';

describe('ResilienceConfigSchema defaults', () => {
  it('should produce correct defaults when no config is provided', () => {
    const result = ResilienceConfigSchema.parse({});

    expect(result.preflight.enabled).toBe(true);
    expect(result.preflight.diskSpaceThreshold).toBe('2GB');
    expect(result.preflight.cleanOrphans).toBe(true);

    expect(result.container.restartOnFailure).toBe(true);
    expect(result.container.maxRestarts).toBe(3);
    expect(result.container.restartDelay).toBe('2s');
    expect(result.container.restartBackoff).toBe('exponential');

    expect(result.network.portConflictStrategy).toBe('auto');
    expect(result.network.verifyConnectivity).toBe(true);

    expect(result.circuitBreaker.enabled).toBe(true);
    expect(result.circuitBreaker.failureThreshold).toBe(5);
    expect(result.circuitBreaker.resetTimeoutMs).toBe(30000);
  });

  it('should allow partial overrides while keeping other defaults', () => {
    const result = ResilienceConfigSchema.parse({
      container: { maxRestarts: 5 },
    });

    expect(result.container.maxRestarts).toBe(5);
    expect(result.container.restartOnFailure).toBe(true);
    expect(result.container.restartDelay).toBe('2s');

    expect(result.preflight.enabled).toBe(true);
    expect(result.network.portConflictStrategy).toBe('auto');
  });

  it('should parse undefined as full defaults', () => {
    const result = ResilienceConfigSchema.parse(undefined);

    expect(result.preflight.enabled).toBe(true);
    expect(result.container.restartOnFailure).toBe(true);
    expect(result.container.maxRestarts).toBe(3);
    expect(result.network.portConflictStrategy).toBe('auto');
    expect(result.circuitBreaker.enabled).toBe(true);
  });

  it('should reject maxRestarts outside valid range', () => {
    expect(() =>
      ResilienceConfigSchema.parse({
        container: { maxRestarts: 15 },
      }),
    ).toThrow();
  });

  it('should reject invalid portConflictStrategy', () => {
    expect(() =>
      ResilienceConfigSchema.parse({
        network: { portConflictStrategy: 'retry' },
      }),
    ).toThrow();
  });
});
