/**
 * Unit tests for resilience/error-codes module.
 *
 * Covers: error metadata registry, createStructuredError factory,
 * ArgusError class construction and serialization.
 */

import { describe, it, expect } from 'vitest';
import {
  ERROR_METADATA,
  createStructuredError,
  ArgusError,
  type ArgusErrorCode,
  type StructuredError,
} from '../../../src/resilience/error-codes.js';

// =====================================================================
// All 13 error codes
// =====================================================================

const ALL_CODES: ArgusErrorCode[] = [
  'DOCKER_UNAVAILABLE',
  'DISK_SPACE_LOW',
  'PORT_CONFLICT',
  'PORT_EXHAUSTION',
  'CONTAINER_OOM',
  'CONTAINER_CRASH',
  'CONTAINER_RESTART_EXHAUSTED',
  'HEALTH_CHECK_TIMEOUT',
  'NETWORK_UNREACHABLE',
  'DNS_RESOLUTION_FAILED',
  'CIRCUIT_OPEN',
  'ORPHAN_DETECTED',
  'CLEANUP_FAILED',
];

describe('error-codes', () => {
  describe('ERROR_METADATA registry', () => {
    it('should contain metadata for all 13 error codes', () => {
      expect(ERROR_METADATA.size).toBe(13);
      for (const code of ALL_CODES) {
        expect(ERROR_METADATA.has(code)).toBe(true);
      }
    });

    it('should have valid category for every code', () => {
      const validCategories = ['infrastructure', 'container', 'network', 'system'];
      for (const [code, meta] of ERROR_METADATA) {
        expect(validCategories).toContain(meta.category);
      }
    });

    it('should have valid defaultSeverity for every code', () => {
      const validSeverities = ['fatal', 'recoverable', 'warning'];
      for (const [code, meta] of ERROR_METADATA) {
        expect(validSeverities).toContain(meta.defaultSeverity);
      }
    });

    it('should have non-empty suggestedActions for every code', () => {
      for (const [code, meta] of ERROR_METADATA) {
        expect(meta.suggestedActions.length).toBeGreaterThan(0);
      }
    });

    it('should classify DOCKER_UNAVAILABLE as infrastructure/fatal', () => {
      const meta = ERROR_METADATA.get('DOCKER_UNAVAILABLE')!;
      expect(meta.category).toBe('infrastructure');
      expect(meta.defaultSeverity).toBe('fatal');
    });

    it('should classify PORT_CONFLICT as network/recoverable', () => {
      const meta = ERROR_METADATA.get('PORT_CONFLICT')!;
      expect(meta.category).toBe('network');
      expect(meta.defaultSeverity).toBe('recoverable');
    });

    it('should classify CIRCUIT_OPEN as system/fatal', () => {
      const meta = ERROR_METADATA.get('CIRCUIT_OPEN')!;
      expect(meta.category).toBe('system');
      expect(meta.defaultSeverity).toBe('fatal');
    });
  });

  describe('createStructuredError', () => {
    it('should create a complete StructuredError with registry defaults', () => {
      const error = createStructuredError('DOCKER_UNAVAILABLE', 'Docker is not running');

      expect(error.code).toBe('DOCKER_UNAVAILABLE');
      expect(error.category).toBe('infrastructure');
      expect(error.severity).toBe('fatal');
      expect(error.message).toBe('Docker is not running');
      expect(error.details).toEqual({});
      expect(error.suggestedActions.length).toBeGreaterThan(0);
      expect(error.timestamp).toBeGreaterThan(0);
    });

    it('should include custom details', () => {
      const error = createStructuredError('PORT_CONFLICT', 'Port 3000 in use', {
        port: 3000,
        pid: 12345,
      });

      expect(error.details).toEqual({ port: 3000, pid: 12345 });
    });

    it('should apply severity override', () => {
      const error = createStructuredError('DISK_SPACE_LOW', 'Disk critically low', {}, 'fatal');

      expect(error.severity).toBe('fatal');
      expect(error.category).toBe('infrastructure');
    });

    it('should preserve suggestedActions from registry as a copy', () => {
      const error1 = createStructuredError('PORT_CONFLICT', 'conflict');
      const error2 = createStructuredError('PORT_CONFLICT', 'conflict');

      error1.suggestedActions.push('custom action');
      expect(error2.suggestedActions).not.toContain('custom action');
    });

    it('should set timestamp close to current time', () => {
      const before = Date.now();
      const error = createStructuredError('CONTAINER_OOM', 'OOM killed');
      const after = Date.now();

      expect(error.timestamp).toBeGreaterThanOrEqual(before);
      expect(error.timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe('ArgusError', () => {
    it('should extend Error with correct name', () => {
      const err = new ArgusError('DOCKER_UNAVAILABLE', 'Docker not found');

      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe('ArgusError');
      expect(err.message).toBe('Docker not found');
    });

    it('should expose code, category, and severity accessors', () => {
      const err = new ArgusError('CONTAINER_OOM', 'Container OOM killed', { containerId: 'abc123' });

      expect(err.code).toBe('CONTAINER_OOM');
      expect(err.category).toBe('container');
      expect(err.severity).toBe('recoverable');
    });

    it('should support severity override in constructor', () => {
      const err = new ArgusError('DISK_SPACE_LOW', 'Critically low disk', {}, 'fatal');

      expect(err.severity).toBe('fatal');
    });

    it('should serialize to StructuredError via toJSON()', () => {
      const err = new ArgusError('PORT_CONFLICT', 'Port 8080 occupied', { port: 8080 });
      const json = err.toJSON();

      expect(json.code).toBe('PORT_CONFLICT');
      expect(json.category).toBe('network');
      expect(json.severity).toBe('recoverable');
      expect(json.message).toBe('Port 8080 occupied');
      expect(json.details).toEqual({ port: 8080 });
      expect(json.suggestedActions).toBeInstanceOf(Array);
      expect(json.timestamp).toBeGreaterThan(0);
    });

    it('should contain structuredError property', () => {
      const err = new ArgusError('CIRCUIT_OPEN', 'Circuit is open');
      const structured = err.structuredError;

      expect(structured.code).toBe('CIRCUIT_OPEN');
      expect(structured).toEqual(err.toJSON());
    });

    it('should be catchable as Error', () => {
      let caught = false;
      try {
        throw new ArgusError('CLEANUP_FAILED', 'Failed to remove container');
      } catch (e) {
        if (e instanceof ArgusError) {
          expect(e.code).toBe('CLEANUP_FAILED');
          caught = true;
        }
      }
      expect(caught).toBe(true);
    });

    it('should produce valid JSON.stringify output', () => {
      const err = new ArgusError('NETWORK_UNREACHABLE', 'Cannot reach mock', {
        service: 'payment-api',
        hostname: 'payment',
      });

      const serialized = JSON.stringify(err.toJSON());
      const parsed = JSON.parse(serialized) as StructuredError;

      expect(parsed.code).toBe('NETWORK_UNREACHABLE');
      expect(parsed.details).toEqual({ service: 'payment-api', hostname: 'payment' });
    });
  });
});
