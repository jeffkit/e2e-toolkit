import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskQueue, type TaskQueueEvent, type TaskEntry } from '../../src/task-queue.js';

// =====================================================================
// Helpers
// =====================================================================

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function collectEvents(queue: TaskQueue): TaskQueueEvent[] {
  const events: TaskQueueEvent[] = [];
  queue.on('task', (e: TaskQueueEvent) => events.push(e));
  return events;
}

// =====================================================================
// Basic enqueue / execution
// =====================================================================

describe('TaskQueue — basic operations', () => {
  let queue: TaskQueue;

  beforeEach(() => {
    queue = new TaskQueue({ concurrency: 1 });
  });

  it('executes a single task and returns its result', async () => {
    const result = await queue.enqueue('t1', 'test', async () => 42);
    expect(result).toBe(42);
  });

  it('rejects duplicate task ids', async () => {
    queue.enqueue('dup', 'test', () => delay(50));
    expect(() => queue.enqueue('dup', 'test', async () => 1)).toThrow('already exists');
  });

  it('propagates task errors', async () => {
    await expect(
      queue.enqueue('err', 'failing', async () => { throw new Error('boom'); })
    ).rejects.toThrow('boom');
  });

  it('tracks task lifecycle via getTask', async () => {
    const promise = queue.enqueue('lc', 'lifecycle', () => delay(50));

    // Should be running immediately (concurrency=1, first task)
    const running = queue.getTask('lc');
    expect(running?.status).toBe('running');
    expect(running?.startedAt).toBeDefined();

    await promise;
    const completed = queue.getTask('lc');
    expect(completed?.status).toBe('completed');
    expect(completed?.completedAt).toBeDefined();
  });

  it('getTask returns undefined for nonexistent id', () => {
    expect(queue.getTask('nope')).toBeUndefined();
  });
});

// =====================================================================
// Concurrency control
// =====================================================================

describe('TaskQueue — concurrency', () => {
  it('runs tasks serially with concurrency=1', async () => {
    const queue = new TaskQueue({ concurrency: 1 });
    const order: number[] = [];

    const p1 = queue.enqueue('a', 'first', async () => {
      order.push(1);
      await delay(30);
      order.push(2);
    });
    const p2 = queue.enqueue('b', 'second', async () => {
      order.push(3);
      await delay(10);
      order.push(4);
    });

    await Promise.all([p1, p2]);
    expect(order).toEqual([1, 2, 3, 4]);
  });

  it('runs tasks in parallel with concurrency>1', async () => {
    const queue = new TaskQueue({ concurrency: 3 });
    const running: string[] = [];
    let maxConcurrent = 0;

    const makeTask = (id: string) =>
      queue.enqueue(id, id, async () => {
        running.push(id);
        maxConcurrent = Math.max(maxConcurrent, running.length);
        await delay(30);
        running.splice(running.indexOf(id), 1);
      });

    await Promise.all([makeTask('a'), makeTask('b'), makeTask('c')]);
    expect(maxConcurrent).toBe(3);
  });

  it('queues excess tasks beyond concurrency limit', async () => {
    const queue = new TaskQueue({ concurrency: 1 });
    let concurrentCount = 0;
    let maxConcurrent = 0;

    const makeTask = (id: string) =>
      queue.enqueue(id, id, async () => {
        concurrentCount++;
        maxConcurrent = Math.max(maxConcurrent, concurrentCount);
        await delay(20);
        concurrentCount--;
      });

    await Promise.all([makeTask('a'), makeTask('b'), makeTask('c')]);
    expect(maxConcurrent).toBe(1);
  });
});

// =====================================================================
// Priority scheduling
// =====================================================================

describe('TaskQueue — priority', () => {
  it('executes higher priority tasks first', async () => {
    const queue = new TaskQueue({ concurrency: 1 });
    const order: string[] = [];

    // Block the queue with a running task so the others queue up
    const blocker = queue.enqueue('block', 'blocker', () => delay(50));

    queue.enqueue('low', 'low', async () => { order.push('low'); }, 1);
    queue.enqueue('high', 'high', async () => { order.push('high'); }, 10);
    queue.enqueue('mid', 'mid', async () => { order.push('mid'); }, 5);

    await blocker;
    await delay(100);

    expect(order).toEqual(['high', 'mid', 'low']);
  });
});

// =====================================================================
// Cancel
// =====================================================================

