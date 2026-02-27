/**
 * Unit tests for openapi/route-builder module.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { buildOpenAPIRoutes } from '../../../src/openapi/route-builder.js';
import type { DereferencedSpec, OpenAPIRoute, OpenAPIResponseDef } from '../../../src/openapi/types.js';

function makeRoute(overrides: Partial<OpenAPIRoute> = {}): OpenAPIRoute {
  const responses = new Map<number, OpenAPIResponseDef>();
  responses.set(200, {
    statusCode: 200,
    description: 'OK',
    schema: { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' } } },
    contentType: 'application/json',
  });
  return {
    method: 'GET',
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
    document: {} as DereferencedSpec['document'],
    routes,
    parsedAt: Date.now(),
  };
}

describe('route-builder', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    app = Fastify({ logger: false });
  });

  it('should create Fastify routes for all spec routes', () => {
    const spec = makeSpec([makeRoute(), makeRoute({ method: 'POST', openApiPath: '/items', fastifyPath: '/items' })]);
    const routes = buildOpenAPIRoutes(spec, { maxDepth: 3 });
    expect(routes).toHaveLength(2);
    expect(routes[0]!.method).toBe('GET');
    expect(routes[1]!.method).toBe('POST');
  });

  it('should return auto-generated response body', async () => {
    const routes = buildOpenAPIRoutes(makeSpec([makeRoute()]), { maxDepth: 3 });
    for (const r of routes) app.route(r);
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/items' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: 0, name: 'string' });
  });

  it('should select default status (lowest 2xx)', async () => {
    const responses = new Map<number, OpenAPIResponseDef>();
    responses.set(201, {
      statusCode: 201,
      description: 'Created',
      schema: { type: 'object', properties: { created: { type: 'boolean' } } },
      contentType: 'application/json',
    });
    responses.set(400, {
      statusCode: 400,
      description: 'Bad request',
      schema: { type: 'object', properties: { error: { type: 'string' } } },
      contentType: 'application/json',
    });

    const route = makeRoute({ method: 'POST', defaultStatus: 201, responses });
    const routes = buildOpenAPIRoutes(makeSpec([route]), { maxDepth: 3 });
    for (const r of routes) app.route(r);
    await app.ready();

    const res = await app.inject({ method: 'POST', url: '/items' });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ created: true });
  });

  it('should honor X-Mock-Status header override', async () => {
    const responses = new Map<number, OpenAPIResponseDef>();
    responses.set(200, {
      statusCode: 200,
      description: 'OK',
      schema: { type: 'object', properties: { ok: { type: 'boolean' } } },
      contentType: 'application/json',
    });
    responses.set(404, {
      statusCode: 404,
      description: 'Not found',
      schema: { type: 'object', properties: { error: { type: 'string' } } },
      contentType: 'application/json',
    });

    const route = makeRoute({ responses, defaultStatus: 200 });
    const routes = buildOpenAPIRoutes(makeSpec([route]), { maxDepth: 3 });
    for (const r of routes) app.route(r);
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/items',
      headers: { 'x-mock-status': '404' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'string' });
  });

  it('should ignore X-Mock-Status for undefined status codes', async () => {
    const routes = buildOpenAPIRoutes(makeSpec([makeRoute()]), { maxDepth: 3 });
    for (const r of routes) app.route(r);
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/items',
      headers: { 'x-mock-status': '999' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('should use example value when present in response', async () => {
    const responses = new Map<number, OpenAPIResponseDef>();
    responses.set(200, {
      statusCode: 200,
      description: 'OK',
      example: { id: 42, name: 'Fido' },
      schema: { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' } } },
      contentType: 'application/json',
    });

    const route = makeRoute({ responses });
    const routes = buildOpenAPIRoutes(makeSpec([route]), { maxDepth: 3 });
    for (const r of routes) app.route(r);
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/items' });
    expect(res.json()).toEqual({ id: 42, name: 'Fido' });
  });

  it('should set content-type from response definition', async () => {
    const responses = new Map<number, OpenAPIResponseDef>();
    responses.set(200, {
      statusCode: 200,
      description: 'OK',
      schema: { type: 'string' },
      contentType: 'text/plain',
    });

    const route = makeRoute({ responses });
    const routes = buildOpenAPIRoutes(makeSpec([route]), { maxDepth: 3 });
    for (const r of routes) app.route(r);
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/items' });
    expect(res.headers['content-type']).toContain('text/plain');
  });

  it('should handle routes with all HTTP methods', async () => {
    const methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] as const;
    const specRoutes = methods.map((m) => makeRoute({
      method: m,
      openApiPath: '/test',
      fastifyPath: '/test',
    }));
    const routes = buildOpenAPIRoutes(makeSpec(specRoutes), { maxDepth: 3 });
    expect(routes).toHaveLength(5);

    for (const r of routes) app.route(r);
    await app.ready();

    for (const m of methods) {
      const res = await app.inject({ method: m, url: '/test' });
      expect(res.statusCode).toBe(200);
    }
  });
});
