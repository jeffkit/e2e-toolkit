/**
 * @module assertion-engine
 * Assertion DSL engine for preflight.
 *
 * Evaluates YAML `expect` blocks against actual HTTP response data.
 * Supports exact matching, type checks, existence, numeric comparisons,
 * string operations, regex matching, length checks, and nested object assertions.
 */

import type { AssertionResult } from './types.js';

// =====================================================================
// Assertion Operator Names
// =====================================================================

/** Set of recognized assertion operator keys */
const ASSERTION_OPERATORS = new Set([
  'type',
  'exists',
  'in',
  'gt',
  'gte',
  'lt',
  'lte',
  'contains',
  'notContains',
  'matches',
  'startsWith',
  'endsWith',
  'length',
  'every',
  'some',
  'not',
]);

// =====================================================================
// Public API
// =====================================================================

/**
 * Assert the response body against expected value rules.
 *
 * For each key in `expected`:
 * - If the value is a **primitive** (string, number, boolean, null) → exact match
 * - If the value is an **object with operator keys** → run operator assertions
 * - If the value is a **plain nested object** → recurse into sub-fields
 *
 * @param actual - The actual response body (parsed JSON)
 * @param expected - The expected value rules from YAML `expect.body`
 * @param basePath - Dot-separated path prefix for error reporting (default: "body")
 * @returns Array of assertion results (one per check)
 */
export function assertBody(
  actual: unknown,
  expected: Record<string, unknown>,
  basePath = 'body',
): AssertionResult[] {
  const results: AssertionResult[] = [];

  for (const [key, expectedValue] of Object.entries(expected)) {
    const currentPath = basePath ? `${basePath}.${key}` : key;
    const actualValue = getNestedValue(actual, key);

    results.push(...evaluateAssertion(actualValue, expectedValue, currentPath));
  }

  return results;
}

/**
 * Assert the HTTP status code.
 *
 * @param actual - Actual HTTP status code
 * @param expected - Expected status code (single number or array of acceptable codes)
 * @returns A single assertion result
 */
export function assertStatus(
  actual: number,
  expected: number | number[],
): AssertionResult {
  if (Array.isArray(expected)) {
    const passed = expected.includes(actual);
    return {
      path: 'status',
      operator: 'in',
      expected,
      actual,
      passed,
      message: passed
        ? `Status ${actual} is in [${expected.join(', ')}]`
        : `Expected status to be one of [${expected.join(', ')}], got ${actual}`,
    };
  }

  const passed = actual === expected;
  return {
    path: 'status',
    operator: 'exact',
    expected,
    actual,
    passed,
    message: passed
      ? `Status is ${actual}`
      : `Expected status ${expected}, got ${actual}`,
  };
}

/**
 * Assert response headers against expected rules.
 *
 * Header names are compared case-insensitively.
 *
 * @param actual - Actual response headers (lowercase keys)
 * @param expected - Expected header rules
 * @returns Array of assertion results
 */
export function assertHeaders(
  actual: Record<string, string>,
  expected: Record<string, unknown>,
): AssertionResult[] {
  const results: AssertionResult[] = [];

  // Normalize actual headers to lowercase keys
  const normalizedActual: Record<string, string> = {};
  for (const [key, value] of Object.entries(actual)) {
    normalizedActual[key.toLowerCase()] = value;
  }

  for (const [key, expectedValue] of Object.entries(expected)) {
    const lowerKey = key.toLowerCase();
    const currentPath = `headers.${lowerKey}`;
    const actualValue: unknown = normalizedActual[lowerKey];

    results.push(...evaluateAssertion(actualValue, expectedValue, currentPath));
  }

  return results;
}

// =====================================================================
// Core Evaluation Logic
// =====================================================================

/**
 * Evaluate an assertion for a single value.
 *
 * Dispatches to the appropriate handler based on the expected value type:
 * - Primitive → exact match
 * - Object with operator keys → operator assertions
 * - Plain object → nested recursive assertions
 */
