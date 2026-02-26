/**
 * @module task-queue
 * In-process task queue with concurrency control and priority support.
 *
 * Designed for local mode (single-process, in-memory). The interface
 * can be swapped for a Redis/Bull-based implementation in production.
 */

import { EventEmitter } from 'node:events';

// =====================================================================
// Types
// =====================================================================

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface TaskEntry<T = unknown> {
  id: string;
  name: string;
  status: TaskStatus;
  priority: number;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  result?: T;
  error?: string;
}

export interface QueueStats {
  pending: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
  total: number;
}

export interface TaskQueueOptions {
  /** Max concurrent tasks. Default: 1 (serial execution). */
  concurrency?: number;
  /** Max queue length. 0 = unlimited. Default: 0. */
  maxSize?: number;
}

export type TaskFn<T> = () => Promise<T>;

export type TaskQueueEvent =
  | { type: 'task_enqueued'; task: TaskEntry }
  | { type: 'task_started'; task: TaskEntry }
  | { type: 'task_completed'; task: TaskEntry }
  | { type: 'task_failed'; task: TaskEntry; error: string }
  | { type: 'task_cancelled'; task: TaskEntry }
  | { type: 'queue_drained' };

// =====================================================================
// TaskQueue
// =====================================================================

export class TaskQueue extends EventEmitter {
  private readonly maxConcurrency: number;
  private readonly maxSize: number;
  private readonly entries = new Map<string, TaskEntry>();
  private readonly fns = new Map<string, TaskFn<unknown>>();
  private readonly resolvers = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private runningCount = 0;
  private closed = false;

  constructor(options?: TaskQueueOptions) {
    super();
    this.maxConcurrency = Math.max(1, options?.concurrency ?? 1);
    this.maxSize = Math.max(0, options?.maxSize ?? 0);
  }

  /**
   * Enqueue a task. Returns a promise that resolves when the task completes.
   * @throws Error if queue is full or closed.
   */
  enqueue<T>(id: string, name: string, fn: TaskFn<T>, priority = 0): Promise<T> {
    if (this.closed) throw new Error('Queue is closed');
    if (this.entries.has(id)) throw new Error(`Task "${id}" already exists`);

    const pendingCount = this.pendingCount();
    if (this.maxSize > 0 && pendingCount >= this.maxSize) {
      throw new Error(`Queue is full (max ${this.maxSize})`);
    }

    const entry: TaskEntry = {
      id,
      name,
      status: 'pending',
      priority,
      createdAt: Date.now(),
    };
    this.entries.set(id, entry);
    this.fns.set(id, fn as TaskFn<unknown>);

    const promise = new Promise<T>((resolve, reject) => {
      this.resolvers.set(id, { resolve: resolve as (v: unknown) => void, reject });
    });

    this.emitEvent({ type: 'task_enqueued', task: { ...entry } });
    this.processNext();
    return promise;
  }

  /** Cancel a pending task. Running tasks cannot be cancelled. */
  cancel(id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry || entry.status !== 'pending') return false;

    entry.status = 'cancelled';
    entry.completedAt = Date.now();
    this.fns.delete(id);
    const resolver = this.resolvers.get(id);
    if (resolver) {
      resolver.reject(new Error('Task cancelled'));
      this.resolvers.delete(id);
    }
    this.emitEvent({ type: 'task_cancelled', task: { ...entry } });
    return true;
  }

  getTask(id: string): TaskEntry | undefined {
    const entry = this.entries.get(id);
    return entry ? { ...entry } : undefined;
  }

  getStats(): QueueStats {
    let pending = 0, running = 0, completed = 0, failed = 0, cancelled = 0;
    for (const e of this.entries.values()) {
      switch (e.status) {
        case 'pending': pending++; break;
        case 'running': running++; break;
        case 'completed': completed++; break;
        case 'failed': failed++; break;
        case 'cancelled': cancelled++; break;
      }
    }
    return { pending, running, completed, failed, cancelled, total: this.entries.size };
  }

  /** Ordered list: running first, then pending by priority desc, then completed. */
  list(): TaskEntry[] {
    return [...this.entries.values()]
      .sort((a, b) => {
        const order: Record<TaskStatus, number> = { running: 0, pending: 1, completed: 2, failed: 3, cancelled: 4 };
        const diff = order[a.status] - order[b.status];
        if (diff !== 0) return diff;
        if (a.status === 'pending') return b.priority - a.priority;
        return (b.createdAt) - (a.createdAt);
      })
      .map(e => ({ ...e }));
  }

  /** Stop accepting new tasks and wait for running tasks to finish. */
  async drain(): Promise<void> {
    this.closed = true;
    // Cancel all pending tasks
    for (const [id, entry] of this.entries) {
      if (entry.status === 'pending') this.cancel(id);
    }
    // Wait for running tasks
    if (this.runningCount > 0) {
      return new Promise(resolve => {
        const check = () => {
          if (this.runningCount === 0) resolve();
          else setTimeout(check, 50);
        };
        check();
      });
    }
  }

  get size(): number {
    return this.entries.size;
  }

  // ----- Internal -----

  private pendingCount(): number {
    let count = 0;
    for (const e of this.entries.values()) {
      if (e.status === 'pending') count++;
    }
    return count;
  }

  private processNext(): void {
    if (this.runningCount >= this.maxConcurrency) return;

    // Find highest-priority pending task
    let best: TaskEntry | null = null;
    for (const entry of this.entries.values()) {
      if (entry.status !== 'pending') continue;
      if (!best || entry.priority > best.priority) best = entry;
    }
    if (!best) {
      if (this.runningCount === 0) this.emitEvent({ type: 'queue_drained' });
      return;
    }

    const entry = best;
    entry.status = 'running';
    entry.startedAt = Date.now();
    this.runningCount++;

    this.emitEvent({ type: 'task_started', task: { ...entry } });

    const fn = this.fns.get(entry.id)!;
    this.fns.delete(entry.id);

    fn()
      .then(result => {
        entry.status = 'completed';
        entry.completedAt = Date.now();
        entry.result = result;
        this.runningCount--;
        this.emitEvent({ type: 'task_completed', task: { ...entry } });
        this.resolvers.get(entry.id)?.resolve(result);
        this.resolvers.delete(entry.id);
        this.processNext();
      })
      .catch((err: Error) => {
        entry.status = 'failed';
        entry.completedAt = Date.now();
        entry.error = err.message;
        this.runningCount--;
        this.emitEvent({ type: 'task_failed', task: { ...entry }, error: err.message });
        this.resolvers.get(entry.id)?.reject(err);
        this.resolvers.delete(entry.id);
        this.processNext();
      });
  }

  private emitEvent(event: TaskQueueEvent): void {
    this.emit('task', event);
    this.emit(event.type, event);
  }
}
