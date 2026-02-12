/**
 * @module test-runner
 * Unified test runner framework for e2e-toolkit.
 *
 * Provides a {@link RunnerRegistry} for managing multiple test runners
 * and a factory function for creating the default registry with all
 * built-in runners.
 */

import type { TestRunner } from './types.js';

// =====================================================================
// Runner Registry
// =====================================================================

/**
 * Registry that manages named {@link TestRunner} instances.
 *
 * Supports registration, lookup, listing, and auto-detection of
 * available runners.
 */
export class RunnerRegistry {
  private runners = new Map<string, TestRunner>();

  /**
   * Register a test runner.
   *
   * @param runner - Runner instance (must have a unique `id`)
   * @throws {Error} If a runner with the same ID is already registered
   */
  register(runner: TestRunner): void {
    if (this.runners.has(runner.id)) {
      throw new Error(`Runner "${runner.id}" is already registered`);
    }
    this.runners.set(runner.id, runner);
  }

  /**
   * Get a runner by ID.
   *
   * @param id - Runner identifier
   * @returns The runner instance, or `undefined` if not found
   */
  get(id: string): TestRunner | undefined {
    return this.runners.get(id);
  }

  /**
   * List all registered runner IDs.
   *
   * @returns Array of runner ID strings
   */
  list(): string[] {
    return Array.from(this.runners.keys());
  }

  /**
   * Detect which registered runners are available in the current environment.
   *
   * Calls `runner.available()` on each registered runner and returns
   * the IDs of those that report availability.
   *
   * @returns Array of available runner IDs
   */
  async detectAvailable(): Promise<string[]> {
    const results = await Promise.allSettled(
      Array.from(this.runners.entries()).map(async ([id, runner]) => {
        const ok = await runner.available();
        return ok ? id : null;
      }),
    );

    return results
      .filter(
        (r): r is PromiseFulfilledResult<string> =>
          r.status === 'fulfilled' && r.value !== null,
      )
      .map((r) => r.value);
  }
}

// =====================================================================
// Default Registry Factory
// =====================================================================

/**
 * Create a {@link RunnerRegistry} pre-populated with all built-in runners.
 *
 * Built-in runners:
 * - `yaml` — YAML declarative test runner
 * - `vitest` — Vitest JavaScript/TypeScript test runner
 * - `shell` — Shell script test runner
 * - `exec` — Arbitrary command execution runner
 * - `pytest` — Python pytest test runner
 *
 * @returns A new RunnerRegistry with built-in runners registered
 */
export async function createDefaultRegistry(): Promise<RunnerRegistry> {
  const registry = new RunnerRegistry();

  // Dynamically import runners to avoid circular dependencies
  const { YAMLRunner } = await import('./runners/yaml-runner.js');
  const { VitestRunner } = await import('./runners/vitest-runner.js');
  const { ShellRunner } = await import('./runners/shell-runner.js');
  const { ExecRunner } = await import('./runners/exec-runner.js');
  const { PytestRunner } = await import('./runners/pytest-runner.js');

  registry.register(new YAMLRunner());
  registry.register(new VitestRunner());
  registry.register(new ShellRunner());
  registry.register(new ExecRunner());
  registry.register(new PytestRunner());

  return registry;
}