function evaluateAssertion(
  actual: unknown,
  expected: unknown,
  path: string,
): AssertionResult[] {
  // Null exact match
  if (expected === null) {
    return [exactMatch(actual, null, path)];
  }

  // Primitive exact match (string, number, boolean)
  if (typeof expected !== 'object') {
    return [exactMatch(actual, expected, path)];
  }

  // Array — exact match
  if (Array.isArray(expected)) {
    return [exactMatch(actual, expected, path)];
  }

  // Object — check if it contains operator keys
  const expectedObj = expected as Record<string, unknown>;
  const keys = Object.keys(expectedObj);

  if (keys.length === 0) {
    return [exactMatch(actual, expected, path)];
  }

  const hasOperators = keys.some((k) => ASSERTION_OPERATORS.has(k));

  if (hasOperators) {
    return runOperatorAssertions(actual, expectedObj, path);
  }

  // Plain nested object — recurse
  return assertNestedObject(actual, expectedObj, path);
}

/**
 * Run operator-based assertions on a value.
 */
function runOperatorAssertions(
  actual: unknown,
  operators: Record<string, unknown>,
  path: string,
): AssertionResult[] {
  const results: AssertionResult[] = [];

  for (const [op, expected] of Object.entries(operators)) {
    if (!ASSERTION_OPERATORS.has(op)) {
      // Not an operator — treat as nested key
      const nestedActual = getNestedValue(actual, op);
      results.push(...evaluateAssertion(nestedActual, expected, `${path}.${op}`));
      continue;
    }

    switch (op) {
      case 'type':
        results.push(assertType(actual, expected as string, path));
        break;
      case 'exists':
        results.push(assertExists(actual, expected as boolean, path));
        break;
      case 'in':
        results.push(assertIn(actual, expected as unknown[], path));
        break;
      case 'gt':
        results.push(assertComparison(actual, expected as number, 'gt', path));
        break;
      case 'gte':
        results.push(assertComparison(actual, expected as number, 'gte', path));
        break;
      case 'lt':
        results.push(assertComparison(actual, expected as number, 'lt', path));
        break;
      case 'lte':
        results.push(assertComparison(actual, expected as number, 'lte', path));
        break;
      case 'contains':
        results.push(assertContains(actual, expected, path));
        break;
      case 'matches':
        results.push(assertMatches(actual, expected as string, path));
        break;
      case 'startsWith':
        results.push(assertStartsWith(actual, expected as string, path));
        break;
      case 'endsWith':
        results.push(assertEndsWith(actual, expected as string, path));
        break;
      case 'notContains':
        results.push(assertNotContains(actual, expected, path));
        break;
      case 'length':
        results.push(...assertLength(actual, expected, path));
        break;
      case 'every':
        results.push(...assertEvery(actual, expected as Record<string, unknown>, path));
        break;
      case 'some':
        results.push(...assertSome(actual, expected as Record<string, unknown>, path));
        break;
      case 'not':
        results.push(...assertNot(actual, expected, path));
        break;
    }
  }

  return results;
}

/**
 * Recursively assert nested object fields.
 */
function assertNestedObject(
  actual: unknown,
  expected: Record<string, unknown>,
  basePath: string,
): AssertionResult[] {
  const results: AssertionResult[] = [];

  if (actual === null || actual === undefined || typeof actual !== 'object') {
    results.push({
      path: basePath,
      operator: 'object',
      expected: 'object',
      actual: actual === null ? 'null' : typeof actual,
      passed: false,
      message: `Expected ${basePath} to be an object, got ${actual === null ? 'null' : typeof actual}`,
    });
    return results;
  }

  for (const [key, expectedValue] of Object.entries(expected)) {
    const currentPath = `${basePath}.${key}`;
    const actualValue = (actual as Record<string, unknown>)[key];
    results.push(...evaluateAssertion(actualValue, expectedValue, currentPath));
  }

  return results;
}

// =====================================================================
// Individual Assertion Operators
// =====================================================================

