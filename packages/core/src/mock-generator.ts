/**
 * @module mock-generator
 * Declarative Mock service generator for e2e-toolkit.
 *
 * Reads {@link MockServiceConfig} from e2e.yaml and generates
 * a Fastify HTTP server with the configured mock routes plus
 * diagnostic helper endpoints under `/_mock/`.
 */

import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import crypto from 'node:crypto';
import type { MockServiceConfig, MockRouteConfig } from './types.js';

// =====================================================================
// Types
// =====================================================================

/** Recorded incoming request for diagnostic inspection. */
interface MockRequest {
  method: string;
  url: string;
  body: unknown;
  headers: Record<string, string | string[] | undefined>;
  timestamp: string;
}

// =====================================================================
// Template helpers
// =====================================================================

/**
 * Parse a delay string (e.g. "100ms", "2s") into milliseconds.
 *
 * @param delay - Delay string
 * @returns Milliseconds
 */
function parseDelay(delay: string): number {
  const match = delay.match(/^(\d+(?:\.\d+)?)\s*(ms|s)$/);
  if (!match) return 0;
  const value = parseFloat(match[1]!);
  return match[2] === 's' ? value * 1000 : value;
}

/**
 * Replace template variables in a value.
 *
 * Supported placeholders:
 * - `{{request.body.xxx}}`   – value from the request body
 * - `{{request.params.xxx}}` – route parameter
 * - `{{request.query.xxx}}`  – query-string parameter
 * - `{{timestamp}}`          – ISO-8601 timestamp
 * - `{{uuid}}`               – random UUID v4
 *
 * @param body    - Response body template (may be string, object, or array)
 * @param request - Incoming request context
 * @returns The body with all placeholders resolved
 */
export function resolveResponseTemplate(
  body: unknown,
  request: {
    body: unknown;
    params: Record<string, string>;
    query: Record<string, string>;
  },
): unknown {
  if (typeof body === 'string') {
    return body.replace(/\{\{(.+?)\}\}/g, (_match, key: string) => {
      const trimmed = key.trim();

      if (trimmed === 'timestamp') return new Date().toISOString();
      if (trimmed === 'uuid') return crypto.randomUUID();

      if (trimmed.startsWith('request.body.')) {
        const path = trimmed.slice('request.body.'.length);
        return String(getNestedValue(request.body, path) ?? '');
      }
      if (trimmed.startsWith('request.params.')) {
        const paramKey = trimmed.slice('request.params.'.length);
        return request.params[paramKey] ?? '';
      }
      if (trimmed.startsWith('request.query.')) {
        const queryKey = trimmed.slice('request.query.'.length);
        return request.query[queryKey] ?? '';
      }

      return `{{${trimmed}}}`;
    });
  }

  if (Array.isArray(body)) {
    return body.map((item) => resolveResponseTemplate(item, request));
  }

  if (body !== null && typeof body === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
      result[k] = resolveResponseTemplate(v, request);
    }
    return result;
  }

  return body;
}

/**
 * Safely read a nested property from an object using dot-path notation.
 */
