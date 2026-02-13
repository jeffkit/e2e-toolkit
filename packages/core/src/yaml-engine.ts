/**
 * @module yaml-engine
 * YAML test engine for e2e-toolkit.
 *
 * Parses YAML-based declarative test files, executes HTTP requests,
 * and validates responses using the assertion engine.
 */

import yaml from 'js-yaml';
import fs from 'node:fs/promises';
import { execSync } from 'node:child_process';
import net from 'node:net';
import type { YAMLTestSuite, TestStep, TestEvent, VariableContext } from './types.js';
import { resolveVariables, resolveObjectVariables } from './variable-resolver.js';
import { assertStatus, assertHeaders, assertBody } from './assertion-engine.js';

// =====================================================================
// Public Interfaces
// =====================================================================

/** Options for executing a YAML test suite */
export interface YAMLEngineOptions {
  /** Base URL of the service under test */
  baseUrl: string;
  /** Variable context for template resolution */
  variables: VariableContext;
  /** Default request timeout in milliseconds (default: 30000) */
  defaultTimeout?: number;
  /** Container name for exec steps (docker exec) */
  containerName?: string;
}

// =====================================================================
// YAML Loading
// =====================================================================

/**
 * Load and parse a YAML test file into a {@link YAMLTestSuite}.
 *
 * @param filePath - Path to the YAML test file
 * @returns Parsed test suite
 * @throws {Error} If the file cannot be read or parsed
 */
