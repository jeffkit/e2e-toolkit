/**
 * @module sse-bus
 * In-process event bus for Server-Sent Events (SSE) broadcasting.
 *
 * Provides a lightweight pub/sub system keyed by channel names.
 * Designed to feed real-time events to the dashboard via SSE.
 */

import type { SSEBus, SSEMessage } from './types.js';

/**
 * In-process event bus implementing {@link SSEBus}.
 *
 * Usage:
 * ```ts
 * const bus = createEventBus();
 * const unsub = bus.subscribe('tests', (msg) => console.log(msg));
 * bus.emit('tests', { event: 'case_pass', data: { name: 'health' } });
 * unsub(); // unsubscribe
 * ```
 */
export class EventBus implements SSEBus {
  private listeners = new Map<string, Set<(msg: SSEMessage) => void>>();

  /**
   * Emit a message to all subscribers of a channel.
   *
   * @param channel - Channel name
   * @param message - SSE message to broadcast
   */
  emit(channel: string, message: SSEMessage): void {
    const subs = this.listeners.get(channel);
    if (!subs) return;
    for (const handler of subs) {
      handler(message);
    }
  }

  /**
   * Subscribe to a channel.
   *
   * @param channel - Channel name
   * @param handler - Callback invoked for each message on the channel
   * @returns An unsubscribe function
   */
  subscribe(channel: string, handler: (msg: SSEMessage) => void): () => void {
    let subs = this.listeners.get(channel);
    if (!subs) {
      subs = new Set();
      this.listeners.set(channel, subs);
    }
    subs.add(handler);

    return () => {
      subs.delete(handler);
      if (subs.size === 0) {
        this.listeners.delete(channel);
      }
    };
  }

  /**
   * Get the number of subscribers for a channel.
   *
   * @param channel - Channel name
   * @returns Number of active subscribers
   */
  subscriberCount(channel: string): number {
    return this.listeners.get(channel)?.size ?? 0;
  }

  /**
   * Remove all subscriptions from all channels.
   */
  clear(): void {
    this.listeners.clear();
  }
}

/**
 * Create a new {@link EventBus} instance.
 *
 * @returns A fresh EventBus
 */
export function createEventBus(): EventBus {
  return new EventBus();
}