function getNestedValue(obj: unknown, path: string): unknown {
  if (obj === null || obj === undefined || typeof obj !== 'object') return undefined;
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

// =====================================================================
// Route registration
// =====================================================================

/**
 * Check if a request matches the `when` condition of a route.
 */
function matchesCondition(
  route: MockRouteConfig,
  req: FastifyRequest,
): boolean {
  if (!route.when) return true;

  if (route.when.body) {
    const reqBody = req.body as Record<string, unknown> | undefined;
    if (!reqBody) return false;
    for (const [key, value] of Object.entries(route.when.body)) {
      if (reqBody[key] !== value) return false;
    }
  }

  if (route.when.headers) {
    for (const [key, value] of Object.entries(route.when.headers)) {
      if (req.headers[key.toLowerCase()] !== value) return false;
    }
  }

  if (route.when.query) {
    const q = req.query as Record<string, string>;
    for (const [key, value] of Object.entries(route.when.query)) {
      if (q[key] !== value) return false;
    }
  }

  return true;
}

/**
 * Register mock routes from configuration onto a Fastify instance.
 *
 * @param app    - Fastify server
 * @param routes - Array of mock route definitions
 */
function registerMockRoutes(
  app: FastifyInstance,
  routes: MockRouteConfig[],
): void {
  // Group routes by method+path so conditional matches work correctly
  const routeGroups = new Map<string, MockRouteConfig[]>();
  for (const route of routes) {
    const key = `${route.method.toUpperCase()} ${route.path}`;
    const group = routeGroups.get(key) ?? [];
    group.push(route);
    routeGroups.set(key, group);
  }

  for (const [, group] of routeGroups) {
    // All routes in a group share method + path.
    // Sort so that routes WITH conditions are checked first;
    // fallback (no `when`) goes last.
    const sorted = [...group].sort((a, b) => {
      if (a.when && !b.when) return -1;
      if (!a.when && b.when) return 1;
      return 0;
    });

    const first = sorted[0]!;
    const method = first.method.toUpperCase() as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';
    const routePath = first.path;

    app.route({
      method,
      url: routePath,
      handler: async (req: FastifyRequest, reply: FastifyReply) => {
        // Find first matching route (conditional first, fallback last)
        const matched = sorted.find((r) => matchesCondition(r, req)) ?? first;

        // Optional delay
        if (matched.response.delay) {
          const ms = parseDelay(matched.response.delay);
          if (ms > 0) {
            await new Promise<void>((resolve) => setTimeout(resolve, ms));
          }
        }

        // Set headers
        if (matched.response.headers) {
          for (const [k, v] of Object.entries(matched.response.headers)) {
            void reply.header(k, v);
          }
        }

        // Resolve template variables in body
        const resolved = resolveResponseTemplate(matched.response.body, {
          body: req.body,
          params: req.params as Record<string, string>,
          query: req.query as Record<string, string>,
        });

        return reply.status(matched.response.status).send(resolved);
      },
    });
  }
}

// =====================================================================
// Mock Server Factory
// =====================================================================

const startTime = Date.now();

/**
 * Create a Fastify mock server from a {@link MockServiceConfig}.
 *
 * The server includes:
 * - All configured mock routes
 * - `GET  /_mock/health`    – Health check
 * - `GET  /_mock/requests`  – Recorded request log
 * - `DELETE /_mock/requests` – Clear request log
 * - `GET  /_mock/routes`    – List configured routes
 *
 * @param config - Mock service configuration from e2e.yaml
 * @returns A configured (but not yet started) Fastify instance
 */
export function createMockServer(config: MockServiceConfig): FastifyInstance {
  const app = Fastify({ logger: false });
  const requestLog: MockRequest[] = [];
  const routes = config.routes ?? [];

  // ── Request recording hook ──────────────────────────────────────────
  app.addHook('onRequest', async (request) => {
    // Skip recording for /_mock/* helper endpoints
    if (request.url.startsWith('/_mock/')) return;
    requestLog.push({
      method: request.method,
      url: request.url,
      body: request.body,
      headers: request.headers as Record<string, string | string[] | undefined>,
      timestamp: new Date().toISOString(),
    });
  });

  // ── Mock helper endpoints ───────────────────────────────────────────

  app.get('/_mock/health', async () => {
    return {
      status: 'ok',
      uptime: (Date.now() - startTime) / 1000,
      routeCount: routes.length,
    };
  });

  app.get('/_mock/requests', async () => {
    return { count: requestLog.length, requests: requestLog };
  });

  app.delete('/_mock/requests', async () => {
    requestLog.length = 0;
    return { message: 'cleared' };
  });

  app.get('/_mock/routes', async () => {
    return { routes };
  });

  // ── User-defined mock routes ────────────────────────────────────────
  if (routes.length > 0) {
    registerMockRoutes(app, routes);
  }

  return app;
}
