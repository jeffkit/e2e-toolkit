/**
 * @module openapi/spec-loader
 * Parse, validate, and dereference OpenAPI 3.x specifications.
 *
 * Uses `@readme/openapi-parser` for full $ref resolution (including
 * circular and cross-file references). Extracts routes into the
 * intermediate {@link OpenAPIRoute} representation for Fastify registration.
 */

import { dereference } from '@readme/openapi-parser';
import path from 'node:path';
import type {
  DereferencedSpec,
  OpenAPIDocument,
  OpenAPIRoute,
  OpenAPIResponseDef,
  OpenAPIParam,
  HttpMethod,
  JSONSchema,
} from './types.js';

const SUPPORTED_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];

/**
 * Convert OpenAPI `{param}` path syntax to Fastify `:param` syntax.
 *
 * Example: `/users/{userId}/orders/{orderId}` → `/users/:userId/orders/:orderId`
 */
export function convertOpenApiPath(openApiPath: string): string {
  return openApiPath.replace(/\{([^}]+)\}/g, ':$1');
}

/**
 * Load, validate, and dereference an OpenAPI 3.x spec file.
 *
 * @param specPath - Path to the spec file (resolved to absolute)
 * @returns Fully dereferenced spec with extracted routes
 * @throws Error on missing file, invalid spec, or unresolvable references
 */
export async function loadAndDereferenceSpec(specPath: string): Promise<DereferencedSpec> {
  const absolutePath = path.resolve(specPath);

  let api: OpenAPIDocument;
  try {
    api = await dereference(absolutePath) as unknown as OpenAPIDocument;
  } catch (err) {
    const message = (err as Error).message;
    if (message.includes('ENOENT') || message.includes('no such file')) {
      throw new Error(`OpenAPI spec file not found: ${absolutePath}`);
    }
    if (message.includes('is not a valid')) {
      throw new Error(`OpenAPI spec validation failed: ${message}`);
    }
    throw new Error(`Failed to parse OpenAPI spec: ${message}`);
  }

  const info = (api as Record<string, unknown>)['info'] as
    | { title?: string; version?: string }
    | undefined;
  const openApiVersion =
    ((api as Record<string, unknown>)['openapi'] as string | undefined) ??
    ((api as Record<string, unknown>)['swagger'] as string | undefined) ??
    'unknown';

  const routes = extractRoutes(api);

  return {
    specPath: absolutePath,
    openApiVersion,
    title: info?.title ?? 'Untitled',
    document: api,
    routes,
    parsedAt: Date.now(),
  };
}

// =====================================================================
// Route extraction internals
// =====================================================================

interface PathItemLike {
  parameters?: ParameterLike[];
  [method: string]: unknown;
}

interface OperationLike {
  operationId?: string;
  parameters?: ParameterLike[];
  requestBody?: {
    required?: boolean;
    content?: Record<string, { schema?: JSONSchema }>;
  };
  responses?: Record<string, ResponseLike>;
}

interface ResponseLike {
  description?: string;
  content?: Record<string, { schema?: JSONSchema; example?: unknown }>;
  headers?: Record<string, { schema?: JSONSchema }>;
}

interface ParameterLike {
  name: string;
  in: string;
  required?: boolean;
  schema?: JSONSchema;
  example?: unknown;
}

function extractRoutes(api: OpenAPIDocument): OpenAPIRoute[] {
  const paths = (api as Record<string, unknown>)['paths'] as
    | Record<string, PathItemLike>
    | undefined;
  if (!paths) return [];

  const routes: OpenAPIRoute[] = [];

  for (const [openApiPath, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== 'object') continue;

    const pathLevelParams = pathItem.parameters ?? [];

    for (const method of SUPPORTED_METHODS) {
      const operation = pathItem[method.toLowerCase()] as OperationLike | undefined;
      if (!operation) continue;

      const allParams = [...pathLevelParams, ...(operation.parameters ?? [])];

      const responses = extractResponses(operation.responses);
      const defaultStatus = findDefaultStatus(responses);

      const route: OpenAPIRoute = {
        method,
        openApiPath,
        fastifyPath: convertOpenApiPath(openApiPath),
        operationId: operation.operationId,
        responses,
        defaultStatus,
        pathParams: extractParams(allParams, 'path'),
        queryParams: extractParams(allParams, 'query'),
        headerParams: extractParams(allParams, 'header'),
      };

      if (operation.requestBody?.content) {
        const contentTypes = Object.keys(operation.requestBody.content);
        const primaryCT = contentTypes.find((ct) => ct.includes('json')) ?? contentTypes[0] ?? 'application/json';
        const mediaType = operation.requestBody.content[primaryCT];
        if (mediaType?.schema) {
          route.requestBody = {
            required: operation.requestBody.required ?? false,
            schema: mediaType.schema,
            contentType: primaryCT,
          };
        }
      }

      routes.push(route);
    }
  }

  return routes;
}

function extractResponses(
  responses: Record<string, ResponseLike> | undefined,
): Map<number, OpenAPIResponseDef> {
  const map = new Map<number, OpenAPIResponseDef>();
  if (!responses) return map;

  for (const [code, responseDef] of Object.entries(responses)) {
    const statusCode = parseInt(code, 10);
    if (isNaN(statusCode)) continue;

    let schema: JSONSchema | undefined;
    let example: unknown;
    let contentType = 'application/json';

    if (responseDef.content) {
      const contentTypes = Object.keys(responseDef.content);
      const primaryCT = contentTypes.find((ct) => ct.includes('json')) ?? contentTypes[0];
      if (primaryCT) {
        contentType = primaryCT;
        const media = responseDef.content[primaryCT];
        schema = media?.schema;
        example = media?.example;
      }
    }

    const responseHeaders: Record<string, { schema: JSONSchema }> | undefined =
      responseDef.headers
        ? Object.fromEntries(
            Object.entries(responseDef.headers)
              .filter(([, h]) => h.schema)
              .map(([name, h]) => [name, { schema: h.schema! }]),
          )
        : undefined;

    map.set(statusCode, {
      statusCode,
      description: responseDef.description ?? '',
      schema,
      example,
      headers: responseHeaders && Object.keys(responseHeaders).length > 0 ? responseHeaders : undefined,
      contentType,
    });
  }

  return map;
}

function findDefaultStatus(responses: Map<number, OpenAPIResponseDef>): number {
  const codes = [...responses.keys()].sort((a, b) => a - b);
  const twoXX = codes.find((c) => c >= 200 && c < 300);
  return twoXX ?? codes[0] ?? 200;
}

function extractParams(params: ParameterLike[], location: string): OpenAPIParam[] {
  return params
    .filter((p) => p.in === location)
    .map((p) => ({
      name: p.name,
      required: p.required ?? false,
      schema: p.schema ?? {},
      example: p.example,
    }));
}