/** Exact value match */
function exactMatch(actual: unknown, expected: unknown, path: string): AssertionResult {
  const passed = deepEqual(actual, expected);
  return {
    path,
    operator: 'exact',
    expected,
    actual,
    passed,
    message: passed
      ? `${path} equals ${JSON.stringify(expected)}`
      : `Expected ${path} to equal ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  };
}

/** Type check assertion */
function assertType(actual: unknown, expectedType: string, path: string): AssertionResult {
  let actualType: string;

  if (actual === null) {
    actualType = 'null';
  } else if (Array.isArray(actual)) {
    actualType = 'array';
  } else {
    actualType = typeof actual;
  }

  const passed = actualType === expectedType;
  return {
    path,
    operator: 'type',
    expected: expectedType,
    actual: actualType,
    passed,
    message: passed
      ? `${path} is of type ${expectedType}`
      : `Expected ${path} to be of type ${expectedType}, got ${actualType}`,
  };
}

/** Existence check assertion */
function assertExists(actual: unknown, shouldExist: boolean, path: string): AssertionResult {
  const exists = actual !== undefined && actual !== null;
  const passed = exists === shouldExist;
  return {
    path,
    operator: 'exists',
    expected: shouldExist,
    actual: exists,
    passed,
    message: passed
      ? shouldExist
        ? `${path} exists`
        : `${path} does not exist`
      : shouldExist
        ? `Expected ${path} to exist, but it is ${actual === null ? 'null' : 'undefined'}`
        : `Expected ${path} not to exist, but got ${JSON.stringify(actual)}`,
  };
}

/** Set inclusion assertion */
function assertIn(actual: unknown, allowedValues: unknown[], path: string): AssertionResult {
  const passed = allowedValues.some((v) => deepEqual(actual, v));
  return {
    path,
    operator: 'in',
    expected: allowedValues,
    actual,
    passed,
    message: passed
      ? `${path} is in [${allowedValues.map((v) => JSON.stringify(v)).join(', ')}]`
      : `Expected ${path} to be one of [${allowedValues.map((v) => JSON.stringify(v)).join(', ')}], got ${JSON.stringify(actual)}`,
  };
}

/** Numeric comparison assertion */
function assertComparison(
  actual: unknown,
  expected: number,
  op: 'gt' | 'gte' | 'lt' | 'lte',
  path: string,
): AssertionResult {
  if (typeof actual !== 'number') {
    return {
      path,
      operator: op,
      expected,
      actual,
      passed: false,
      message: `Expected ${path} to be a number for ${op} comparison, got ${typeof actual}`,
    };
  }

  let passed: boolean;
  let symbol: string;
  switch (op) {
    case 'gt':
      passed = actual > expected;
      symbol = '>';
      break;
    case 'gte':
      passed = actual >= expected;
      symbol = '>=';
      break;
    case 'lt':
      passed = actual < expected;
      symbol = '<';
      break;
    case 'lte':
      passed = actual <= expected;
      symbol = '<=';
      break;
  }

  return {
    path,
    operator: op,
    expected,
    actual,
    passed,
    message: passed
      ? `${path} (${actual}) ${symbol} ${expected}`
      : `Expected ${path} ${symbol} ${expected}, got ${actual}`,
  };
}

/** String/array contains assertion */
function assertContains(actual: unknown, expected: unknown, path: string): AssertionResult {
  let passed = false;

  if (typeof actual === 'string' && typeof expected === 'string') {
    passed = actual.includes(expected);
  } else if (Array.isArray(actual)) {
    passed = actual.some((item) => deepEqual(item, expected));
  }

  return {
    path,
    operator: 'contains',
    expected,
    actual,
    passed,
    message: passed
      ? `${path} contains ${JSON.stringify(expected)}`
      : `Expected ${path} to contain ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  };
}

/** Regex match assertion */
function assertMatches(actual: unknown, pattern: string, path: string): AssertionResult {
  if (typeof actual !== 'string') {
    return {
      path,
      operator: 'matches',
      expected: pattern,
      actual,
      passed: false,
      message: `Expected ${path} to be a string for regex match, got ${typeof actual}`,
    };
  }

  const regex = new RegExp(pattern);
  const passed = regex.test(actual);
  return {
    path,
    operator: 'matches',
    expected: pattern,
    actual,
    passed,
    message: passed
      ? `${path} matches /${pattern}/`
      : `Expected ${path} to match /${pattern}/, got "${actual}"`,
  };
}

/** String prefix assertion */
function assertStartsWith(actual: unknown, prefix: string, path: string): AssertionResult {
  if (typeof actual !== 'string') {
    return {
      path,
      operator: 'startsWith',
      expected: prefix,
      actual,
      passed: false,
      message: `Expected ${path} to be a string for startsWith, got ${typeof actual}`,
    };
  }

  const passed = actual.startsWith(prefix);
  return {
    path,
    operator: 'startsWith',
    expected: prefix,
    actual,
    passed,
    message: passed
      ? `${path} starts with "${prefix}"`
      : `Expected ${path} to start with "${prefix}", got "${actual}"`,
  };
}

