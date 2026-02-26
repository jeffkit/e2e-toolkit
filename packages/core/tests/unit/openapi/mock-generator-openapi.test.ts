/**
 * Unit tests for mock-generator OpenAPI code path.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import path from 'node:path';
import { createMockServer } from '../../../src/mock-generator.js';
import type { MockServiceConfig } from '../../../src/types.js';

const FIXTURES = path.resolve(import.meta.dirname, 'fixtures');
const PETSTORE = path.join(FIXTURES, 'petstore.yaml');

describe('mock-generator OpenAPI integration', () => {
  describe('auto-generation from spec', () => {
    let app: FastifyInstance;

    beforeEach(async () => {
      const config: MockServiceConfig = {
        port: 9090,
        openapi: PETSTORE,
        mode: 'auto',
      };
      app = await createMockServer(config);
      await app.ready();
    });

    it('should auto-generate GET /pets route', async () => {
      const res = await app.inject({ method: 'GET', url: '/pets' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body)).toBe(true);
    });

    it('should auto-generate POST /pets route with example', async () => {
      const res = await app.inject({ method: 'POST', url: '/pets' });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toEqual({ id: 1, name: 'Fido', tag: 'dog' });
    });

    it('should auto-generate GET /pets/:petId route', async () => {
      const res = await app.inject({ method: 'GET', url: '/pets/42' });
      expect(res.statusCode).toBe(200);
      const body = res.json() as Record<string, unknown>;
      expect(body).toHaveProperty('id');
      expect(body).toHaveProperty('name');
    });

    it('should auto-generate DELETE /pets/:petId route', async () => {
      const res = await app.inject({ method: 'DELETE', url: '/pets/42' });
      expect(res.statusCode).toBe(204);
    });

    it('should support X-Mock-Status header override', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/pets/42',
        headers: { 'x-mock-status': '404' },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('backward compatibility (no openapi field)', () => {
    it('should work with routes-only config', async () => {
      const config: MockServiceConfig = {
        port: 9090,
        routes: [
          {
            method: 'GET',
            path: '/api/status',
            response: { status: 200, body: { status: 'ok' } },
          },
        ],
      };
      const app = await createMockServer(config);
      await app.ready();

      const res = await app.inject({ method: 'GET', url: '/api/status' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: 'ok' });
    });

    it('should create server with no routes and no openapi', async () => {
      const config: MockServiceConfig = { port: 9090 };
      const app = await createMockServer(config);
      await app.ready();

      const res = await app.inject({ method: 'GET', url: '/_mock/health' });
      expect(res.statusCode).toBe(200);
      expect((res.json() as Record<string, unknown>).routeCount).toBe(0);
    });
  });

  describe('SSE event emission', () => {
    it('should emit mock_openapi_parsed event', async () => {
      const events: Array<{ event: string; data: unknown }> = [];
      const eventBus = {
        emit: (channel: string, msg: { event: string; data: unknown }) => {
          events.push(msg);
        },
        subscribe: () => () => {},
      };

      const config: MockServiceConfig = {
        port: 9090,
        openapi: PETSTORE,
      };
      await createMockServer(config, { eventBus, name: 'test-mock' });

      const parsed = events.find((e) => e.event === 'mock_openapi_parsed');
      expect(parsed).toBeDefined();
      const data = parsed!.data as Record<string, unknown>;
      expect(data.name).toBe('test-mock');
      expect(data.endpoints).toBeGreaterThan(0);
    });
  });

  describe('error handling', () => {
    it('should throw on bad spec path', async () => {
      const config: MockServiceConfig = {
        port: 9090,
        openapi: '/nonexistent/spec.yaml',
      };
      await expect(createMockServer(config)).rejects.toThrow(/not found/i);
    });
  });

  // ── US3: Override logic ──────────────────────────────────────────────

  describe('overrides', () => {
    it('should let override take precedence over auto-generated route', async () => {
      const config: MockServiceConfig = {
        port: 9090,
        openapi: PETSTORE,
        overrides: [
          {
            method: 'GET',
            path: '/pets',
            response: { status: 200, body: { custom: true } },
          },
        ],
      };
      const app = await createMockServer(config);
      await app.ready();

      const res = await app.inject({ method: 'GET', url: '/pets' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ custom: true });
    });

    it('should still auto-generate non-overridden endpoints', async () => {
      const config: MockServiceConfig = {
        port: 9090,
        openapi: PETSTORE,
        overrides: [
          {
            method: 'GET',
            path: '/pets',
            response: { status: 200, body: { custom: true } },
          },
        ],
      };
      const app = await createMockServer(config);
      await app.ready();

      const res = await app.inject({ method: 'GET', url: '/pets/42' });
      expect(res.statusCode).toBe(200);
      const body = res.json() as Record<string, unknown>;
      expect(body).toHaveProperty('id');
    });

    it('should support template variable expansion in overrides', async () => {
      const config: MockServiceConfig = {
        port: 9090,
        openapi: PETSTORE,
        overrides: [
          {
            method: 'POST',
            path: '/pets',
            response: {
              status: 201,
              body: { id: '{{uuid}}', name: 'Custom' },
            },
          },
        ],
      };
      const app = await createMockServer(config);
      await app.ready();

      const res = await app.inject({ method: 'POST', url: '/pets', payload: {} });
      expect(res.statusCode).toBe(201);
      const body = res.json() as { id: string; name: string };
      expect(body.name).toBe('Custom');
      expect(body.id).toMatch(/^[0-9a-f]{8}-/);
    });

    it('should support override for path not in spec', async () => {
      const config: MockServiceConfig = {
        port: 9090,
        openapi: PETSTORE,
        overrides: [
          {
            method: 'GET',
            path: '/custom/endpoint',
            response: { status: 200, body: { extra: true } },
          },
        ],
      };
      const app = await createMockServer(config);
      await app.ready();

      const res = await app.inject({ method: 'GET', url: '/custom/endpoint' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ extra: true });
    });

    it('should treat routes as overrides when openapi is present', async () => {
      const config: MockServiceConfig = {
        port: 9090,
        openapi: PETSTORE,
        routes: [
          {
            method: 'GET',
            path: '/pets',
            response: { status: 200, body: { fromRoutes: true } },
          },
        ],
      };
      const app = await createMockServer(config);
      await app.ready();

      const res = await app.inject({ method: 'GET', url: '/pets' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ fromRoutes: true });
    });

    it('should merge routes and overrides arrays', async () => {
      const config: MockServiceConfig = {
        port: 9090,
        openapi: PETSTORE,
        routes: [
          {
            method: 'GET',
            path: '/from-routes',
            response: { status: 200, body: { source: 'routes' } },
          },
        ],
        overrides: [
          {
            method: 'GET',
            path: '/from-overrides',
            response: { status: 200, body: { source: 'overrides' } },
          },
        ],
      };
      const app = await createMockServer(config);
      await app.ready();

      const res1 = await app.inject({ method: 'GET', url: '/from-routes' });
      expect(res1.json()).toEqual({ source: 'routes' });

      const res2 = await app.inject({ method: 'GET', url: '/from-overrides' });
      expect(res2.json()).toEqual({ source: 'overrides' });
    });
  });
});
