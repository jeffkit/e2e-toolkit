/**
 * @module retry-engine
 * RetryExecutor — wraps test case execution with configurable retry,
 * backoff, and attempt recording.
 *
 * Supports linear and exponential backoff strategies, and attaches
 * diagnostic information on final failure via DiagnosticCollector.
 */

import type { RetryPolicy, AttemptResult } from './types.js';

/**
 * Parse a human-readable delay string ("2s", "500ms") into milliseconds.
 */
export function parseDelay(delay: string): number {
  const trimmed = delay.trim();

  if (/^\d+$/.test(trimmed)) {
    return parseInt(trimmed, 10);
  }

  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h)$/);
  if (!match) {
    throw new Error(`Invalid delay format: "${delay}". Expected "2s", "500ms", etc.`);
  }

  const value = parseFloat(match[1]!);
  const unit = match[2]!;

  const multipliers: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60_000,
    h: 3_600_000,
  };

  return Math.round(value * multipliers[unit]!);
}

/**
 * Compute the delay for a given attempt based on the backoff strategy.
 *
 * @param baseDelayMs - Base delay in milliseconds
 * @param attempt - Current attempt number (1-based; delay applies before attempt 2+)
 * @param backoff - Backoff strategy
 * @param multiplier - Backoff multiplier (used by both linear and exponential)
 * @returns Delay in milliseconds
 */
export function computeBackoffDelay(
  baseDelayMs: number,
  attempt: number,
  backoff?: 'linear' | 'exponential',
  multiplier = 2,
): number {
  if (!backoff || attempt <= 1) {
    return baseDelayMs;
  }

  const retryIndex = attempt - 1;

  switch (backoff) {
    case 'linear':
      return baseDelayMs * retryIndex * multiplier;
    case 'exponential':
      return baseDelayMs * Math.pow(multiplier, retryIndex - 1);
    default:
      return baseDelayMs;
  }
}

/** Result returned by RetryExecutor.execute() */
export interface RetryResult {
  passed: boolean;
  attempts: AttemptResult[];
  finalError?: string;
}

/**
 * RetryExecutor wraps a test case function with retry logic.
 *
 * The test function should throw on failure and return normally on success.
 * Each attempt is recorded with timing information.
 */
export class RetryExecutor {
  /**
   * Execute a test function with retry according to the given policy.
   *
   * @param testFn - Async function that throws on failure
   * @param policy - Retry configuration
   * @returns Result with pass/fail status and attempt history
   */
  async execute(
    testFn: () => Promise<void>,
    policy: RetryPolicy,
  ): Promise<RetryResult> {
    const baseDelayMs = parseDelay(policy.delay);
    const maxAttempts = policy.maxAttempts;
    const attempts: AttemptResult[] = [];

    for (let i = 1; i <= maxAttempts; i++) {
      const attemptStart = Date.now();

      try {
        await testFn();

        attempts.push({
          attempt: i,
          passed: true,
          duration: Date.now() - attemptStart,
          timestamp: attemptStart,
        });

        return { passed: true, attempts };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);

        attempts.push({
          attempt: i,
          passed: false,
          error: errorMsg,
          duration: Date.now() - attemptStart,
          timestamp: attemptStart,
        });

        if (i < maxAttempts) {
          const delay = computeBackoffDelay(
            baseDelayMs,
            i,
            policy.backoff,
            policy.backoffMultiplier ?? 2,
          );
          await sleep(delay);
        }
      }
    }

    const lastAttempt = attempts[attempts.length - 1]!;
    return {
      passed: false,
      attempts,
      finalError: lastAttempt.error,
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Resolve the effective retry policy from case, suite, and global levels.
 * Priority: case-level > suite-level > global.
 *
 * @returns The resolved policy, or undefined if no retry is configured
 */
export function resolveRetryPolicy(
  caseRetry?: RetryPolicy,
  suiteRetry?: RetryPolicy,
  globalRetry?: RetryPolicy,
): RetryPolicy | undefined {
  return caseRetry ?? suiteRetry ?? globalRetry;
}
