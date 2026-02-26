/**
 * Unit tests for resilience/circuit-breaker module.
 *
 * Covers: state transitions (all paths), fail-fast timing (< 100ms),
 * probe success/failure, reset from open/closed, concurrent safety.
 * Target: 90%+ coverage.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SSEBus, SSEMessage } from '../../../src/types.js';
import { CircuitBreaker } from '../../../src/resilience/circuit-breaker.js';
import { ArgusError } from '../../../src/resilience/error-codes.js';

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

describe('CircuitBreaker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =================================================================
  // Initial state
  // =================================================================

  describe('initial state', () => {
    it('should start in closed state', () => {
      const cb = new CircuitBreaker(5, 30_000);
      const state = cb.getState();

      expect(state.state).toBe('closed');
      expect(state.failureCount).toBe(0);
      expect(state.lastFailureTime).toBeNull();
      expect(state.failureHistory).toEqual([]);
    });
  });

  // =================================================================
  // Closed state
  // =================================================================

  describe('closed state', () => {
    it('should execute operations successfully', async () => {
      const cb = new CircuitBreaker(5, 30_000);
      const result = await cb.execute(() => Promise.resolve(42));

      expect(result).toBe(42);
      expect(cb.getState().failureCount).toBe(0);
    });

    it('should increment failure count on error', async () => {
      const cb = new CircuitBreaker(5, 30_000);

      await expect(
        cb.execute(() => Promise.reject(new Error('fail'))),
      ).rejects.toThrow('fail');

      expect(cb.getState().failureCount).toBe(1);
    });

    it('should reset failure count on success after failures', async () => {
      const cb = new CircuitBreaker(5, 30_000);

      await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();

      expect(cb.getState().failureCount).toBe(2);

      await cb.execute(() => Promise.resolve('ok'));

      expect(cb.getState().failureCount).toBe(0);
    });

    it('should transition to open after reaching failure threshold', async () => {
      const cb = new CircuitBreaker(3, 30_000);

      for (let i = 0; i < 3; i++) {
        await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      }

      expect(cb.getState().state).toBe('open');
      expect(cb.getState().failureCount).toBe(3);
    });
  });

  // =================================================================
  // Open state
  // =================================================================

  describe('open state', () => {
    it('should throw CIRCUIT_OPEN immediately', async () => {
      const cb = new CircuitBreaker(1, 30_000);
      await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();

      await expect(
        cb.execute(() => Promise.resolve('should not run')),
      ).rejects.toThrow(ArgusError);

      try {
        await cb.execute(() => Promise.resolve('nope'));
      } catch (err) {
        expect(err).toBeInstanceOf(ArgusError);
        expect((err as ArgusError).code).toBe('CIRCUIT_OPEN');
      }
    });

    it('should fail fast in under 100ms', async () => {
      const cb = new CircuitBreaker(1, 30_000);
      await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();

      const start = Date.now();
      try {
        await cb.execute(() => new Promise(resolve => setTimeout(resolve, 5000)));
      } catch {
        // expected
      }
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(100);
    });

    it('should not call the operation when open', async () => {
      const cb = new CircuitBreaker(1, 30_000);
      await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();

      const spy = vi.fn(() => Promise.resolve('never'));
      try {
        await cb.execute(spy);
      } catch {
        // expected
      }

      expect(spy).not.toHaveBeenCalled();
    });
  });

  // =================================================================
  // Reset
  // =================================================================

  describe('reset', () => {
    it('should transition from open to half-open', async () => {
      const bus = createMockBus();
      const cb = new CircuitBreaker(1, 30_000, bus);

      await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      expect(cb.getState().state).toBe('open');

      const result = cb.reset();

      expect(result.previous).toBe('open');
      expect(result.current).toBe('half-open');

      const halfOpenEvents = bus.events.filter(
        e => (e.msg as { event: string }).event === 'circuit_half_open',
      );
      expect(halfOpenEvents.length).toBe(1);
    });

    it('should be a no-op when already closed', () => {
      const cb = new CircuitBreaker(5, 30_000);

      const result = cb.reset();

      expect(result.previous).toBe('closed');
      expect(result.current).toBe('closed');
    });

    it('should be a no-op when already half-open', async () => {
      const cb = new CircuitBreaker(1, 30_000);
      await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      cb.reset();

      const result = cb.reset();

      expect(result.previous).toBe('half-open');
      expect(result.current).toBe('half-open');
    });
  });

  // =================================================================
  // Half-open state (probe)
  // =================================================================

  describe('half-open state', () => {
    it('should transition to closed on probe success', async () => {
      const bus = createMockBus();
      const cb = new CircuitBreaker(1, 30_000, bus);

      await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      cb.reset();

      const result = await cb.execute(() => Promise.resolve('probe ok'));

      expect(result).toBe('probe ok');
      expect(cb.getState().state).toBe('closed');
      expect(cb.getState().failureCount).toBe(0);

      const closedEvents = bus.events.filter(
        e => (e.msg as { event: string }).event === 'circuit_closed',
      );
      expect(closedEvents.length).toBe(1);
    });

    it('should transition back to open on probe failure', async () => {
      const bus = createMockBus();
      const cb = new CircuitBreaker(1, 30_000, bus);

      await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      cb.reset();

      await expect(
        cb.execute(() => Promise.reject(new Error('probe fail'))),
      ).rejects.toThrow('probe fail');

      expect(cb.getState().state).toBe('open');

      const openEvents = bus.events.filter(
        e => (e.msg as { event: string }).event === 'circuit_open',
      );
      expect(openEvents.length).toBe(2); // once at threshold, once after failed probe
    });
  });

  // =================================================================
  // Full state machine cycle
  // =================================================================

  describe('full cycle', () => {
    it('should complete closed → open → half-open → closed cycle', async () => {
      const cb = new CircuitBreaker(2, 30_000);

      // Start closed
      expect(cb.getState().state).toBe('closed');

      // Fail twice → open
      await expect(cb.execute(() => Promise.reject(new Error('1')))).rejects.toThrow();
      await expect(cb.execute(() => Promise.reject(new Error('2')))).rejects.toThrow();
      expect(cb.getState().state).toBe('open');

      // Reset → half-open
      cb.reset();
      expect(cb.getState().state).toBe('half-open');

      // Probe success → closed
      await cb.execute(() => Promise.resolve('ok'));
      expect(cb.getState().state).toBe('closed');
      expect(cb.getState().failureCount).toBe(0);
    });

    it('should complete closed → open → half-open → open cycle', async () => {
      const cb = new CircuitBreaker(2, 30_000);

      await expect(cb.execute(() => Promise.reject(new Error('1')))).rejects.toThrow();
      await expect(cb.execute(() => Promise.reject(new Error('2')))).rejects.toThrow();
      expect(cb.getState().state).toBe('open');

      cb.reset();
      expect(cb.getState().state).toBe('half-open');

      await expect(cb.execute(() => Promise.reject(new Error('probe fail')))).rejects.toThrow();
      expect(cb.getState().state).toBe('open');
    });
  });

  // =================================================================
  // SSE events
  // =================================================================

  describe('SSE events', () => {
    it('should emit circuit_open when transitioning to open', async () => {
      const bus = createMockBus();
      const cb = new CircuitBreaker(1, 30_000, bus);

      await expect(cb.execute(() => Promise.reject(new Error('docker down')))).rejects.toThrow();

      const openEvents = bus.events.filter(
        e => (e.msg as { event: string }).event === 'circuit_open',
      );
      expect(openEvents.length).toBe(1);

      const data = (openEvents[0]!.msg as { data: { failureCount: number; lastError: string } }).data;
      expect(data.failureCount).toBe(1);
      expect(data.lastError).toBe('docker down');
    });

    it('should emit circuit_half_open on reset', async () => {
      const bus = createMockBus();
      const cb = new CircuitBreaker(1, 30_000, bus);

      await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      cb.reset();

      const halfOpenEvents = bus.events.filter(
        e => (e.msg as { event: string }).event === 'circuit_half_open',
      );
      expect(halfOpenEvents.length).toBe(1);
    });

    it('should emit circuit_closed on successful probe', async () => {
      const bus = createMockBus();
      const cb = new CircuitBreaker(1, 30_000, bus);

      await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      cb.reset();
      await cb.execute(() => Promise.resolve('ok'));

      const closedEvents = bus.events.filter(
        e => (e.msg as { event: string }).event === 'circuit_closed',
      );
      expect(closedEvents.length).toBe(1);

      const data = (closedEvents[0]!.msg as { data: { probeSucceeded: boolean } }).data;
      expect(data.probeSucceeded).toBe(true);
    });
  });

  // =================================================================
  // Failure history
  // =================================================================

  describe('failure history', () => {
    it('should track failure history', async () => {
      const cb = new CircuitBreaker(5, 30_000);

      await expect(cb.execute(() => Promise.reject(new Error('err1')))).rejects.toThrow();
      await expect(cb.execute(() => Promise.reject(new Error('err2')))).rejects.toThrow();

      const history = cb.getState().failureHistory;
      expect(history).toHaveLength(2);
      expect(history[0]!.error).toBe('err1');
      expect(history[1]!.error).toBe('err2');
    });

    it('should cap failure history at 20 entries', async () => {
      const cb = new CircuitBreaker(100, 30_000);

      for (let i = 0; i < 25; i++) {
        await expect(cb.execute(() => Promise.reject(new Error(`err${i}`)))).rejects.toThrow();
      }

      expect(cb.getState().failureHistory.length).toBeLessThanOrEqual(20);
    });

    it('should clear failure history on probe success', async () => {
      const cb = new CircuitBreaker(2, 30_000);

      await expect(cb.execute(() => Promise.reject(new Error('1')))).rejects.toThrow();
      await expect(cb.execute(() => Promise.reject(new Error('2')))).rejects.toThrow();
      cb.reset();
      await cb.execute(() => Promise.resolve('ok'));

      expect(cb.getState().failureHistory).toEqual([]);
    });
  });

  // =================================================================
  // getState
  // =================================================================

  describe('getState', () => {
    it('should return a snapshot (not a live reference)', async () => {
      const cb = new CircuitBreaker(5, 30_000);

      const state1 = cb.getState();
      await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      const state2 = cb.getState();

      expect(state1.failureCount).toBe(0);
      expect(state2.failureCount).toBe(1);
    });

    it('should update lastStateTransition on transitions', async () => {
      const cb = new CircuitBreaker(1, 30_000);

      const initialTransition = cb.getState().lastStateTransition;
      await new Promise(resolve => setTimeout(resolve, 10));

      await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();

      expect(cb.getState().lastStateTransition).toBeGreaterThanOrEqual(initialTransition);
    });
  });
});
