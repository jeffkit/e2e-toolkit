/**
 * Unit tests for mock-generator module.
 *
 * Tests cover:
 * - Mock route registration (GET, POST, etc.)
 * - /_mock/* helper endpoints
 * - Template variable substitution
 * - Conditional matching (when clause)
 * - Response delay handling
 *
 * All tests use Fastify's inject() method — no real network needed.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createMockServer, resolveResponseTemplate } from '../../src/mock-generator.js';
import type { MockServiceConfig } from '../../src/types.js';

describe('mock-generator', () => {
  // ── createMockServer ────────────────────────────────────────────────

  describe('createMockServer', () => {
    let app: FastifyInstance;

    beforeEach(async () => {
      const config: MockServiceConfig = {
        port: 9090,
        routes: [
          {
            method: 'GET',
            path: '/api/status',
            response: { status: 200, body: { status: 'ok' } },
          },
          {
            method: 'POST',
            path: '/api/echo',
            response: {
              status: 201,
              headers: { 'x-custom': 'test' },
              body: { received: '{{request.body.message}}' },
            },
          },
          {
            method: 'GET',
            path: '/api/items/:id',
            response: {
              status: 200,
              body: { id: '{{request.params.id}}', q: '{{request.query.filter}}' },
            },
          },
        ],
      };
      app = createMockServer(config);
      await app.ready();
    });

    it('should respond to a configured GET route', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/status' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: 'ok' });
    });

    it('should respond to a configured POST route with template resolution', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/echo',
        payload: { message: 'hello' },
      });
      expect(res.statusCode).toBe(201);
      expect(res.headers['x-custom']).toBe('test');
      expect(res.json()).toEqual({ received: 'hello' });
    });

    it('should resolve route params and query params in templates', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/items/42?filter=active',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { id: string; q: string };
      expect(body.id).toBe('42');
      expect(body.q).toBe('active');
    });

    it('should handle missing template variables gracefully', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/items/99',
      });
      const body = res.json() as { id: string; q: string };
      expect(body.id).toBe('99');
      // Missing query param resolves to empty string
      expect(body.q).toBe('');
    });
  });

  // ── Helper endpoints ─────────────────────────────────────────────────

  describe('/_mock/* helper endpoints', () => {
    let app: FastifyInstance;

    beforeEach(async () => {
      const config: MockServiceConfig = {
        port: 9090,
        routes: [
          {
            method: 'GET',
            path: '/api/data',
            response: { status: 200, body: { ok: true } },
          },
        ],
      };
      app = createMockServer(config);
      await app.ready();
    });

    it('GET /_mock/health should return status and route count', async () => {
      const res = await app.inject({ method: 'GET', url: '/_mock/health' });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { status: string; uptime: number; routeCount: number };
      expect(body.status).toBe('ok');
      expect(typeof body.uptime).toBe('number');
      expect(body.routeCount).toBe(1);
    });

    it('GET /_mock/requests should return recorded requests', async () => {
      // Make a request that should be recorded
      await app.inject({ method: 'GET', url: '/api/data' });

      const res = await app.inject({ method: 'GET', url: '/_mock/requests' });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { count: number; requests: Array<{ method: string; url: string }> };
      expect(body.count).toBe(1);
      expect(body.requests[0]!.method).toBe('GET');
      expect(body.requests[0]!.url).toBe('/api/data');
    });

    it('GET /_mock/requests should NOT include /_mock/* requests', async () => {
      await app.inject({ method: 'GET', url: '/_mock/health' });
      const res = await app.inject({ method: 'GET', url: '/_mock/requests' });
      const body = res.json() as { count: number };
      // /_mock requests should not be recorded
      expect(body.count).toBe(0);
    });

    it('DELETE /_mock/requests should clear the request log', async () => {
      await app.inject({ method: 'GET', url: '/api/data' });
      await app.inject({ method: 'GET', url: '/api/data' });

      const delRes = await app.inject({ method: 'DELETE', url: '/_mock/requests' });
      expect(delRes.statusCode).toBe(200);
      expect(delRes.json()).toEqual({ message: 'cleared' });

      const getRes = await app.inject({ method: 'GET', url: '/_mock/requests' });
      const body = getRes.json() as { count: number };
      expect(body.count).toBe(0);
    });

    it('GET /_mock/routes should return configured routes', async () => {
      const res = await app.inject({ method: 'GET', url: '/_mock/routes' });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { routes: Array<{ method: string; path: string }> };
      expect(body.routes).toHaveLength(1);
      expect(body.routes[0]!.method).toBe('GET');
      expect(body.routes[0]!.path).toBe('/api/data');
    });
  });

  // ── Empty config ──────────────────────────────────────────────────────

  describe('empty config', () => {
    it('should create a server with no routes', async () => {
      const app = createMockServer({ port: 9090 });
      await app.ready();

      const res = await app.inject({ method: 'GET', url: '/_mock/health' });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { routeCount: number };
      expect(body.routeCount).toBe(0);
    });
  });

  // ── Conditional matching (when clause) ──────────────────────────────

  describe('conditional matching', () => {
    it('should match routes by request body condition', async () => {
      const config: MockServiceConfig = {
        port: 9090,
        routes: [
          {
            method: 'POST',
            path: '/api/action',
            response: { status: 200, body: { result: 'default' } },
          },
          {
            method: 'POST',
            path: '/api/action',
            response: { status: 200, body: { result: 'special' } },
            when: { body: { type: 'special' } },
          },
        ],
      };
      const app = createMockServer(config);
      await app.ready();

      const defaultRes = await app.inject({
        method: 'POST',
        url: '/api/action',
        payload: { type: 'normal' },
      });
      expect(defaultRes.json()).toEqual({ result: 'default' });

      const specialRes = await app.inject({
        method: 'POST',
        url: '/api/action',
        payload: { type: 'special' },
      });
      expect(specialRes.json()).toEqual({ result: 'special' });
    });

    it('should match routes by query condition', async () => {
      const config: MockServiceConfig = {
        port: 9090,
        routes: [
          {
            method: 'GET',
            path: '/api/search',
            response: { status: 200, body: { mode: 'default' } },
          },
          {
            method: 'GET',
            path: '/api/search',
            response: { status: 200, body: { mode: 'fast' } },
            when: { query: { mode: 'fast' } },
          },
        ],
      };
      const app = createMockServer(config);
      await app.ready();

      const fastRes = await app.inject({
        method: 'GET',
        url: '/api/search?mode=fast',
      });
      expect(fastRes.json()).toEqual({ mode: 'fast' });

      const defaultRes = await app.inject({
        method: 'GET',
        url: '/api/search',
      });
      expect(defaultRes.json()).toEqual({ mode: 'default' });
    });
  });

  // ── Response delay ────────────────────────────────────────────────────

  describe('response delay', () => {
    it('should respect a delay setting', async () => {
      const config: MockServiceConfig = {
        port: 9090,
        routes: [
          {
            method: 'GET',
            path: '/api/slow',
            response: { status: 200, body: { ok: true }, delay: '50ms' },
          },
        ],
      };
      const app = createMockServer(config);
      await app.ready();

      const start = Date.now();
      const res = await app.inject({ method: 'GET', url: '/api/slow' });
      const elapsed = Date.now() - start;

      expect(res.statusCode).toBe(200);
      // Should take at least ~50ms
      expect(elapsed).toBeGreaterThanOrEqual(40);
    });
  });

  // ── resolveResponseTemplate ─────────────────────────────────────────

  describe('resolveResponseTemplate', () => {
    const ctx = {
      body: { user: 'alice', nested: { id: 42 } },
      params: { id: '100' },
      query: { page: '2' },
    };

    it('should replace {{request.body.xxx}}', () => {
      const result = resolveResponseTemplate('Hello {{request.body.user}}', ctx);
      expect(result).toBe('Hello alice');
    });

    it('should replace nested body paths', () => {
      const result = resolveResponseTemplate('ID: {{request.body.nested.id}}', ctx);
      expect(result).toBe('ID: 42');
    });

    it('should replace {{request.params.xxx}}', () => {
      const result = resolveResponseTemplate('Item {{request.params.id}}', ctx);
      expect(result).toBe('Item 100');
    });

    it('should replace {{request.query.xxx}}', () => {
      const result = resolveResponseTemplate('Page {{request.query.page}}', ctx);
      expect(result).toBe('Page 2');
    });

    it('should replace {{timestamp}} with an ISO string', () => {
      const result = resolveResponseTemplate('{{timestamp}}', ctx);
      expect(typeof result).toBe('string');
      // Should be parseable as a date
      expect(new Date(result as string).toISOString()).toBe(result);
    });

    it('should replace {{uuid}} with a UUID-like string', () => {
      const result = resolveResponseTemplate('{{uuid}}', ctx);
      expect(typeof result).toBe('string');
      expect(result).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    it('should resolve templates in objects recursively', () => {
      const template = { name: '{{request.body.user}}', page: '{{request.query.page}}' };
      const result = resolveResponseTemplate(template, ctx) as Record<string, string>;
      expect(result.name).toBe('alice');
      expect(result.page).toBe('2');
    });

    it('should resolve templates in arrays recursively', () => {
      const template = ['{{request.body.user}}', '{{request.params.id}}'];
      const result = resolveResponseTemplate(template, ctx) as string[];
      expect(result).toEqual(['alice', '100']);
    });

    it('should leave unknown placeholders untouched', () => {
      const result = resolveResponseTemplate('{{unknown.var}}', ctx);
      expect(result).toBe('{{unknown.var}}');
    });

    it('should pass through non-string primitives unchanged', () => {
      expect(resolveResponseTemplate(42, ctx)).toBe(42);
      expect(resolveResponseTemplate(true, ctx)).toBe(true);
      expect(resolveResponseTemplate(null, ctx)).toBe(null);
    });
  });

  // ── Regression: T018 — per-instance startTime ──────────────────────
  describe('per-instance startTime (regression)', () => {
    it('should report independent uptime for each mock server', async () => {
      const config1: MockServiceConfig = { port: 9091, routes: [] };
      const app1 = createMockServer(config1);
      await app1.ready();

      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const config2: MockServiceConfig = { port: 9092, routes: [] };
      const app2 = createMockServer(config2);
      await app2.ready();

      const res1 = await app1.inject({ method: 'GET', url: '/_mock/health' });
      const res2 = await app2.inject({ method: 'GET', url: '/_mock/health' });

      const uptime1 = (res1.json() as { uptime: number }).uptime;
      const uptime2 = (res2.json() as { uptime: number }).uptime;

      expect(uptime1).toBeGreaterThan(uptime2);
    });
  });
});
