/**
 * Unit tests for openapi/request-validator module.
 */

import { describe, it, expect } from 'vitest';
import { compileValidators } from '../../../src/openapi/request-validator.js';
import type { DereferencedSpec, OpenAPIRoute, OpenAPIResponseDef } from '../../../src/openapi/types.js';

function makeRoute(overrides: Partial<OpenAPIRoute> = {}): OpenAPIRoute {
  const responses = new Map<number, OpenAPIResponseDef>();
  responses.set(200, {
    statusCode: 200,
    description: 'OK',
    contentType: 'application/json',
  });
  return {
    method: 'POST',
    openApiPath: '/items',
    fastifyPath: '/items',
    defaultStatus: 200,
    responses,
    pathParams: [],
    queryParams: [],
    headerParams: [],
    ...overrides,
  };
}

function makeSpec(routes: OpenAPIRoute[]): DereferencedSpec {
  return {
    specPath: '/test/spec.yaml',
    openApiVersion: '3.0.3',
    title: 'Test',
    document: {},
    routes,
    parsedAt: Date.now(),
  };
}

describe('request-validator', () => {
  describe('body validation', () => {
    it('should reject body type mismatch', () => {
      const route = makeRoute({
        requestBody: {
          required: true,
          schema: {
            type: 'object',
            properties: {
              amount: { type: 'integer' },
              currency: { type: 'string' },
            },
            required: ['amount'],
          },
          contentType: 'application/json',
        },
      });
      const validators = compileValidators(makeSpec([route]));
      const result = validators.validate('POST', '/items', {
        body: { amount: 'not-a-number', currency: 'USD' },
      });
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]!.location).toBe('body');
    });

    it('should reject missing required field', () => {
      const route = makeRoute({
        requestBody: {
          required: true,
          schema: {
            type: 'object',
            properties: {
              amount: { type: 'integer' },
            },
            required: ['amount'],
          },
          contentType: 'application/json',
        },
      });
      const validators = compileValidators(makeSpec([route]));
      const result = validators.validate('POST', '/items', {
        body: {},
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('required'))).toBe(true);
    });

    it('should pass valid request body', () => {
      const route = makeRoute({
        requestBody: {
          required: true,
          schema: {
            type: 'object',
            properties: {
              amount: { type: 'integer' },
            },
          },
          contentType: 'application/json',
        },
      });
      const validators = compileValidators(makeSpec([route]));
      const result = validators.validate('POST', '/items', {
        body: { amount: 100 },
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('unknown endpoint', () => {
    it('should reject unknown endpoint', () => {
      const route = makeRoute();
      const validators = compileValidators(makeSpec([route]));
      const result = validators.validate('GET', '/unknown', {});
      expect(result.valid).toBe(false);
      expect(result.errors[0]!.message).toContain('Unknown endpoint');
    });
  });

  describe('query parameter validation', () => {
    it('should validate query parameter types', () => {
      const route = makeRoute({
        method: 'GET',
        queryParams: [
          { name: 'limit', required: false, schema: { type: 'integer' } },
        ],
      });
      const validators = compileValidators(makeSpec([route]));
      const result = validators.validate('GET', '/items', {
        query: { limit: 'abc' },
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]!.location).toBe('query');
    });
  });

  describe('validation disabled', () => {
    it('should return valid when no validators match (no body schema)', () => {
      const route = makeRoute();
      const validators = compileValidators(makeSpec([route]));
      const result = validators.validate('POST', '/items', {
        body: { anything: 'goes' },
      });
      expect(result.valid).toBe(true);
    });
  });

  describe('path matching', () => {
    it('should match parameterized paths', () => {
      const route = makeRoute({
        method: 'GET',
        openApiPath: '/items/{id}',
        fastifyPath: '/items/:id',
        pathParams: [{ name: 'id', required: true, schema: { type: 'integer' } }],
      });
      const validators = compileValidators(makeSpec([route]));
      const result = validators.validate('GET', '/items/42', { params: { id: '42' } });
      expect(result.valid).toBe(true);
    });
  });
});