/**
 * Length assertion.
 *
 * Supports:
 * - `length: 5` — exact length match
 * - `length: { gt: 0 }` — numeric comparison on length
 */
function assertLength(
  actual: unknown,
  expected: unknown,
  path: string,
): AssertionResult[] {
  const results: AssertionResult[] = [];

  // Get length from actual value
  let actualLength: number | undefined;
  if (typeof actual === 'string' || Array.isArray(actual)) {
    actualLength = actual.length;
  } else if (actual !== null && actual !== undefined && typeof actual === 'object') {
    actualLength = Object.keys(actual as Record<string, unknown>).length;
  }

  if (actualLength === undefined) {
    results.push({
      path,
      operator: 'length',
      expected,
      actual,
      passed: false,
      message: `Expected ${path} to have a length property, got ${typeof actual}`,
    });
    return results;
  }

  // Exact length match
  if (typeof expected === 'number') {
    const passed = actualLength === expected;
    results.push({
      path,
      operator: 'length',
      expected,
      actual: actualLength,
      passed,
      message: passed
        ? `${path} has length ${expected}`
        : `Expected ${path} to have length ${expected}, got ${actualLength}`,
    });
    return results;
  }

  // Comparison operators on length
  if (expected !== null && typeof expected === 'object' && !Array.isArray(expected)) {
    const lengthOps = expected as Record<string, number>;
    for (const [op, value] of Object.entries(lengthOps)) {
      if (['gt', 'gte', 'lt', 'lte'].includes(op)) {
        const compResult = assertComparison(
          actualLength,
          value,
          op as 'gt' | 'gte' | 'lt' | 'lte',
          `${path}.length`,
        );
        results.push(compResult);
      }
    }
    return results;
  }

  results.push({
    path,
    operator: 'length',
    expected,
    actual: actualLength,
    passed: false,
    message: `Invalid length assertion value for ${path}: ${JSON.stringify(expected)}`,
  });

  return results;
}

/** String suffix assertion */
function assertEndsWith(actual: unknown, suffix: string, path: string): AssertionResult {
  if (typeof actual !== 'string') {
    return {
      path,
      operator: 'endsWith',
      expected: suffix,
      actual,
      passed: false,
      message: `Expected ${path} to be a string for endsWith, got ${typeof actual}`,
    };
  }

  const passed = actual.endsWith(suffix);
  return {
    path,
    operator: 'endsWith',
    expected: suffix,
    actual,
    passed,
    message: passed
      ? `${path} ends with "${suffix}"`
      : `Expected ${path} to end with "${suffix}", got "${actual}"`,
  };
}

/** Negated string/array contains assertion */
function assertNotContains(actual: unknown, expected: unknown, path: string): AssertionResult {
  let contained = false;

  if (typeof actual === 'string' && typeof expected === 'string') {
    contained = actual.includes(expected);
  } else if (Array.isArray(actual)) {
    contained = actual.some((item) => deepEqual(item, expected));
  }

  return {
    path,
    operator: 'notContains',
    expected,
    actual,
    passed: !contained,
    message: !contained
      ? `${path} does not contain ${JSON.stringify(expected)}`
      : `Expected ${path} not to contain ${JSON.stringify(expected)}`,
  };
}

/**
 * Array `every` assertion — all items must satisfy the given conditions.
 *
 * @example
 * ```yaml
 * items:
 *   every:
 *     email: { exists: true }
 *     role: { in: [admin, user] }
 * ```
 */
