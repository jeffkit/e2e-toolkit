/**
 * Unit tests for variable-resolver module.
 *
 * Tests cover:
 * - Built-in variable types (timestamp, uuid, date)
 * - Environment variable substitution ({{env.XXX}})
 * - Config variable substitution ({{config.xxx}})
 * - Runtime variable substitution
 * - Nested object recursive resolution
 * - Undefined variable preservation
 * - createVariableContext helper
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  resolveVariables,
  resolveObjectVariables,
  createVariableContext,
} from '../../src/variable-resolver.js';
import type { VariableContext, E2EConfig } from '../../src/types.js';

/** Create a basic variable context for testing */
function makeContext(overrides?: Partial<VariableContext>): VariableContext {
  return {
    config: {},
    runtime: {},
    env: {},
    ...overrides,
  };
}

describe('variable-resolver', () => {
  describe('resolveVariables', () => {
    describe('built-in variables', () => {
      it('should resolve {{timestamp}} to a numeric string', () => {
        const ctx = makeContext();
        const result = resolveVariables('ts-{{timestamp}}', ctx);
        const ts = result.replace('ts-', '');
        expect(Number(ts)).toBeGreaterThan(0);
        expect(Number(ts)).toBeLessThanOrEqual(Date.now());
      });

      it('should resolve {{uuid}} to a valid UUID v4', () => {
        const ctx = makeContext();
        const result = resolveVariables('{{uuid}}', ctx);
        expect(result).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        );
      });

      it('should resolve {{date}} to YYYY-MM-DD format', () => {
        const ctx = makeContext();
        const result = resolveVariables('{{date}}', ctx);
        expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      });

      it('should resolve multiple built-in variables in one string', () => {
        const ctx = makeContext();
        const result = resolveVariables('{{date}}-{{timestamp}}', ctx);
        const parts = result.split('-');
        // date part: YYYY-MM-DD = 3 parts, then timestamp
        expect(parts.length).toBeGreaterThanOrEqual(4);
      });
    });

    describe('environment variables', () => {
      it('should resolve {{env.XXX}} from context', () => {
        const ctx = makeContext({ env: { MY_VAR: 'hello' } });
        const result = resolveVariables('{{env.MY_VAR}}', ctx);
        expect(result).toBe('hello');
      });

      it('should preserve {{env.XXX}} when variable is not defined', () => {
        const ctx = makeContext({ env: {} });
        const result = resolveVariables('{{env.MISSING_VAR}}', ctx);
        expect(result).toBe('{{env.MISSING_VAR}}');
      });

      it('should handle empty env value', () => {
        const ctx = makeContext({ env: { EMPTY: '' } });
        const result = resolveVariables('{{env.EMPTY}}', ctx);
        expect(result).toBe('');
      });
    });

    describe('config variables', () => {
      it('should resolve {{config.xxx}} from context', () => {
        const ctx = makeContext({ config: { version: '2.0.0' } });
        const result = resolveVariables('app:{{config.version}}', ctx);
        expect(result).toBe('app:2.0.0');
      });

      it('should preserve {{config.xxx}} when not defined', () => {
        const ctx = makeContext({ config: {} });
        const result = resolveVariables('{{config.missing}}', ctx);
        expect(result).toBe('{{config.missing}}');
      });
    });

    describe('runtime variables', () => {
      it('should resolve {{xxx}} from runtime context', () => {
        const ctx = makeContext({ runtime: { userId: '42' } });
        const result = resolveVariables('/users/{{userId}}', ctx);
        expect(result).toBe('/users/42');
      });

      it('should preserve {{xxx}} when runtime variable is not defined', () => {
        const ctx = makeContext({ runtime: {} });
        const result = resolveVariables('{{unknown_var}}', ctx);
        expect(result).toBe('{{unknown_var}}');
      });
    });

    describe('mixed variables', () => {
      it('should resolve a mix of different variable types', () => {
        const ctx = makeContext({
          config: { base: 'http://localhost:3000' },
          runtime: { token: 'abc123' },
          env: { NODE_ENV: 'test' },
        });
        const template = '{{config.base}}/api?token={{token}}&env={{env.NODE_ENV}}';
        const result = resolveVariables(template, ctx);
        expect(result).toBe('http://localhost:3000/api?token=abc123&env=test');
      });
    });

    describe('edge cases', () => {
      it('should return string as-is when no templates present', () => {
        const ctx = makeContext();
        const result = resolveVariables('no templates here', ctx);
        expect(result).toBe('no templates here');
      });

      it('should handle empty string', () => {
        const ctx = makeContext();
        const result = resolveVariables('', ctx);
        expect(result).toBe('');
      });

      it('should handle spaces inside template braces', () => {
        const ctx = makeContext({ runtime: { foo: 'bar' } });
        const result = resolveVariables('{{ foo }}', ctx);
        expect(result).toBe('bar');
      });
    });
  });

  describe('resolveObjectVariables', () => {
    it('should resolve strings in a flat object', () => {
      const ctx = makeContext({ runtime: { name: 'Alice' } });
      const result = resolveObjectVariables(
        { greeting: 'Hello, {{name}}!' },
        ctx,
      );
      expect(result).toEqual({ greeting: 'Hello, Alice!' });
    });

    it('should resolve strings in nested objects', () => {
      const ctx = makeContext({
        config: { host: 'localhost' },
        runtime: { port: '3000' },
      });
      const input = {
        server: {
          url: 'http://{{config.host}}:{{port}}',
          nested: {
            deep: '{{config.host}}',
          },
        },
      };
      const result = resolveObjectVariables(input, ctx) as Record<string, unknown>;
      const server = result['server'] as Record<string, unknown>;
      expect(server['url']).toBe('http://localhost:3000');
      const nested = server['nested'] as Record<string, unknown>;
      expect(nested['deep']).toBe('localhost');
    });

    it('should resolve strings in arrays', () => {
      const ctx = makeContext({ runtime: { a: '1', b: '2' } });
      const result = resolveObjectVariables(['{{a}}', '{{b}}', 'literal'], ctx);
      expect(result).toEqual(['1', '2', 'literal']);
    });

    it('should preserve non-string primitives', () => {
      const ctx = makeContext();
      const input = {
        num: 42,
        bool: true,
        nil: null,
        str: 'keep',
      };
      const result = resolveObjectVariables(input, ctx);
      expect(result).toEqual(input);
    });

    it('should handle mixed arrays with objects', () => {
      const ctx = makeContext({ runtime: { x: 'resolved' } });
      const input = [
        { key: '{{x}}' },
        'literal',
        42,
        [{ nested: '{{x}}' }],
      ];
      const result = resolveObjectVariables(input, ctx) as unknown[];
      const first = result[0] as Record<string, unknown>;
      expect(first['key']).toBe('resolved');
      expect(result[1]).toBe('literal');
      expect(result[2]).toBe(42);
      const nested = result[3] as unknown[];
      const nestedObj = nested[0] as Record<string, unknown>;
      expect(nestedObj['nested']).toBe('resolved');
    });

    it('should return primitive values as-is', () => {
      const ctx = makeContext();
      expect(resolveObjectVariables(42, ctx)).toBe(42);
      expect(resolveObjectVariables(true, ctx)).toBe(true);
      expect(resolveObjectVariables(null, ctx)).toBeNull();
      expect(resolveObjectVariables(undefined, ctx)).toBeUndefined();
    });
  });

  describe('createVariableContext', () => {
    it('should create context from config with vars', () => {
      const config = {
        version: '1',
        project: { name: 'test' },
        service: {
          build: { dockerfile: 'Dockerfile', context: '.', image: 'test' },
          container: { name: 'test', ports: ['8080:3000'] },
          vars: { key1: 'value1', key2: 'value2' },
        },
      } as E2EConfig;

      const ctx = createVariableContext(config);
      expect(ctx.config).toEqual({ key1: 'value1', key2: 'value2' });
      expect(ctx.runtime).toEqual({});
      expect(typeof ctx.env).toBe('object');
    });

    it('should create context from config without vars', () => {
      const config = {
        version: '1',
        project: { name: 'test' },
        service: {
          build: { dockerfile: 'Dockerfile', context: '.', image: 'test' },
          container: { name: 'test', ports: ['8080:3000'] },
        },
      } as E2EConfig;

      const ctx = createVariableContext(config);
      expect(ctx.config).toEqual({});
      expect(ctx.runtime).toEqual({});
    });

    it('should capture process.env in context', () => {
      const originalEnv = process.env['NODE_ENV'];
      process.env['NODE_ENV'] = 'test';

      const config = {
        version: '1',
        project: { name: 'test' },
        service: {
          build: { dockerfile: 'Dockerfile', context: '.', image: 'test' },
          container: { name: 'test', ports: ['8080:3000'] },
        },
      } as E2EConfig;

      const ctx = createVariableContext(config);
      expect(ctx.env['NODE_ENV']).toBe('test');

      // Restore
      if (originalEnv !== undefined) {
        process.env['NODE_ENV'] = originalEnv;
      } else {
        delete process.env['NODE_ENV'];
      }
    });
  });
});