describe('TaskQueue — cancellation', () => {
  it('cancels a pending task', async () => {
    const queue = new TaskQueue({ concurrency: 1 });
    queue.enqueue('running', 'running', () => delay(100));
    const promise = queue.enqueue('victim', 'victim', async () => 'should not run');

    const cancelled = queue.cancel('victim');
    expect(cancelled).toBe(true);
    expect(queue.getTask('victim')?.status).toBe('cancelled');

    await expect(promise).rejects.toThrow('cancelled');
  });

  it('cannot cancel a running task', async () => {
    const queue = new TaskQueue({ concurrency: 1 });
    const promise = queue.enqueue('run', 'run', () => delay(50));
    expect(queue.cancel('run')).toBe(false);
    await promise;
  });

  it('cancel returns false for nonexistent task', () => {
    const queue = new TaskQueue();
    expect(queue.cancel('nope')).toBe(false);
  });
});

// =====================================================================
// Queue size limits
// =====================================================================

describe('TaskQueue — maxSize', () => {
  it('rejects enqueue when queue is full', () => {
    const queue = new TaskQueue({ concurrency: 1, maxSize: 2 });
    queue.enqueue('a', 'a', () => delay(100));
    queue.enqueue('b', 'b', async () => {});
    queue.enqueue('c', 'c', async () => {});
    expect(() => queue.enqueue('d', 'd', async () => {})).toThrow('Queue is full');
  });
});

// =====================================================================
// Stats & listing
// =====================================================================

describe('TaskQueue — stats and list', () => {
  it('getStats reflects current state', async () => {
    const queue = new TaskQueue({ concurrency: 1 });
    expect(queue.getStats().total).toBe(0);

    const p = queue.enqueue('a', 'a', () => delay(50));
    queue.enqueue('b', 'b', async () => {});

    const mid = queue.getStats();
    expect(mid.running).toBe(1);
    expect(mid.pending).toBe(1);

    await p;
    await delay(30);
    const end = queue.getStats();
    expect(end.completed).toBe(2);
    expect(end.running).toBe(0);
    expect(end.pending).toBe(0);
  });

  it('list returns ordered snapshot', async () => {
    const queue = new TaskQueue({ concurrency: 1 });
    queue.enqueue('a', 'a', () => delay(30));
    queue.enqueue('b', 'b', async () => {}, 5);
    queue.enqueue('c', 'c', async () => {}, 10);

    const items = queue.list();
    expect(items[0].status).toBe('running');
    expect(items[1].id).toBe('c');  // higher priority pending first
    expect(items[2].id).toBe('b');
  });

  it('size property reflects total entries', () => {
    const queue = new TaskQueue();
    queue.enqueue('x', 'x', async () => {});
    expect(queue.size).toBe(1);
  });
});

// =====================================================================
// Events
// =====================================================================

describe('TaskQueue — events', () => {
  it('emits lifecycle events in correct order', async () => {
    const queue = new TaskQueue({ concurrency: 1 });
    const events = collectEvents(queue);

    await queue.enqueue('e', 'evented', async () => 'done');

    const types = events.map(e => e.type);
    expect(types).toContain('task_enqueued');
    expect(types).toContain('task_started');
    expect(types).toContain('task_completed');
    expect(types.indexOf('task_enqueued')).toBeLessThan(types.indexOf('task_started'));
    expect(types.indexOf('task_started')).toBeLessThan(types.indexOf('task_completed'));
  });

  it('emits task_failed for errored tasks', async () => {
    const queue = new TaskQueue();
    const events = collectEvents(queue);

    await queue.enqueue('f', 'fail', async () => { throw new Error('oops'); }).catch(() => {});

    expect(events.some(e => e.type === 'task_failed')).toBe(true);
  });

  it('emits queue_drained when all tasks finish', async () => {
    const queue = new TaskQueue();
    const drainSpy = vi.fn();
    queue.on('queue_drained', drainSpy);

    await queue.enqueue('d', 'd', async () => {});
    expect(drainSpy).toHaveBeenCalled();
  });
});

// =====================================================================
// Drain / close
// =====================================================================

describe('TaskQueue — drain', () => {
  it('drain cancels pending and waits for running', async () => {
    const queue = new TaskQueue({ concurrency: 1 });
    const runPromise = queue.enqueue('r', 'running', () => delay(60));
    const pendingPromise = queue.enqueue('p', 'pending', async () => 'should be cancelled');
    // Attach handler immediately to avoid unhandled rejection
    pendingPromise.catch(() => {});

    await queue.drain();
    expect(queue.getTask('p')?.status).toBe('cancelled');
    expect(queue.getTask('r')?.status).toBe('completed');

    await runPromise;
  });

  it('rejects enqueue after drain', async () => {
    const queue = new TaskQueue();
    await queue.drain();
    expect(() => queue.enqueue('x', 'x', async () => {})).toThrow('closed');
  });
});