function assertEvery(
  actual: unknown,
  conditions: Record<string, unknown>,
  path: string,
): AssertionResult[] {
  if (!Array.isArray(actual)) {
    return [{
      path,
      operator: 'every',
      expected: 'array',
      actual: actual === null ? 'null' : typeof actual,
      passed: false,
      message: `Expected ${path} to be an array for 'every' assertion, got ${actual === null ? 'null' : typeof actual}`,
    }];
  }

  if (actual.length === 0) {
    return [{
      path,
      operator: 'every',
      expected: conditions,
      actual: [],
      passed: true,
      message: `${path} is empty — 'every' vacuously passes`,
    }];
  }

  const failures: AssertionResult[] = [];

  for (let i = 0; i < actual.length; i++) {
    const item = actual[i];
    const itemPath = `${path}[${i}]`;

    if (item === null || item === undefined || typeof item !== 'object' || Array.isArray(item)) {
      const itemResults = evaluateAssertion(item, conditions, itemPath);
      const itemFailures = itemResults.filter(r => !r.passed);
      if (itemFailures.length > 0) {
        failures.push(...itemFailures);
      }
    } else {
      const itemResults = assertBody(item, conditions, itemPath);
      const itemFailures = itemResults.filter(r => !r.passed);
      if (itemFailures.length > 0) {
        failures.push(...itemFailures);
      }
    }
  }

  if (failures.length === 0) {
    return [{
      path,
      operator: 'every',
      expected: conditions,
      actual: `all ${actual.length} items passed`,
      passed: true,
      message: `${path}: all ${actual.length} items satisfy 'every' conditions`,
    }];
  }

  return [{
    path,
    operator: 'every',
    expected: conditions,
    actual: `${failures.length} assertion(s) failed`,
    passed: false,
    message: `${path}: 'every' failed — ${failures.map(f => f.message).join('; ')}`,
  }];
}

/**
 * Array `some` assertion — at least one item must satisfy all conditions.
 *
 * @example
 * ```yaml
 * items:
 *   some:
 *     role: "admin"
 * ```
 */
function assertSome(
  actual: unknown,
  conditions: Record<string, unknown>,
  path: string,
): AssertionResult[] {
  if (!Array.isArray(actual)) {
    return [{
      path,
      operator: 'some',
      expected: 'array',
      actual: actual === null ? 'null' : typeof actual,
      passed: false,
      message: `Expected ${path} to be an array for 'some' assertion, got ${actual === null ? 'null' : typeof actual}`,
    }];
  }

  if (actual.length === 0) {
    return [{
      path,
      operator: 'some',
      expected: conditions,
      actual: [],
      passed: false,
      message: `${path} is empty — 'some' fails (no items to match)`,
    }];
  }

  for (let i = 0; i < actual.length; i++) {
    const item = actual[i];
    const itemPath = `${path}[${i}]`;

    let itemResults: AssertionResult[];
    if (item === null || item === undefined || typeof item !== 'object' || Array.isArray(item)) {
      itemResults = evaluateAssertion(item, conditions, itemPath);
    } else {
      itemResults = assertBody(item, conditions, itemPath);
    }

    if (itemResults.every(r => r.passed)) {
      return [{
        path,
        operator: 'some',
        expected: conditions,
        actual: `item [${i}] matched`,
        passed: true,
        message: `${path}: item [${i}] satisfies 'some' conditions`,
      }];
    }
  }

  return [{
    path,
    operator: 'some',
    expected: conditions,
    actual: `none of ${actual.length} items matched`,
    passed: false,
    message: `${path}: 'some' failed — none of the ${actual.length} items satisfy all conditions`,
  }];
}

/**
 * Negation wrapper — inverts assertion results.
 *
 * @example
 * ```yaml
 * status:
 *   not:
 *     in: [500, 502, 503]
 *
 * name:
 *   not: "forbidden_value"
 * ```
 */
function assertNot(
  actual: unknown,
  expected: unknown,
  path: string,
): AssertionResult[] {
  const innerResults = evaluateAssertion(actual, expected, path);

  return innerResults.map(r => ({
    ...r,
    operator: `not(${r.operator})`,
    passed: !r.passed,
    message: !r.passed
      ? r.message
      : `NOT: expected ${path} to NOT satisfy: ${r.message}`,
  }));
}

// =====================================================================
// Utility Helpers
// =====================================================================

/**
 * Get a nested value from an object by key.
 * Supports simple keys only (not dot-separated paths).
 */
function getNestedValue(obj: unknown, key: string): unknown {
  if (obj === null || obj === undefined || typeof obj !== 'object') {
    return undefined;
  }
  return (obj as Record<string, unknown>)[key];
}

/**
 * Deep equality check for assertion comparison.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }

  if (typeof a === 'object' && typeof b === 'object') {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const aKeys = Object.keys(aObj);
    const bKeys = Object.keys(bObj);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) => deepEqual(aObj[key], bObj[key]));
  }

  return false;
}
