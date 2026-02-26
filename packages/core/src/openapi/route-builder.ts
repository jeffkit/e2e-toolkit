/**
 * @module openapi/route-builder
 * Convert dereferenced OpenAPI routes into Fastify route configurations.
 *
 * For each route, creates a handler that selects the response status code
 * (default lowest 2xx, overridable via `X-Mock-Status` header), generates
 * the response body from the schema, and sets the appropriate Content-Type.
 */

import type { FastifyRequest, FastifyReply, RouteOptions } from 'fastify';
import type { DereferencedSpec, OpenAPIRoute, HttpMethod } from './types.js';
import { generateResponseBody } from './response-generator.js';

export interface BuildRoutesConfig {
  maxDepth: number;
}

/**
 * Build Fastify route options from a dereferenced OpenAPI spec.
 *
 * @param spec - Dereferenced OpenAPI spec with extracted routes
 * @param config - Build configuration (maxDepth for response generation)
 * @returns Array of Fastify RouteOptions ready for registration
 */
export function buildOpenAPIRoutes(
  spec: DereferencedSpec,
  config: BuildRoutesConfig,
): RouteOptions[] {
  return spec.routes.map((route) => buildRouteOption(route, config));
}

function buildRouteOption(
  route: OpenAPIRoute,
  config: BuildRoutesConfig,
): RouteOptions {
  return {
    method: route.method as HttpMethod,
    url: route.fastifyPath,
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      const requestedStatus = req.headers['x-mock-status'];
      let statusCode = route.defaultStatus;

      if (requestedStatus) {
        const parsed = parseInt(String(requestedStatus), 10);
        if (!isNaN(parsed) && route.responses.has(parsed)) {
          statusCode = parsed;
        }
      }

      const responseDef = route.responses.get(statusCode);

      if (!responseDef) {
        return reply.status(statusCode).send(null);
      }

      if (responseDef.contentType) {
        void reply.header('content-type', responseDef.contentType);
      }

      let body: unknown = null;
      if (responseDef.example !== undefined) {
        body = responseDef.example;
      } else if (responseDef.schema) {
        body = generateResponseBody(responseDef.schema, {
          maxDepth: config.maxDepth,
        });
      }

      return reply.status(statusCode).send(body);
    },
  };
}
