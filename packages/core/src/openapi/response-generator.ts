/**
 * @module openapi/response-generator
 * Generate mock response bodies from JSON Schema definitions.
 *
 * Priorities: `example` field → type-appropriate placeholder.
 * Handles `string` (format-aware), `integer`, `number`, `boolean`,
 * `array`, `object`, `enum`, `oneOf`/`anyOf`/`allOf`, and enforces
 * `maxDepth` for circular schema protection.
 */

import type { JSONSchema } from './types.js';

export interface GenerateOptions {
  maxDepth: number;
  currentDepth?: number;
}

const FORMAT_DEFAULTS: Record<string, string> = {
  'date-time': '2026-01-01T00:00:00Z',
  date: '2026-01-01',
  time: '00:00:00Z',
  email: 'user@example.com',
  uri: 'https://example.com',
  url: 'https://example.com',
  uuid: '00000000-0000-0000-0000-000000000000',
  hostname: 'example.com',
  ipv4: '127.0.0.1',
  ipv6: '::1',
  'uri-reference': '/example',
  byte: 'dGVzdA==',
  binary: '<binary>',
  password: '********',
};

/**
 * Generate a mock response body from a JSON Schema.
 *
 * @param schema - JSON Schema object
 * @param options - Generation options including maxDepth
 * @returns Generated value matching the schema
 */
export function generateResponseBody(
  schema: JSONSchema,
  options: GenerateOptions,
): unknown {
  const depth = options.currentDepth ?? 0;

  if (depth >= options.maxDepth) {
    return null;
  }

  if (schema['example'] !== undefined) {
    return schema['example'];
  }

  if (schema['allOf']) {
    return handleAllOf(schema['allOf'] as JSONSchema[], options, depth);
  }

  if (schema['oneOf']) {
    const variants = schema['oneOf'] as JSONSchema[];
    if (variants.length > 0) {
      return generateResponseBody(variants[0]!, { ...options, currentDepth: depth });
    }
    return null;
  }

  if (schema['anyOf']) {
    const variants = schema['anyOf'] as JSONSchema[];
    if (variants.length > 0) {
      return generateResponseBody(variants[0]!, { ...options, currentDepth: depth });
    }
    return null;
  }

  if (schema['enum']) {
    const values = schema['enum'] as unknown[];
    return values.length > 0 ? values[0] : null;
  }

  const type = schema['type'] as string | string[] | undefined;
  const resolvedType = Array.isArray(type) ? type[0] : type;

  switch (resolvedType) {
    case 'string':
      return generateString(schema);
    case 'integer':
      return generateInteger(schema);
    case 'number':
      return generateNumber(schema);
    case 'boolean':
      return true;
    case 'array':
      return generateArray(schema, options, depth);
    case 'object':
      return generateObject(schema, options, depth);
    case 'null':
      return null;
    default:
      if (schema['properties']) {
        return generateObject(schema, options, depth);
      }
      return null;
  }
}

function generateString(schema: JSONSchema): string {
  const format = schema['format'] as string | undefined;
  if (format && FORMAT_DEFAULTS[format]) {
    return FORMAT_DEFAULTS[format]!;
  }
  return 'string';
}

function generateInteger(schema: JSONSchema): number {
  const minimum = schema['minimum'] as number | undefined;
  if (minimum !== undefined) return minimum;
  return 0;
}

function generateNumber(schema: JSONSchema): number {
  const minimum = schema['minimum'] as number | undefined;
  if (minimum !== undefined) return minimum;
  return 0.0;
}

function generateArray(
  schema: JSONSchema,
  options: GenerateOptions,
  depth: number,
): unknown[] {
  const items = schema['items'] as JSONSchema | undefined;
  if (!items) return [];
  const generated = generateResponseBody(items, { ...options, currentDepth: depth + 1 });
  return [generated];
}

function generateObject(
  schema: JSONSchema,
  options: GenerateOptions,
  depth: number,
): Record<string, unknown> {
  const properties = schema['properties'] as Record<string, JSONSchema> | undefined;
  if (!properties) return {};

  const result: Record<string, unknown> = {};
  for (const [key, propSchema] of Object.entries(properties)) {
    result[key] = generateResponseBody(propSchema, { ...options, currentDepth: depth + 1 });
  }
  return result;
}

function handleAllOf(
  schemas: JSONSchema[],
  options: GenerateOptions,
  depth: number,
): unknown {
  const merged: Record<string, unknown> = {};
  for (const sub of schemas) {
    const generated = generateResponseBody(sub, { ...options, currentDepth: depth });
    if (generated !== null && typeof generated === 'object' && !Array.isArray(generated)) {
      Object.assign(merged, generated);
    }
  }
  return merged;
}
