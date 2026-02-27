/**
 * Unit tests for openapi/response-generator module.
 */

import { describe, it, expect } from 'vitest';
import { generateResponseBody } from '../../../src/openapi/response-generator.js';
import type { JSONSchema } from '../../../src/openapi/types.js';

describe('response-generator', () => {
  const opts = { maxDepth: 3 };

  describe('example values', () => {
    it('should use example when present', () => {
      const schema: JSONSchema = { type: 'string', example: 'hello world' };
      expect(generateResponseBody(schema, opts)).toBe('hello world');
    });

    it('should use example for complex types', () => {
      const schema: JSONSchema = {
        type: 'object',
        example: { id: 1, name: 'Test' },
      };
      expect(generateResponseBody(schema, opts)).toEqual({ id: 1, name: 'Test' });
    });
  });

  describe('string generation', () => {
    it('should return "string" for plain strings', () => {
      expect(generateResponseBody({ type: 'string' }, opts)).toBe('string');
    });

    it('should return format-aware value for email', () => {
      expect(generateResponseBody({ type: 'string', format: 'email' }, opts)).toBe('user@example.com');
    });

    it('should return format-aware value for date', () => {
      expect(generateResponseBody({ type: 'string', format: 'date' }, opts)).toBe('2026-01-01');
    });

    it('should return format-aware value for date-time', () => {
      expect(generateResponseBody({ type: 'string', format: 'date-time' }, opts)).toBe('2026-01-01T00:00:00Z');
    });

    it('should return format-aware value for uuid', () => {
      expect(generateResponseBody({ type: 'string', format: 'uuid' }, opts))
        .toBe('00000000-0000-0000-0000-000000000000');
    });

    it('should return format-aware value for uri', () => {
      expect(generateResponseBody({ type: 'string', format: 'uri' }, opts)).toBe('https://example.com');
    });
  });

  describe('numeric types', () => {
    it('should return 0 for integer', () => {
      expect(generateResponseBody({ type: 'integer' }, opts)).toBe(0);
    });

    it('should return 0.0 for number', () => {
      expect(generateResponseBody({ type: 'number' }, opts)).toBe(0.0);
    });

    it('should respect minimum for integer', () => {
      expect(generateResponseBody({ type: 'integer', minimum: 5 }, opts)).toBe(5);
    });

    it('should respect minimum for number', () => {
      expect(generateResponseBody({ type: 'number', minimum: 1.5 }, opts)).toBe(1.5);
    });
  });

  describe('boolean', () => {
    it('should return true for boolean', () => {
      expect(generateResponseBody({ type: 'boolean' }, opts)).toBe(true);
    });
  });

  describe('array generation', () => {
    it('should generate single-element array', () => {
      const schema: JSONSchema = {
        type: 'array',
        items: { type: 'string' },
      };
      expect(generateResponseBody(schema, opts)).toEqual(['string']);
    });

    it('should generate empty array when no items schema', () => {
      expect(generateResponseBody({ type: 'array' }, opts)).toEqual([]);
    });

    it('should generate nested object in array', () => {
      const schema: JSONSchema = {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            name: { type: 'string' },
          },
        },
      };
      expect(generateResponseBody(schema, opts)).toEqual([{ id: 0, name: 'string' }]);
    });
  });

  describe('object generation', () => {
    it('should generate all properties', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          name: { type: 'string' },
          active: { type: 'boolean' },
        },
      };
      expect(generateResponseBody(schema, opts)).toEqual({
        id: 0,
        name: 'string',
        active: true,
      });
    });

    it('should generate nested objects', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          user: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              email: { type: 'string', format: 'email' },
            },
          },
        },
      };
      expect(generateResponseBody(schema, opts)).toEqual({
        user: { name: 'string', email: 'user@example.com' },
      });
    });

    it('should return empty object when no properties', () => {
      expect(generateResponseBody({ type: 'object' }, opts)).toEqual({});
    });

    it('should handle schemas with properties but no explicit type', () => {
      const schema: JSONSchema = {
        properties: {
          id: { type: 'integer' },
        },
      };
      expect(generateResponseBody(schema, opts)).toEqual({ id: 0 });
    });
  });

  describe('enum handling', () => {
    it('should return first enum value', () => {
      const schema: JSONSchema = { type: 'string', enum: ['active', 'inactive', 'pending'] };
      expect(generateResponseBody(schema, opts)).toBe('active');
    });

    it('should handle empty enum', () => {
      expect(generateResponseBody({ enum: [] }, opts)).toBe(null);
    });
  });

  describe('composition (oneOf, anyOf, allOf)', () => {
    it('should use first variant of oneOf', () => {
      const schema: JSONSchema = {
        oneOf: [
          { type: 'string' },
          { type: 'integer' },
        ],
      };
      expect(generateResponseBody(schema, opts)).toBe('string');
    });

    it('should use first variant of anyOf', () => {
      const schema: JSONSchema = {
        anyOf: [
          { type: 'integer' },
          { type: 'string' },
        ],
      };
      expect(generateResponseBody(schema, opts)).toBe(0);
    });

    it('should merge allOf schemas', () => {
      const schema: JSONSchema = {
        allOf: [
          { type: 'object', properties: { id: { type: 'integer' } } },
          { type: 'object', properties: { name: { type: 'string' } } },
        ],
      };
      expect(generateResponseBody(schema, opts)).toEqual({ id: 0, name: 'string' });
    });
  });

  describe('maxDepth enforcement', () => {
    it('should return null when maxDepth is reached', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          child: {
            type: 'object',
            properties: {
              grandchild: { type: 'string' },
            },
          },
        },
      };
      const result = generateResponseBody(schema, { maxDepth: 1 });
      expect(result).toEqual({ child: null });
    });

    it('should return null immediately at depth 0', () => {
      expect(generateResponseBody({ type: 'string' }, { maxDepth: 0 })).toBe(null);
    });
  });

  describe('null type', () => {
    it('should return null for null type', () => {
      expect(generateResponseBody({ type: 'null' }, opts)).toBe(null);
    });
  });
});
