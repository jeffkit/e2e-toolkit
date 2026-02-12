/**
 * Unit tests for assertion-engine module.
 *
 * Tests cover:
 * - All assertion operators (exact, type, exists, in, gt/gte/lt/lte,
 *   contains, matches, startsWith, length)
 * - Nested object assertions
 * - Error message formatting
 * - Edge cases (null, undefined, empty arrays)
 */

import { describe, it, expect } from 'vitest';
import {
  assertBody,
  assertStatus,
  assertHeaders,
} from '../../src/assertion-engine.js';

describe('assertion-engine', () => {
  // ===================================================================
  // assertStatus
  // ===================================================================

  describe('assertStatus', () => {
    it('should pass on exact status match', () => {
      const result = assertStatus(200, 200);
      expect(result.passed).toBe(true);
      expect(result.operator).toBe('exact');
    });

    it('should fail on status mismatch', () => {
      const result = assertStatus(404, 200);
      expect(result.passed).toBe(false);
      expect(result.message).toContain('Expected status 200');
      expect(result.message).toContain('got 404');
    });

    it('should pass when status is in allowed array', () => {
      const result = assertStatus(201, [200, 201, 204]);
      expect(result.passed).toBe(true);
      expect(result.operator).toBe('in');
    });

    it('should fail when status is not in allowed array', () => {
      const result = assertStatus(500, [200, 201]);
      expect(result.passed).toBe(false);
      expect(result.message).toContain('one of');
    });
  });

  // ===================================================================
  // assertHeaders
  // ===================================================================

  describe('assertHeaders', () => {
    it('should match header values exactly', () => {
      const results = assertHeaders(
        { 'content-type': 'application/json' },
        { 'Content-Type': 'application/json' },
      );
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(true);
    });

    it('should support operator assertions on headers', () => {
      const results = assertHeaders(
        { 'content-type': 'application/json; charset=utf-8' },
        { 'content-type': { contains: 'application/json' } },
      );
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(true);
    });

    it('should fail on header mismatch', () => {
      const results = assertHeaders(
        { 'content-type': 'text/html' },
        { 'content-type': 'application/json' },
      );
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(false);
    });
  });

  // ===================================================================
  // assertBody — Exact Match
  // ===================================================================

  describe('assertBody — exact match', () => {
    it('should match string values exactly', () => {
      const results = assertBody({ status: 'ok' }, { status: 'ok' });
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(true);
    });

    it('should match number values exactly', () => {
      const results = assertBody({ count: 5 }, { count: 5 });
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(true);
    });

    it('should match boolean values exactly', () => {
      const results = assertBody({ active: true }, { active: true });
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(true);
    });

    it('should match null values exactly', () => {
      const results = assertBody({ name: null }, { name: null });
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(true);
    });

    it('should fail on string mismatch', () => {
      const results = assertBody({ status: 'error' }, { status: 'ok' });
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(false);
      expect(results[0]!.message).toContain('Expected');
    });

    it('should fail when actual is undefined but expected is a value', () => {
      const results = assertBody({}, { missing: 'value' });
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(false);
    });
  });

  // ===================================================================
  // assertBody — Type Check
  // ===================================================================

  describe('assertBody — type check', () => {
    it('should check boolean type', () => {
      const results = assertBody({ active: true }, { active: { type: 'boolean' } });
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(true);
      expect(results[0]!.operator).toBe('type');
    });

    it('should check number type', () => {
      const results = assertBody({ count: 42 }, { count: { type: 'number' } });
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(true);
    });

    it('should check string type', () => {
      const results = assertBody({ name: 'Alice' }, { name: { type: 'string' } });
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(true);
    });

    it('should check array type', () => {
      const results = assertBody({ items: [1, 2, 3] }, { items: { type: 'array' } });
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(true);
    });

    it('should check object type', () => {
      const results = assertBody({ data: { id: 1 } }, { data: { type: 'object' } });
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(true);
    });

    it('should fail type check on mismatch', () => {
      const results = assertBody({ value: 'hello' }, { value: { type: 'number' } });
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(false);
      expect(results[0]!.message).toContain('type');
    });

    it('should report null as null type', () => {
      const results = assertBody({ val: null }, { val: { type: 'null' } });
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(true);
    });
  });

  // ===================================================================
  // assertBody — Exists
  // ===================================================================

  describe('assertBody — exists', () => {
    it('should pass when field exists and exists: true', () => {
      const results = assertBody({ id: 'abc' }, { id: { exists: true } });
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(true);
    });

    it('should fail when field is undefined and exists: true', () => {
      const results = assertBody({}, { id: { exists: true } });
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(false);
    });

    it('should fail when field is null and exists: true', () => {
      const results = assertBody({ id: null }, { id: { exists: true } });
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(false);
    });

    it('should pass when field is undefined and exists: false', () => {
      const results = assertBody({}, { deleted: { exists: false } });
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(true);
    });

    it('should fail when field exists and exists: false', () => {
      const results = assertBody({ deleted: true }, { deleted: { exists: false } });
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(false);
    });
  });

  // ===================================================================
  // assertBody — In (set inclusion)
  // ===================================================================

  describe('assertBody — in', () => {
    it('should pass when value is in the set', () => {
      const results = assertBody({ status: 'active' }, { status: { in: ['active', 'pending'] } });
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(true);
    });

    it('should fail when value is not in the set', () => {
      const results = assertBody({ status: 'deleted' }, { status: { in: ['active', 'pending'] } });
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(false);
    });
  });

  // ===================================================================
  // assertBody — Numeric Comparisons
  // ===================================================================

  describe('assertBody — numeric comparisons', () => {
    it('should pass gt comparison', () => {
      const results = assertBody({ count: 10 }, { count: { gt: 5 } });
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(true);
    });

    it('should fail gt comparison when equal', () => {
      const results = assertBody({ count: 5 }, { count: { gt: 5 } });
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(false);
    });

    it('should pass gte comparison when equal', () => {
      const results = assertBody({ count: 5 }, { count: { gte: 5 } });
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(true);
    });

    it('should pass lt comparison', () => {
      const results = assertBody({ count: 3 }, { count: { lt: 5 } });
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(true);
    });

    it('should fail lt comparison when equal', () => {
      const results = assertBody({ count: 5 }, { count: { lt: 5 } });
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(false);
    });

    it('should pass lte comparison when equal', () => {
      const results = assertBody({ count: 5 }, { count: { lte: 5 } });
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(true);
    });

    it('should fail comparison on non-numeric actual', () => {
      const results = assertBody({ count: 'not-a-number' }, { count: { gt: 0 } });
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(false);
      expect(results[0]!.message).toContain('number');
    });

    it('should support combined comparisons (range)', () => {
      const results = assertBody({ score: 75 }, { score: { gte: 0, lte: 100 } });
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.passed)).toBe(true);
    });
  });

  // ===================================================================
  // assertBody — Contains
  // ===================================================================

  describe('assertBody — contains', () => {
    it('should check string contains', () => {
      const results = assertBody(
        { message: 'Hello, World!' },
        { message: { contains: 'World' } },
      );
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(true);
    });

    it('should fail string contains on no match', () => {
      const results = assertBody(
        { message: 'Hello' },
        { message: { contains: 'World' } },
      );
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(false);
    });

    it('should check array contains', () => {
      const results = assertBody(
        { tags: ['a', 'b', 'c'] },
        { tags: { contains: 'b' } },
      );
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(true);
    });

    it('should fail array contains on no match', () => {
      const results = assertBody(
        { tags: ['a', 'b'] },
        { tags: { contains: 'x' } },
      );
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(false);
    });
  });

  // ===================================================================
  // assertBody — Matches (regex)
  // ===================================================================

  describe('assertBody — matches', () => {
    it('should pass regex match', () => {
      const results = assertBody(
        { email: 'test@example.com' },
        { email: { matches: '^[^@]+@[^@]+\\.[^@]+$' } },
      );
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(true);
    });

    it('should fail regex match', () => {
      const results = assertBody(
        { email: 'not-an-email' },
        { email: { matches: '^[^@]+@[^@]+$' } },
      );
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(false);
    });

    it('should fail on non-string value', () => {
      const results = assertBody(
        { value: 42 },
        { value: { matches: '\\d+' } },
      );
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(false);
    });
  });

  // ===================================================================
  // assertBody — StartsWith
  // ===================================================================

  describe('assertBody — startsWith', () => {
    it('should pass startsWith check', () => {
      const results = assertBody(
        { msg: 'Error: something failed' },
        { msg: { startsWith: 'Error' } },
      );
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(true);
    });

    it('should fail startsWith check', () => {
      const results = assertBody(
        { msg: 'Warning: something' },
        { msg: { startsWith: 'Error' } },
      );
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(false);
    });

    it('should fail on non-string value', () => {
      const results = assertBody(
        { msg: 123 },
        { msg: { startsWith: '1' } },
      );
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(false);
    });
  });

  // ===================================================================
  // assertBody — Length
  // ===================================================================

  describe('assertBody — length', () => {
    it('should check exact array length', () => {
      const results = assertBody(
        { items: [1, 2, 3] },
        { items: { length: 3 } },
      );
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(true);
    });

    it('should fail exact array length mismatch', () => {
      const results = assertBody(
        { items: [1, 2] },
        { items: { length: 3 } },
      );
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(false);
    });

    it('should check string length', () => {
      const results = assertBody(
        { name: 'Alice' },
        { name: { length: 5 } },
      );
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(true);
    });

    it('should support length with gt operator', () => {
      const results = assertBody(
        { items: [1, 2, 3] },
        { items: { length: { gt: 0 } } },
      );
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(true);
    });

    it('should support length with lte operator', () => {
      const results = assertBody(
        { items: [1, 2] },
        { items: { length: { lte: 5 } } },
      );
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(true);
    });

    it('should fail length on non-lengthable value', () => {
      const results = assertBody(
        { value: 42 },
        { value: { length: 2 } },
      );
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(false);
    });

    it('should check empty array length', () => {
      const results = assertBody(
        { items: [] },
        { items: { length: 0 } },
      );
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(true);
    });
  });

  // ===================================================================
  // assertBody — Nested Object Assertions
  // ===================================================================

  describe('assertBody — nested objects', () => {
    it('should recursively assert nested objects', () => {
      const actual = {
        data: {
          user: {
            name: 'Alice',
            age: 30,
          },
        },
      };
      const expected = {
        data: {
          user: {
            name: 'Alice',
            age: { gte: 18 },
          },
        },
      };
      const results = assertBody(actual, expected);
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.passed)).toBe(true);
    });

    it('should report correct path for nested failures', () => {
      const actual = {
        data: {
          user: {
            name: 'Bob',
          },
        },
      };
      const expected = {
        data: {
          user: {
            name: 'Alice',
          },
        },
      };
      const results = assertBody(actual, expected);
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(false);
      expect(results[0]!.path).toBe('body.data.user.name');
    });

    it('should fail when expected object but actual is not an object', () => {
      const results = assertBody(
        { data: 'not-an-object' },
        { data: { nested: { key: 'value' } } },
      );
      expect(results.some((r) => !r.passed)).toBe(true);
    });

    it('should handle deeply nested assertions', () => {
      const actual = {
        level1: {
          level2: {
            level3: {
              value: 'deep',
            },
          },
        },
      };
      const expected = {
        level1: {
          level2: {
            level3: {
              value: 'deep',
            },
          },
        },
      };
      const results = assertBody(actual, expected);
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(true);
      expect(results[0]!.path).toBe('body.level1.level2.level3.value');
    });
  });

  // ===================================================================
  // assertBody — Combined Operators
  // ===================================================================

  describe('assertBody — combined operators', () => {
    it('should support multiple operators on same field', () => {
      const results = assertBody(
        { name: 'Alice' },
        { name: { type: 'string', startsWith: 'A', length: 5 } },
      );
      expect(results).toHaveLength(3);
      expect(results.every((r) => r.passed)).toBe(true);
    });
  });

  // ===================================================================
  // Edge Cases
  // ===================================================================

  describe('edge cases', () => {
    it('should handle null actual body', () => {
      const results = assertBody(null, { field: 'value' });
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(false);
    });

    it('should handle undefined actual body', () => {
      const results = assertBody(undefined, { field: 'value' });
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(false);
    });

    it('should handle empty expected object', () => {
      const results = assertBody({ foo: 'bar' }, {});
      expect(results).toHaveLength(0);
    });

    it('should handle empty actual object', () => {
      const results = assertBody({}, { field: { exists: false } });
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(true);
    });

    it('should handle nested null values', () => {
      const results = assertBody(
        { data: null },
        { data: { exists: true } },
      );
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(false);
    });

    it('should produce clear error messages', () => {
      const results = assertBody(
        { count: -1 },
        { count: { gt: 0 } },
      );
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(false);
      expect(results[0]!.message).toContain('Expected');
      expect(results[0]!.message).toContain('>');
      expect(results[0]!.message).toContain('0');
      expect(results[0]!.message).toContain('-1');
    });

    it('should handle custom basePath', () => {
      const results = assertBody(
        { key: 'val' },
        { key: 'val' },
        'response',
      );
      expect(results).toHaveLength(1);
      expect(results[0]!.path).toBe('response.key');
    });
  });
});
