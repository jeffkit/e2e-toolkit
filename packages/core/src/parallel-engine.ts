/**
 * @module parallel-engine
 * ParallelSuiteExecutor — runs multiple test suites concurrently with
 * configurable concurrency limits and isolated variable contexts.
 *
 * Uses an inline semaphore pattern for concurrency limiting and
 * structuredClone for variable context isolation between suites.
 */

import type {
  TestEvent,
  VariableContext,
  YAMLTestSuite,
} from './types.js';
import type { YAMLEngineOptions } from './yaml-engine.js';
import { executeYAMLSuite } from './yaml-engine.js';

export interface ParallelSuiteConfig {
  suite: YAMLTestSuite;
  options: YAMLEngineOptions;
}

export interface ParallelExecutorOptions {
  /** Maximum number of suites to run concurrently. Defaults to number of suites. */
  concurrency?: number;
}

/**
 * Executes test suites concurrently with isolated variable contexts
 * and bounded concurrency.
 *
 * Each suite receives a deep-cloned VariableContext so that `save`
 * operations in one suite cannot affect others. Events from all
 * suites include the `suite` field for correct attribution.
 */
export class ParallelSuiteExecutor {
  /**
   * Execute multiple suites in parallel, collecting all TestEvents.
   *
   * @param configs - Suite configurations to execute
   * @param options - Concurrency settings
   * @returns All TestEvents from all suites, in completion order
   */
  async execute(
    configs: ParallelSuiteConfig[],
    options?: ParallelExecutorOptions,
  ): Promise<TestEvent[]> {
    const concurrency = options?.concurrency ?? configs.length;
    const allEvents: TestEvent[] = [];

    const semaphore = new Semaphore(concurrency);

    const tasks = configs.map(async (config) => {
      await semaphore.acquire();
      try {
        const isolatedOptions = this.cloneOptions(config.options);
        const events: TestEvent[] = [];

        for await (const event of executeYAMLSuite(config.suite, isolatedOptions)) {
          events.push(event);
        }

        return events;
      } finally {
        semaphore.release();
      }
    });

    const results = await Promise.allSettled(tasks);

    for (const result of results) {
      if (result.status === 'fulfilled') {
        allEvents.push(...result.value);
      } else {
        allEvents.push({
          type: 'log',
          level: 'error',
          message: `Suite execution failed: ${
            result.reason instanceof Error
              ? result.reason.message
              : String(result.reason)
          }`,
          timestamp: Date.now(),
        });
      }
    }

    return allEvents;
  }

  /**
   * Execute multiple suites in parallel, yielding TestEvents as they arrive.
   *
   * @param configs - Suite configurations to execute
   * @param options - Concurrency settings
   * @yields {TestEvent} Events from all suites, interleaved by arrival order
   */
  async *stream(
    configs: ParallelSuiteConfig[],
    options?: ParallelExecutorOptions,
  ): AsyncGenerator<TestEvent> {
    const concurrency = options?.concurrency ?? configs.length;
    const eventQueue: TestEvent[] = [];
    let resolveWait: (() => void) | null = null;
    let activeTasks = configs.length;

    const pushEvent = (event: TestEvent) => {
      eventQueue.push(event);
      if (resolveWait) {
        resolveWait();
        resolveWait = null;
      }
    };

    const semaphore = new Semaphore(concurrency);

    for (const config of configs) {
      semaphore.acquire().then(async () => {
        try {
          const isolatedOptions = this.cloneOptions(config.options);
          for await (const event of executeYAMLSuite(config.suite, isolatedOptions)) {
            pushEvent(event);
          }
        } catch (err) {
          pushEvent({
            type: 'log',
            level: 'error',
            message: `Suite execution failed: ${
              err instanceof Error ? err.message : String(err)
            }`,
            timestamp: Date.now(),
          });
        } finally {
          semaphore.release();
          activeTasks--;
          if (resolveWait) {
            resolveWait();
            resolveWait = null;
          }
        }
      });
    }

    while (activeTasks > 0 || eventQueue.length > 0) {
      if (eventQueue.length > 0) {
        yield eventQueue.shift()!;
      } else {
        await new Promise<void>((resolve) => {
          resolveWait = resolve;
          setTimeout(resolve, 100);
        });
      }
    }
  }

  /**
   * Deep-clone YAMLEngineOptions with isolated VariableContext.
   */
  private cloneOptions(options: YAMLEngineOptions): YAMLEngineOptions {
    const clonedVars: VariableContext = structuredClone(options.variables);

    return {
      ...options,
      variables: clonedVars,
    };
  }
}

/**
 * Simple counting semaphore for bounding concurrency.
 */
class Semaphore {
  private count: number;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly max: number) {
    this.count = max;
  }

  async acquire(): Promise<void> {
    if (this.count > 0) {
      this.count--;
      return;
    }

    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.count++;
    }
  }
}
