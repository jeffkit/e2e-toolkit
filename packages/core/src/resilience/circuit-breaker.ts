/**
 * @module resilience/circuit-breaker
 * Circuit breaker for Docker operations.
 *
 * Prevents infinite retry loops against a broken Docker daemon.
 * After consecutive failures exceed the threshold, the circuit opens
 * and all subsequent operations fail fast (< 100ms) with CIRCUIT_OPEN.
 *
 * State machine:
 *   closed  → open       (on failureThreshold consecutive failures)
 *   open    → half-open  (on manual reset via MCP tool)
 *   half-open → closed   (on probe success)
 *   half-open → open     (on probe failure)
 */

import type {
  CircuitState,
  CircuitBreakerState,
  SSEBus,
} from '../types.js';
import { ArgusError } from './error-codes.js';

// =====================================================================
// CircuitBreaker
// =====================================================================

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private lastFailureTime: number | null = null;
  private lastStateTransition: number;
  private failureHistory: Array<{ error: string; timestamp: number }> = [];
  private executing = false;

  constructor(
    private failureThreshold: number,
    private resetTimeoutMs: number,
    private eventBus?: SSEBus,
  ) {
    this.lastStateTransition = Date.now();
  }

  /**
   * Get the full observable state of the circuit breaker.
   */
  getState(): CircuitBreakerState {
    return {
      state: this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
      lastStateTransition: this.lastStateTransition,
      failureHistory: [...this.failureHistory],
    };
  }

  /**
   * Execute an operation through the circuit breaker.
   *
   * - **closed**: Runs the operation; increments failure count on error.
   *   Transitions to `open` when failureCount >= failureThreshold.
   * - **open**: Immediately throws `ArgusError(CIRCUIT_OPEN)` (< 100ms).
   * - **half-open**: Runs a single probe; transitions to `closed` on
   *   success, back to `open` on failure.
   */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      throw new ArgusError(
        'CIRCUIT_OPEN',
        `Circuit breaker is open after ${this.failureCount} consecutive failures`,
        {
          state: this.getState(),
        },
      );
    }

    if (this.state === 'half-open') {
      return this.executeProbe(operation);
    }

    return this.executeClosed(operation);
  }

  /**
   * Manually reset the circuit breaker.
   *
   * - From `open`: transitions to `half-open`
   * - From `closed`: no-op
   * - From `half-open`: no-op
   *
   * @returns Previous and current state
   */
  reset(): { previous: CircuitState; current: CircuitState } {
    const previous = this.state;

    if (this.state === 'open') {
      this.transitionTo('half-open');
    }

    return { previous, current: this.state };
  }

  private async executeClosed<T>(operation: () => Promise<T>): Promise<T> {
    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure(err);
      throw err;
    }
  }

  private async executeProbe<T>(operation: () => Promise<T>): Promise<T> {
    try {
      const result = await operation();
      this.transitionTo('closed');
      this.failureCount = 0;
      this.failureHistory = [];

      this.eventBus?.emit('resilience', {
        event: 'circuit_closed',
        data: {
          type: 'circuit_closed',
          probeSucceeded: true,
          timestamp: Date.now(),
        },
      });

      return result;
    } catch (err) {
      this.recordFailure(err);
      this.transitionTo('open');

      this.eventBus?.emit('resilience', {
        event: 'circuit_open',
        data: {
          type: 'circuit_open',
          failureCount: this.failureCount,
          lastError: err instanceof Error ? err.message : String(err),
          timestamp: Date.now(),
        },
      });

      throw err;
    }
  }

  private onSuccess(): void {
    this.failureCount = 0;
  }

  private onFailure(err: unknown): void {
    this.recordFailure(err);

    if (this.failureCount >= this.failureThreshold) {
      this.transitionTo('open');

      this.eventBus?.emit('resilience', {
        event: 'circuit_open',
        data: {
          type: 'circuit_open',
          failureCount: this.failureCount,
          lastError: err instanceof Error ? err.message : String(err),
          timestamp: Date.now(),
        },
      });
    }
  }

  private recordFailure(err: unknown): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    this.failureHistory.push({
      error: err instanceof Error ? err.message : String(err),
      timestamp: Date.now(),
    });

    const maxHistory = 20;
    if (this.failureHistory.length > maxHistory) {
      this.failureHistory = this.failureHistory.slice(-maxHistory);
    }
  }

  private transitionTo(newState: CircuitState): void {
    this.state = newState;
    this.lastStateTransition = Date.now();

    if (newState === 'half-open') {
      this.eventBus?.emit('resilience', {
        event: 'circuit_half_open',
        data: {
          type: 'circuit_half_open',
          timestamp: Date.now(),
        },
      });
    }
  }
}
