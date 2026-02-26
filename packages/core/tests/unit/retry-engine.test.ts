/**
 * Unit tests for retry-engine module.
 *
 * Tests cover:
 * - Success on first attempt (no retry)
 * - Success on Nth attempt
 * - All attempts exhausted
 * - Linear backoff timing
 * - Exponential backoff timing
 * - Attempt history recording
 * - Delay string parsing
 * - Retry policy resolution (case > suite > global)
 */

import { describe, it, expect, vi } from 'vitest';
import {
  RetryExecutor,
  parseDelay,
  computeBackoffDelay,
  resolveRetryPolicy,
} from '../../src/retry-engine.js';
import type { RetryPolicy } from '../../src/types.js';

describe('retry-engine', () => {
  describe('parseDelay', () => {
    it('should parse seconds', () => {
      expect(parseDelay('2s')).toBe(2000);
    });

    it('should parse milliseconds', () => {
      expect(parseDelay('500ms')).toBe(500);
    });

    it('should parse minutes', () => {
      expect(parseDelay('1m')).toBe(60000);
    });

    it('should parse plain number as milliseconds', () => {
      expect(parseDelay('200')).toBe(200);
    });

    it('should handle decimal values', () => {
      expect(parseDelay('1.5s')).toBe(1500);
    });

    it('should throw on invalid format', () => {
      expect(() => parseDelay('abc')).toThrow('Invalid delay format');
      expect(() => parseDelay('5x')).toThrow('Invalid delay format');
    });
  });

  describe('computeBackoffDelay', () => {
    it('should return base delay without backoff strategy', () => {
      expect(computeBackoffDelay(1000, 1)).toBe(1000);
      expect(computeBackoffDelay(1000, 3)).toBe(1000);
    });

    it('should return base delay for first attempt regardless of strategy', () => {
      expect(computeBackoffDelay(1000, 1, 'linear')).toBe(1000);
      expect(computeBackoffDelay(1000, 1, 'exponential')).toBe(1000);
    });

    it('should compute linear backoff', () => {
      // attempt 2: base * 1 * multiplier = 1000 * 1 * 2 = 2000
      expect(computeBackoffDelay(1000, 2, 'linear', 2)).toBe(2000);
      // attempt 3: base * 2 * multiplier = 1000 * 2 * 2 = 4000
      expect(computeBackoffDelay(1000, 3, 'linear', 2)).toBe(4000);
    });

    it('should compute exponential backoff', () => {
      // attempt 2: base * mult^0 = 1000 * 1 = 1000
      expect(computeBackoffDelay(1000, 2, 'exponential', 2)).toBe(1000);
      // attempt 3: base * mult^1 = 1000 * 2 = 2000
      expect(computeBackoffDelay(1000, 3, 'exponential', 2)).toBe(2000);
      // attempt 4: base * mult^2 = 1000 * 4 = 4000
      expect(computeBackoffDelay(1000, 4, 'exponential', 2)).toBe(4000);
    });
  });

  describe('resolveRetryPolicy', () => {
    const casePolicy: RetryPolicy = { maxAttempts: 5, delay: '1s' };
    const suitePolicy: RetryPolicy = { maxAttempts: 3, delay: '2s' };
    const globalPolicy: RetryPolicy = { maxAttempts: 2, delay: '3s' };

    it('should return case policy when all three are defined', () => {
      expect(resolveRetryPolicy(casePolicy, suitePolicy, globalPolicy)).toBe(casePolicy);
    });

    it('should fall back to suite policy when case is undefined', () => {
      expect(resolveRetryPolicy(undefined, suitePolicy, globalPolicy)).toBe(suitePolicy);
    });

    it('should fall back to global policy when case and suite are undefined', () => {
      expect(resolveRetryPolicy(undefined, undefined, globalPolicy)).toBe(globalPolicy);
    });

    it('should return undefined when nothing is defined', () => {
      expect(resolveRetryPolicy(undefined, undefined, undefined)).toBeUndefined();
    });

    it('should prefer case over suite even when global is set', () => {
      expect(resolveRetryPolicy(casePolicy, undefined, globalPolicy)).toBe(casePolicy);
    });
  });

  describe('RetryExecutor', () => {
    it('should succeed on first attempt without retrying', async () => {
      const executor = new RetryExecutor();
      const fn = vi.fn().mockResolvedValue(undefined);

      const result = await executor.execute(fn, {
        maxAttempts: 3,
        delay: '10ms',
      });

      expect(result.passed).toBe(true);
      expect(result.attempts).toHaveLength(1);
      expect(result.attempts[0]!.passed).toBe(true);
      expect(result.attempts[0]!.attempt).toBe(1);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should succeed on Nth attempt after failures', async () => {
      const executor = new RetryExecutor();
      let callCount = 0;
      const fn = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount < 3) throw new Error(`Attempt ${callCount} failed`);
      });

      const result = await executor.execute(fn, {
        maxAttempts: 5,
        delay: '10ms',
      });

      expect(result.passed).toBe(true);
      expect(result.attempts).toHaveLength(3);
      expect(result.attempts[0]!.passed).toBe(false);
      expect(result.attempts[1]!.passed).toBe(false);
      expect(result.attempts[2]!.passed).toBe(true);
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should fail when all attempts are exhausted', async () => {
      const executor = new RetryExecutor();
      const fn = vi.fn().mockRejectedValue(new Error('Always fails'));

      const result = await executor.execute(fn, {
        maxAttempts: 3,
        delay: '10ms',
      });

      expect(result.passed).toBe(false);
      expect(result.attempts).toHaveLength(3);
      expect(result.finalError).toBe('Always fails');
      expect(result.attempts.every(a => !a.passed)).toBe(true);
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should record attempt timing', async () => {
      const executor = new RetryExecutor();
      const fn = vi.fn().mockResolvedValue(undefined);

      const result = await executor.execute(fn, {
        maxAttempts: 1,
        delay: '10ms',
      });

      const attempt = result.attempts[0]!;
      expect(attempt.duration).toBeGreaterThanOrEqual(0);
      expect(attempt.timestamp).toBeGreaterThan(0);
    });

    it('should record error messages in failed attempts', async () => {
      const executor = new RetryExecutor();
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('Error A'))
        .mockRejectedValueOnce(new Error('Error B'))
        .mockResolvedValue(undefined);

      const result = await executor.execute(fn, {
        maxAttempts: 3,
        delay: '10ms',
      });

      expect(result.passed).toBe(true);
      expect(result.attempts[0]!.error).toBe('Error A');
      expect(result.attempts[1]!.error).toBe('Error B');
      expect(result.attempts[2]!.error).toBeUndefined();
    });

    it('should handle maxAttempts of 1 (no retry)', async () => {
      const executor = new RetryExecutor();
      const fn = vi.fn().mockRejectedValue(new Error('Single attempt'));

      const result = await executor.execute(fn, {
        maxAttempts: 1,
        delay: '10ms',
      });

      expect(result.passed).toBe(false);
      expect(result.attempts).toHaveLength(1);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should apply delay between retries', async () => {
      const executor = new RetryExecutor();
      const start = Date.now();
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue(undefined);

      await executor.execute(fn, {
        maxAttempts: 2,
        delay: '50ms',
      });

      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(40);
    });

    it('should not delay after the last failed attempt', async () => {
      const executor = new RetryExecutor();
      const start = Date.now();
      const fn = vi.fn().mockRejectedValue(new Error('fail'));

      await executor.execute(fn, {
        maxAttempts: 2,
        delay: '50ms',
      });

      const elapsed = Date.now() - start;
      // Only one delay between attempt 1 and 2; no delay after attempt 2
      expect(elapsed).toBeLessThan(200);
    });
  });
});
