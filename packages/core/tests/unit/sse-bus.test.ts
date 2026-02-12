/**
 * Unit tests for sse-bus module.
 *
 * Tests cover:
 * - Basic emit / subscribe
 * - Multiple subscribers
 * - Unsubscribe
 * - Channel isolation
 * - subscriberCount
 * - clear
 */

import { describe, it, expect, vi } from 'vitest';
import { EventBus, createEventBus } from '../../src/sse-bus.js';
import type { SSEMessage } from '../../src/types.js';

describe('sse-bus', () => {
  describe('EventBus', () => {
    it('should deliver a message to a subscriber', () => {
      const bus = new EventBus();
      const handler = vi.fn();
      bus.subscribe('ch1', handler);

      const msg: SSEMessage = { event: 'test', data: { foo: 1 } };
      bus.emit('ch1', msg);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(msg);
    });

    it('should deliver a message to multiple subscribers', () => {
      const bus = new EventBus();
      const h1 = vi.fn();
      const h2 = vi.fn();
      bus.subscribe('ch1', h1);
      bus.subscribe('ch1', h2);

      const msg: SSEMessage = { event: 'ping', data: null };
      bus.emit('ch1', msg);

      expect(h1).toHaveBeenCalledTimes(1);
      expect(h2).toHaveBeenCalledTimes(1);
    });

    it('should not deliver messages to unsubscribed handlers', () => {
      const bus = new EventBus();
      const handler = vi.fn();
      const unsub = bus.subscribe('ch1', handler);

      unsub();
      bus.emit('ch1', { event: 'test', data: {} });

      expect(handler).not.toHaveBeenCalled();
    });

    it('should isolate channels', () => {
      const bus = new EventBus();
      const h1 = vi.fn();
      const h2 = vi.fn();
      bus.subscribe('ch-a', h1);
      bus.subscribe('ch-b', h2);

      bus.emit('ch-a', { event: 'x', data: 1 });

      expect(h1).toHaveBeenCalledTimes(1);
      expect(h2).not.toHaveBeenCalled();
    });

    it('should not throw when emitting to an empty channel', () => {
      const bus = new EventBus();
      expect(() => bus.emit('nobody', { event: 'x', data: null })).not.toThrow();
    });

    it('subscriberCount should return current subscriber count', () => {
      const bus = new EventBus();
      expect(bus.subscriberCount('ch1')).toBe(0);

      const unsub1 = bus.subscribe('ch1', vi.fn());
      expect(bus.subscriberCount('ch1')).toBe(1);

      bus.subscribe('ch1', vi.fn());
      expect(bus.subscriberCount('ch1')).toBe(2);

      unsub1();
      expect(bus.subscriberCount('ch1')).toBe(1);
    });

    it('subscriberCount should return 0 after last subscriber unsubscribes', () => {
      const bus = new EventBus();
      const unsub = bus.subscribe('ch1', vi.fn());
      unsub();
      expect(bus.subscriberCount('ch1')).toBe(0);
    });

    it('clear should remove all subscriptions', () => {
      const bus = new EventBus();
      const h1 = vi.fn();
      const h2 = vi.fn();
      bus.subscribe('ch-a', h1);
      bus.subscribe('ch-b', h2);

      bus.clear();

      bus.emit('ch-a', { event: 'x', data: null });
      bus.emit('ch-b', { event: 'y', data: null });

      expect(h1).not.toHaveBeenCalled();
      expect(h2).not.toHaveBeenCalled();
      expect(bus.subscriberCount('ch-a')).toBe(0);
      expect(bus.subscriberCount('ch-b')).toBe(0);
    });
  });

  describe('createEventBus', () => {
    it('should return an EventBus instance', () => {
      const bus = createEventBus();
      expect(bus).toBeInstanceOf(EventBus);
    });

    it('should return a new instance each call', () => {
      const a = createEventBus();
      const b = createEventBus();
      expect(a).not.toBe(b);
    });
  });
});