export async function loadYAMLTests(filePath: string): Promise<YAMLTestSuite> {
  let content: string;
  try {
    content = await fs.readFile(filePath, 'utf-8');
  } catch (err) {
    throw new Error(
      `Failed to read YAML test file: ${filePath}: ${(err as Error).message}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = yaml.load(content);
  } catch (err) {
    throw new Error(
      `YAML syntax error in ${filePath}: ${(err as Error).message}`,
    );
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`YAML test file is empty or invalid: ${filePath}`);
  }

  const suite = parsed as Record<string, unknown>;

  // Validate required fields
  if (!suite['name'] || typeof suite['name'] !== 'string') {
    throw new Error(`YAML test file missing required "name" field: ${filePath}`);
  }

  if (!Array.isArray(suite['cases'])) {
    throw new Error(`YAML test file missing required "cases" array: ${filePath}`);
  }

  return {
    name: suite['name'] as string,
    description: suite['description'] as string | undefined,
    sequential: suite['sequential'] as boolean | undefined,
    variables: suite['variables'] as Record<string, string> | undefined,
    setup: suite['setup'] as YAMLTestSuite['setup'],
    teardown: suite['teardown'] as YAMLTestSuite['teardown'],
    cases: suite['cases'] as TestStep[],
  };
}

// =====================================================================
// Time Parsing
// =====================================================================

/**
 * Parse a human-readable time string into milliseconds.
 *
 * Supported formats:
 * - `"5s"` → 5000
 * - `"100ms"` → 100
 * - `"2m"` → 120000
 * - `"1h"` → 3600000
 * - `"500"` → 500 (plain number treated as milliseconds)
 *
 * @param time - Time string to parse
 * @returns Time in milliseconds
 * @throws {Error} If the format is unrecognized
 */
export function parseTime(time: string): number {
  const trimmed = time.trim();

  // Plain number → milliseconds
  if (/^\d+$/.test(trimmed)) {
    return parseInt(trimmed, 10);
  }

  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h)$/);
  if (!match) {
    throw new Error(`Invalid time format: "${time}". Expected format like "5s", "100ms", "2m", "1h"`);
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

// =====================================================================
// Test Execution Engine
// =====================================================================

/**
 * Execute a YAML test suite, yielding {@link TestEvent} entries.
 *
 * Execution order:
 * 1. Merge suite-level variables into the variable context
 * 2. Execute `setup` steps (if any)
 * 3. Execute each `case` sequentially
 * 4. Execute `teardown` steps (if any, errors are optionally ignored)
 * 5. Yield `suite_end` summary
 *
 * @param suite - Parsed YAML test suite
 * @param options - Engine options (baseUrl, variables, timeout)
 * @yields {TestEvent} Test progress events
 */
export async function* executeYAMLSuite(
  suite: YAMLTestSuite,
  options: YAMLEngineOptions,
): AsyncGenerator<TestEvent> {
  const suiteStart = Date.now();
  const suiteName = suite.name;
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  yield { type: 'suite_start', suite: suiteName, timestamp: Date.now() };

  // Merge suite-level variables into the context
  const ctx = options.variables;
  if (suite.variables) {
    for (const [key, value] of Object.entries(suite.variables)) {
      ctx.runtime[key] = resolveVariables(value, ctx);
    }
  }

  const defaultTimeout = options.defaultTimeout ?? 30_000;

  // ---- Setup ----
  if (suite.setup) {
    for (const step of suite.setup) {
      if ('waitHealthy' in step) {
        yield { type: 'log', level: 'info', message: 'Waiting for service to be healthy...', timestamp: Date.now() };
        const waitOpts = step.waitHealthy ?? {};
        const timeout = waitOpts.timeout ? parseTime(waitOpts.timeout) : 60_000;
        const healthy = await waitForUrl(`${options.baseUrl}/health`, timeout);
        if (!healthy) {
          yield { type: 'log', level: 'error', message: `Service did not become healthy within ${timeout}ms`, timestamp: Date.now() };
        }
        continue;
      }

      if ('waitForPort' in step) {
        const portOpts = (step as { waitForPort: { host?: string; port: number; timeout?: string } }).waitForPort;
        const host = portOpts.host || 'localhost';
        const port = portOpts.port;
        const timeout = portOpts.timeout ? parseTime(portOpts.timeout) : 60_000;
        yield { type: 'log', level: 'info', message: `Waiting for ${host}:${port} to be available...`, timestamp: Date.now() };
        const available = await waitForPort(host, port, timeout);
        if (!available) {
          yield { type: 'log', level: 'error', message: `Port ${host}:${port} did not become available within ${timeout}ms`, timestamp: Date.now() };
        } else {
          yield { type: 'log', level: 'info', message: `Port ${host}:${port} is available ✓`, timestamp: Date.now() };
        }
        continue;
      }

      if ('delay' in step && !('request' in step) && !('exec' in step)) {
        const delayStr = (step as { delay: string }).delay;
        const delayMs = parseTime(delayStr);
        yield { type: 'log', level: 'info', message: `Waiting ${delayStr}...`, timestamp: Date.now() };
        await sleep(delayMs);
        continue;
      }

      // Regular setup step (TestStep)
      const testStep = step as TestStep;
      try {
        await executeStep(testStep, options.baseUrl, ctx, defaultTimeout, options.containerName);
        yield { type: 'log', level: 'info', message: `Setup: ${testStep.name} ✓`, timestamp: Date.now() };
      } catch (err) {
        if (testStep.ignoreError) {
          yield { type: 'log', level: 'warn', message: `Setup (ignored): ${testStep.name}: ${(err as Error).message}`, timestamp: Date.now() };
        } else {
          yield { type: 'log', level: 'error', message: `Setup failed: ${testStep.name}: ${(err as Error).message}`, timestamp: Date.now() };
        }
      }
    }
  }

  // ---- Test Cases ----
  for (const testCase of suite.cases) {
    const caseStart = Date.now();
    const caseName = testCase.name;

    yield { type: 'case_start', suite: suiteName, name: caseName, timestamp: Date.now() };

    try {
      // Handle delay
      if (testCase.delay) {
        const delayMs = parseTime(testCase.delay);
        await sleep(delayMs);
      }

      // Execute the step and get assertion results
      const errors = await executeStep(testCase, options.baseUrl, ctx, defaultTimeout, options.containerName);

      if (errors.length > 0) {
        failed++;
        yield {
          type: 'case_fail',
          suite: suiteName,
          name: caseName,
          error: errors.join('\n'),
          duration: Date.now() - caseStart,
          timestamp: Date.now(),
        };
      } else {
        passed++;
        yield {
          type: 'case_pass',
          suite: suiteName,
          name: caseName,
          duration: Date.now() - caseStart,
          timestamp: Date.now(),
        };
      }
    } catch (err) {
      failed++;
      yield {
        type: 'case_fail',
        suite: suiteName,
        name: caseName,
        error: (err as Error).message,
        duration: Date.now() - caseStart,
        timestamp: Date.now(),
      };
    }
  }

  // ---- Teardown ----
  if (suite.teardown) {
    for (const step of suite.teardown) {
      try {
        await executeStep(step, options.baseUrl, ctx, defaultTimeout, options.containerName);
        yield { type: 'log', level: 'info', message: `Teardown: ${step.name} ✓`, timestamp: Date.now() };
      } catch (err) {
        if (!step.ignoreError) {
          yield { type: 'log', level: 'warn', message: `Teardown failed: ${step.name}: ${(err as Error).message}`, timestamp: Date.now() };
        }
      }
    }
  }

  yield {
    type: 'suite_end',
    suite: suiteName,
    passed,
    failed,
    skipped,
    duration: Date.now() - suiteStart,
    timestamp: Date.now(),
  };
}

// =====================================================================
// Internal: Step Execution
// =====================================================================

/**
 * Execute a single test step: send HTTP request or run exec command, then run assertions.
 *
 * @returns Array of error messages (empty if all assertions pass)
 */
async function executeStep(
  step: TestStep,
  baseUrl: string,
  ctx: VariableContext,
  defaultTimeout: number,
  containerName?: string,
): Promise<string[]> {
  // Resolve variables in the step
  const resolvedStep = resolveObjectVariables(step, ctx) as TestStep;

  // ── Exec step: run command inside Docker container ──
  if (resolvedStep.exec) {
    return executeExecStep(resolvedStep, containerName);
  }

  // ── HTTP request step ──
  if (!resolvedStep.request) {
    return [`Step "${resolvedStep.name}" has neither request nor exec`];
  }

  // Build the URL: prefer explicit url, otherwise baseUrl + path
  const url = resolvedStep.request.url || `${baseUrl}${resolvedStep.request.path}`;
  const timeout = resolvedStep.request.timeout
    ? parseTime(resolvedStep.request.timeout)
    : defaultTimeout;

  // Prepare fetch options
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const fetchOptions: RequestInit = {
      method: resolvedStep.request.method,
      signal: controller.signal,
      headers: resolvedStep.request.headers ?? {},
    };

    if (
      resolvedStep.request.body !== undefined &&
      resolvedStep.request.body !== null &&
      resolvedStep.request.method !== 'GET'
    ) {
      const headers = fetchOptions.headers as Record<string, string>;
      if (!headers['Content-Type'] && !headers['content-type']) {
        headers['Content-Type'] = 'application/json';
      }
      fetchOptions.body = JSON.stringify(resolvedStep.request.body);
    }

    // Send the request
    const response = await fetch(url, fetchOptions);

    // Parse response body
    const contentType = response.headers.get('content-type') ?? '';
    let responseBody: unknown;
    if (contentType.includes('application/json')) {
      responseBody = await response.json();
    } else {
      responseBody = await response.text();
    }

    // Collect assertion errors
    const errors: string[] = [];

    if (resolvedStep.expect) {
      // Assert status
      if (resolvedStep.expect.status !== undefined) {
        const statusResult = assertStatus(response.status, resolvedStep.expect.status);
        if (!statusResult.passed) {
          errors.push(statusResult.message);
        }
      }

      // Assert headers
      if (resolvedStep.expect.headers) {
        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          responseHeaders[key] = value;
        });
        const headerResults = assertHeaders(responseHeaders, resolvedStep.expect.headers);
        for (const result of headerResults) {
          if (!result.passed) {
            errors.push(result.message);
          }
        }
      }

      // Assert body
      if (resolvedStep.expect.body) {
        const bodyResults = assertBody(responseBody, resolvedStep.expect.body);
        for (const result of bodyResults) {
          if (!result.passed) {
            errors.push(result.message);
          }
        }
      }
    }

    // Save variables from response
    if (step.save && responseBody && typeof responseBody === 'object') {
      for (const [varName, jsonPath] of Object.entries(step.save)) {
        const value = getValueByPath(responseBody, jsonPath);
        if (value !== undefined) {
          ctx.runtime[varName] = String(value);
        }
      }
    }

    return errors;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Execute a Docker exec step: run a command inside the container and validate output.
 *
 * @returns Array of error messages (empty if all assertions pass)
 */
function executeExecStep(step: TestStep, containerName?: string): string[] {
  const execConfig = step.exec!;
  const container = execConfig.container || containerName;

  if (!container) {
    return [`Exec step "${step.name}" requires a container name (set containerName in options or exec.container)`];
  }

  const errors: string[] = [];
  let output = '';
  let exitCode = 0;

  try {
    output = execSync(
      `docker exec ${container} sh -c ${JSON.stringify(execConfig.command)}`,
      { encoding: 'utf-8', timeout: 15_000 },
    ).trim();
  } catch (err: unknown) {
    const execErr = err as { stdout?: string; stderr?: string; status?: number; message?: string };
    output = (execErr.stdout || execErr.stderr || '').trim();
    exitCode = execErr.status ?? 1;

    // If no expect is defined and command failed, that's an error
    if (!step.expect) {
      return [`Exec command failed with exit code ${exitCode}: ${execErr.message || ''}`];
    }
  }

  if (!step.expect) {
    return [];
  }

  // Assert exit code
  if (step.expect.exitCode !== undefined && exitCode !== step.expect.exitCode) {
    errors.push(`Exit code: expected ${step.expect.exitCode}, got ${exitCode}`);
  }

  // Assert output
  if (step.expect.output) {
    const outExpect = step.expect.output;

    // contains
    if (outExpect.contains) {
      const patterns = Array.isArray(outExpect.contains) ? outExpect.contains : [outExpect.contains];
      for (const pattern of patterns) {
        if (!output.includes(pattern)) {
          errors.push(`Output does not contain "${pattern}". Output:\n${output.slice(0, 500)}`);
        }
      }
    }

    // notContains
    if (outExpect.notContains) {
      const patterns = Array.isArray(outExpect.notContains) ? outExpect.notContains : [outExpect.notContains];
      for (const pattern of patterns) {
        if (output.includes(pattern)) {
          errors.push(`Output should not contain "${pattern}"`);
        }
      }
    }

    // matches (regex)
    if (outExpect.matches) {
      const regex = new RegExp(outExpect.matches);
      if (!regex.test(output)) {
        errors.push(`Output does not match regex /${outExpect.matches}/. Output:\n${output.slice(0, 500)}`);
      }
    }

    // json
    if (outExpect.json) {
      try {
        const parsed = JSON.parse(output);
        const bodyResults = assertBody(parsed, outExpect.json);
        for (const result of bodyResults) {
          if (!result.passed) {
            errors.push(result.message);
          }
        }
      } catch {
        errors.push(`Failed to parse output as JSON. Output:\n${output.slice(0, 500)}`);
      }
    }

    // length (line count)
    if (outExpect.length) {
      const lines = output ? output.split('\n').length : 0;
      const lengthCheck = outExpect.length;
      const match = lengthCheck.match(/^([><=!]+)(\d+)$/);
      if (match) {
        const op = match[1];
        const expected = parseInt(match[2], 10);
        let pass = false;
        switch (op) {
          case '>': pass = lines > expected; break;
          case '<': pass = lines < expected; break;
          case '>=': pass = lines >= expected; break;
          case '<=': pass = lines <= expected; break;
          case '=': case '==': pass = lines === expected; break;
          case '!=': pass = lines !== expected; break;
        }
        if (!pass) {
          errors.push(`Output line count: expected ${lengthCheck}, got ${lines}`);
        }
      }
    }
  }

  return errors;
}

// =====================================================================
// Internal Helpers
// =====================================================================

/**
 * Get a value from a nested object by dot-separated path.
 *
 * @example
 * getValueByPath({ a: { b: 42 } }, "a.b") // → 42
 */
function getValueByPath(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Wait for a URL to respond with a 2xx status code.
 */
async function waitForUrl(url: string, timeoutMs: number): Promise<boolean> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) return true;
    } catch {
      // Service not ready yet
    }
    await sleep(2000);
  }

  return false;
}

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait for a TCP port to become available.
 */
async function waitForPort(host: string, port: number, timeoutMs: number): Promise<boolean> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const isOpen = await new Promise<boolean>((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(2000);
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => {
        socket.destroy();
        resolve(false);
      });
      socket.once('timeout', () => {
        socket.destroy();
        resolve(false);
      });
      socket.connect(port, host);
    });

    if (isOpen) return true;
    await sleep(2000);
  }

  return false;
}
