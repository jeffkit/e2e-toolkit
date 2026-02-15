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
 * Execute a single test step: send HTTP request, exec command, or file assertion.
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

  // ── File step: container file assertions ──
  if (resolvedStep.file) {
    return executeFileStep(resolvedStep, containerName);
  }

  // ── Process step: container process assertions ──
  if (resolvedStep.process) {
    return executeProcessStep(resolvedStep, containerName);
  }

  // ── Port step: port listening assertions ──
  if (resolvedStep.port) {
    return executePortStep(resolvedStep, containerName);
  }

  // ── Exec step: run command inside Docker container ──
  if (resolvedStep.exec) {
    return executeExecStep(resolvedStep, containerName);
  }

  // ── HTTP request step ──
  if (!resolvedStep.request) {
    return [`Step "${resolvedStep.name}" has no recognized step type (request, exec, file, process, or port)`];
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

      // Expression assertions (CEL-like)
      if (resolvedStep.expect.expr) {
        const exprs = Array.isArray(resolvedStep.expect.expr)
          ? resolvedStep.expect.expr
          : [resolvedStep.expect.expr];
        for (const expr of exprs) {
          const exprError = evaluateExpression(expr, {
            status: response.status,
            body: responseBody,
            headers: Object.fromEntries(response.headers.entries()),
          });
          if (exprError) errors.push(exprError);
        }
      }

      // Compound assertions: all (AND)
      if (resolvedStep.expect.all) {
        for (const subExpect of resolvedStep.expect.all) {
          const subResults = assertBody(responseBody, subExpect);
          for (const result of subResults) {
            if (!result.passed) errors.push(result.message);
          }
        }
      }

      // Compound assertions: any (OR)
      if (resolvedStep.expect.any) {
        const anyPassed = resolvedStep.expect.any.some((subExpect) => {
          const subResults = assertBody(responseBody, subExpect);
          return subResults.every(r => r.passed);
        });
        if (!anyPassed) {
          errors.push(`None of the 'any' conditions were satisfied (${resolvedStep.expect.any.length} conditions checked)`);
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
// File Step Execution
// =====================================================================

/**
 * Execute a container file assertion step.
 * Provides a semantic way to assert file properties without writing raw exec commands.
 *
 * @example
 * ```yaml
 * - name: 检查配置文件
 *   file:
 *     path: /app/config.json
 *     exists: true
 *     contains: "database_url"
 *     json:
 *       database_url: { exists: true }
 *       port: { gt: 0 }
 * ```
 */
function executeFileStep(step: TestStep, containerName?: string): string[] {
  const fileConfig = step.file!;
  const container = fileConfig.container || containerName;

  if (!container) {
    return [`File step "${step.name}" requires a container name`];
  }

  const errors: string[] = [];
  const filePath = fileConfig.path;

  // Check file existence
  if (fileConfig.exists !== undefined) {
    try {
      execSync(`docker exec ${container} test -e ${JSON.stringify(filePath)}`, { timeout: 5000 });
      if (!fileConfig.exists) {
        errors.push(`File ${filePath} exists but was expected not to`);
      }
    } catch {
      if (fileConfig.exists) {
        errors.push(`File ${filePath} does not exist`);
        return errors; // No point continuing if file doesn't exist
      }
    }
    // If only checking existence, return early
    if (fileConfig.exists === false) return errors;
  }

  // Check permissions
  if (fileConfig.permissions) {
    try {
      const perms = execSync(
        `docker exec ${container} stat -c '%A' ${JSON.stringify(filePath)}`,
        { encoding: 'utf-8', timeout: 5000 },
      ).trim();
      if (perms !== fileConfig.permissions) {
        errors.push(`File ${filePath} permissions: expected "${fileConfig.permissions}", got "${perms}"`);
      }
    } catch (err) {
      errors.push(`Failed to check permissions of ${filePath}: ${(err as Error).message}`);
    }
  }

  // Check owner
  if (fileConfig.owner) {
    try {
      const owner = execSync(
        `docker exec ${container} stat -c '%U' ${JSON.stringify(filePath)}`,
        { encoding: 'utf-8', timeout: 5000 },
      ).trim();
      if (owner !== fileConfig.owner) {
        errors.push(`File ${filePath} owner: expected "${fileConfig.owner}", got "${owner}"`);
      }
    } catch (err) {
      errors.push(`Failed to check owner of ${filePath}: ${(err as Error).message}`);
    }
  }

  // Check file size
  if (fileConfig.size) {
    try {
      const sizeStr = execSync(
        `docker exec ${container} stat -c '%s' ${JSON.stringify(filePath)}`,
        { encoding: 'utf-8', timeout: 5000 },
      ).trim();
      const size = parseInt(sizeStr, 10);
      const match = fileConfig.size.match(/^([><=!]+)(\d+)$/);
      if (match) {
        const op = match[1];
        const expected = parseInt(match[2], 10);
        let pass = false;
        switch (op) {
          case '>': pass = size > expected; break;
          case '<': pass = size < expected; break;
          case '>=': pass = size >= expected; break;
          case '<=': pass = size <= expected; break;
          case '=': case '==': pass = size === expected; break;
          case '!=': pass = size !== expected; break;
        }
        if (!pass) {
          errors.push(`File ${filePath} size: expected ${fileConfig.size}, got ${size}`);
        }
      }
    } catch (err) {
      errors.push(`Failed to check size of ${filePath}: ${(err as Error).message}`);
    }
  }

  // Read file content for content assertions
  const needsContent = fileConfig.contains || fileConfig.notContains ||
    fileConfig.matches || fileConfig.json;

  if (needsContent) {
    let content: string;
    try {
      content = execSync(
        `docker exec ${container} cat ${JSON.stringify(filePath)}`,
        { encoding: 'utf-8', timeout: 10000 },
      );
    } catch (err) {
      errors.push(`Failed to read ${filePath}: ${(err as Error).message}`);
      return errors;
    }

    // contains
    if (fileConfig.contains) {
      const patterns = Array.isArray(fileConfig.contains)
        ? fileConfig.contains : [fileConfig.contains];
      for (const pattern of patterns) {
        if (!content.includes(pattern)) {
          errors.push(`File ${filePath} does not contain "${pattern}"`);
        }
      }
    }

    // notContains
    if (fileConfig.notContains) {
      const patterns = Array.isArray(fileConfig.notContains)
        ? fileConfig.notContains : [fileConfig.notContains];
      for (const pattern of patterns) {
        if (content.includes(pattern)) {
          errors.push(`File ${filePath} should not contain "${pattern}"`);
        }
      }
    }

    // matches (regex)
    if (fileConfig.matches) {
      const regex = new RegExp(fileConfig.matches);
      if (!regex.test(content)) {
        errors.push(`File ${filePath} does not match /${fileConfig.matches}/`);
      }
    }

    // json - parse and assert
    if (fileConfig.json) {
      try {
        const parsed = JSON.parse(content);
        const bodyResults = assertBody(parsed, fileConfig.json);
        for (const result of bodyResults) {
          if (!result.passed) {
            errors.push(`File ${filePath} JSON: ${result.message}`);
          }
        }
      } catch {
        errors.push(`File ${filePath} is not valid JSON`);
      }
    }
  }

  return errors;
}

// =====================================================================
// Process Step Execution
// =====================================================================

/**
 * Execute a container process assertion step.
 *
 * @example
 * ```yaml
 * - name: 检查 nginx 进程
 *   process:
 *     name: nginx
 *     running: true
 *     count: ">=1"
 *     user: root
 * ```
 */
function executeProcessStep(step: TestStep, containerName?: string): string[] {
  const procConfig = step.process!;
  const container = procConfig.container || containerName;

  if (!container) {
    return [`Process step "${step.name}" requires a container name`];
  }

  const errors: string[] = [];

  try {
    // Get process list
    const output = execSync(
      `docker exec ${container} ps aux 2>/dev/null || docker exec ${container} ps -ef 2>/dev/null`,
      { encoding: 'utf-8', timeout: 10000 },
    );

    // Filter matching processes (exclude the grep itself)
    const lines = output.split('\n')
      .filter(l => l.includes(procConfig.name) && !l.includes('grep'));
    const matchCount = lines.length;

    // Assert running
    if (procConfig.running !== undefined) {
      const isRunning = matchCount > 0;
      if (isRunning !== procConfig.running) {
        errors.push(
          procConfig.running
            ? `Process "${procConfig.name}" is not running`
            : `Process "${procConfig.name}" is running but expected not to be`,
        );
      }
    }

    // Assert count
    if (procConfig.count) {
      const match = procConfig.count.match(/^([><=!]+)(\d+)$/);
      if (match) {
        const op = match[1];
        const expected = parseInt(match[2], 10);
        let pass = false;
        switch (op) {
          case '>': pass = matchCount > expected; break;
          case '<': pass = matchCount < expected; break;
          case '>=': pass = matchCount >= expected; break;
          case '<=': pass = matchCount <= expected; break;
          case '=': case '==': pass = matchCount === expected; break;
          case '!=': pass = matchCount !== expected; break;
        }
        if (!pass) {
          errors.push(`Process "${procConfig.name}" count: expected ${procConfig.count}, got ${matchCount}`);
        }
      }
    }

    // Assert user
    if (procConfig.user && lines.length > 0) {
      const hasCorrectUser = lines.some(l => {
        const parts = l.trim().split(/\s+/);
        return parts[0] === procConfig.user;
      });
      if (!hasCorrectUser) {
        errors.push(`Process "${procConfig.name}" is not running as user "${procConfig.user}"`);
      }
    }
  } catch (err) {
    errors.push(`Failed to check processes: ${(err as Error).message}`);
  }

  return errors;
}

// =====================================================================
// Port Step Execution
// =====================================================================

/**
 * Execute a port listening assertion step.
 *
 * @example
 * ```yaml
 * - name: 检查端口 3000 监听
 *   port:
 *     port: 3000
 *     listening: true
 * ```
 */
function executePortStep(step: TestStep, containerName?: string): string[] {
  const portConfig = step.port!;
  const container = portConfig.container || containerName;
  const errors: string[] = [];

  if (container) {
    // Check port inside container
    try {
      const output = execSync(
        `docker exec ${container} sh -c "ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null || cat /proc/net/tcp 2>/dev/null"`,
        { encoding: 'utf-8', timeout: 10000 },
      );
      const isListening = output.includes(`:${portConfig.port} `) ||
        output.includes(`:${portConfig.port}\t`) ||
        output.includes(`:${portConfig.port}\n`);

      const expectListening = portConfig.listening !== false;
      if (isListening !== expectListening) {
        errors.push(
          expectListening
            ? `Port ${portConfig.port} is not listening inside container`
            : `Port ${portConfig.port} is listening but expected not to be`,
        );
      }
    } catch (err) {
      // Fallback: try TCP connect test
      try {
        execSync(
          `docker exec ${container} sh -c "echo '' > /dev/tcp/localhost/${portConfig.port}" 2>/dev/null`,
          { encoding: 'utf-8', timeout: 5000 },
        );
        // If we get here, port is open
        if (portConfig.listening === false) {
          errors.push(`Port ${portConfig.port} is listening but expected not to be`);
        }
      } catch {
        if (portConfig.listening !== false) {
          errors.push(`Port ${portConfig.port} is not listening inside container`);
        }
      }
    }
  } else {
    // Check port on host
    const host = portConfig.host || 'localhost';
    const timeoutMs = portConfig.timeout ? parseTime(portConfig.timeout) : 5000;

    try {
      // Use node's net module for a quick check
      const result = execSync(
        `node -e "const n=require('net');const s=n.createConnection({port:${portConfig.port},host:'${host}',timeout:${timeoutMs}});s.on('connect',()=>{console.log('open');s.destroy()});s.on('error',()=>{console.log('closed');s.destroy()})"`,
        { encoding: 'utf-8', timeout: timeoutMs + 2000 },
      ).trim();

      const isOpen = result === 'open';
      const expectListening = portConfig.listening !== false;
      if (isOpen !== expectListening) {
        errors.push(
          expectListening
            ? `Port ${host}:${portConfig.port} is not accessible`
            : `Port ${host}:${portConfig.port} is accessible but expected not to be`,
        );
      }
    } catch {
      if (portConfig.listening !== false) {
        errors.push(`Port ${portConfig.host || 'localhost'}:${portConfig.port} check failed`);
      }
    }
  }

  return errors;
}

// =====================================================================
// Expression Evaluator
// =====================================================================

/**
 * Evaluate a simple CEL-like expression against response data.
 *
 * Supported syntax:
 * - `status == 200`
 * - `body.count > 0`
 * - `body.status == "ok"`
 * - `body.items.length > 0`
 * - `body.name != ""`
 * - `body.score >= 80 && body.score <= 100`
 * - `body.type == "A" || body.type == "B"`
 *
 * @returns Error message if assertion fails, null if passes
 */
function evaluateExpression(
  expr: string,
  context: { status: number; body: unknown; headers: Record<string, string> },
): string | null {
  // Handle && (AND) and || (OR) by splitting
  if (expr.includes('&&')) {
    const parts = expr.split('&&').map(p => p.trim());
    for (const part of parts) {
      const error = evaluateExpression(part, context);
      if (error) return `Expression failed: ${expr} (${error})`;
    }
    return null;
  }

  if (expr.includes('||')) {
    const parts = expr.split('||').map(p => p.trim());
    const allErrors: string[] = [];
    for (const part of parts) {
      const error = evaluateExpression(part, context);
      if (!error) return null; // One passed
      allErrors.push(error);
    }
    return `Expression failed: ${expr} (none of the OR conditions passed)`;
  }

  // Parse single comparison: left op right
  const match = expr.match(/^(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
  if (!match) {
    return `Invalid expression syntax: "${expr}"`;
  }

  const [, leftPath, operator, rightRaw] = match;

  // Resolve left side value from context
  const leftValue = resolveExprPath(leftPath.trim(), context);

  // Parse right side value
  let rightValue: unknown;
  const trimmedRight = rightRaw.trim();
  if (trimmedRight === 'true') rightValue = true;
  else if (trimmedRight === 'false') rightValue = false;
  else if (trimmedRight === 'null') rightValue = null;
  else if (/^".*"$/.test(trimmedRight) || /^'.*'$/.test(trimmedRight)) {
    rightValue = trimmedRight.slice(1, -1);
  } else if (/^-?\d+(\.\d+)?$/.test(trimmedRight)) {
    rightValue = parseFloat(trimmedRight);
  } else {
    // Treat as path reference
    rightValue = resolveExprPath(trimmedRight, context);
  }

  // Compare
  let passed = false;
  switch (operator) {
    case '==': passed = leftValue === rightValue; break;
    case '!=': passed = leftValue !== rightValue; break;
    case '>': passed = (leftValue as number) > (rightValue as number); break;
    case '>=': passed = (leftValue as number) >= (rightValue as number); break;
    case '<': passed = (leftValue as number) < (rightValue as number); break;
    case '<=': passed = (leftValue as number) <= (rightValue as number); break;
  }

  if (!passed) {
    return `${leftPath.trim()} ${operator} ${trimmedRight} (actual: ${JSON.stringify(leftValue)} ${operator} ${JSON.stringify(rightValue)})`;
  }

  return null;
}

/**
 * Resolve a dot-path expression against the response context.
 * Supports: status, body.x.y, headers.x, body.items.length
 */
function resolveExprPath(
  path: string,
  context: { status: number; body: unknown; headers: Record<string, string> },
): unknown {
  const parts = path.split('.');

  if (parts[0] === 'status') return context.status;
  if (parts[0] === 'headers') {
    return parts.length > 1 ? context.headers[parts.slice(1).join('.')] : context.headers;
  }

  // body.x.y.z
  let current: unknown = parts[0] === 'body' ? context.body : context.body;
  const startIdx = parts[0] === 'body' ? 1 : 0;

  for (let i = startIdx; i < parts.length; i++) {
    const part = parts[i];
    if (current === null || current === undefined) return undefined;

    // Handle .length on arrays/strings
    if (part === 'length') {
      if (typeof current === 'string' || Array.isArray(current)) return current.length;
      if (typeof current === 'object') return Object.keys(current as Record<string, unknown>).length;
      return undefined;
    }

    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }

  return current;
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
