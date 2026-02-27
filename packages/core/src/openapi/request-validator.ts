/**
 * @module openapi/request-validator
 * Validate incoming requests against an OpenAPI spec using Ajv.
 *
 * At mock server startup, compiles request body, parameter, and header
 * schemas from the dereferenced spec. Returns structured validation
 * errors with location-specific details.
 */

import Ajv from 'ajv';
import type {
  DereferencedSpec,
  OpenAPIRoute,
  ValidationResult,
  ValidationError,
  RequestValidatorSet,
  JSONSchema,
} from './types.js';
import { convertOpenApiPath } from './spec-loader.js';

interface CompiledRouteValidator {
  route: OpenAPIRoute;
  bodyValidator?: ReturnType<Ajv['compile']>;
  queryValidators: Map<string, ReturnType<Ajv['compile']>>;
  pathValidators: Map<string, ReturnType<Ajv['compile']>>;
  headerValidators: Map<string, ReturnType<Ajv['compile']>>;
}

/**
 * Compile Ajv validators from all routes in a dereferenced spec.
 * Call once at mock server startup.
 */
export function compileValidators(spec: DereferencedSpec): RequestValidatorSet {
  const ajv = new Ajv({ allErrors: true, strict: false, coerceTypes: true });
  const routeMap = new Map<string, CompiledRouteValidator>();

  for (const route of spec.routes) {
    const key = `${route.method}:${route.fastifyPath}`;
    const compiled: CompiledRouteValidator = {
      route,
      queryValidators: new Map(),
      pathValidators: new Map(),
      headerValidators: new Map(),
    };

    if (route.requestBody?.schema) {
      try {
        compiled.bodyValidator = ajv.compile(route.requestBody.schema);
      } catch {
        // Schema compilation failure — skip validation for this route's body
      }
    }

    for (const param of route.queryParams) {
      if (param.schema && Object.keys(param.schema).length > 0) {
        try {
          compiled.queryValidators.set(param.name, ajv.compile(param.schema));
        } catch {
          // skip
        }
      }
    }

    for (const param of route.pathParams) {
      if (param.schema && Object.keys(param.schema).length > 0) {
        try {
          compiled.pathValidators.set(param.name, ajv.compile(param.schema));
        } catch {
          // skip
        }
      }
    }

    for (const param of route.headerParams) {
      if (param.schema && Object.keys(param.schema).length > 0) {
        try {
          compiled.headerValidators.set(param.name.toLowerCase(), ajv.compile(param.schema));
        } catch {
          // skip
        }
      }
    }

    routeMap.set(key, compiled);
  }

  return {
    validate(
      method: string,
      path: string,
      request: {
        body?: unknown;
        params?: Record<string, string>;
        query?: Record<string, string>;
        headers?: Record<string, string | string[] | undefined>;
      },
    ): ValidationResult {
      return validateRequest({ routeMap, spec }, method, path, request);
    },
  };
}

/**
 * Validate a single request against compiled validators.
 */
export function validateRequest(
  validators: RequestValidatorSet | { routeMap: Map<string, CompiledRouteValidator>; spec: DereferencedSpec },
  method: string,
  path: string,
  request: {
    body?: unknown;
    params?: Record<string, string>;
    query?: Record<string, string>;
    headers?: Record<string, string | string[] | undefined>;
  },
): ValidationResult {
  if ('validate' in validators && typeof validators.validate === 'function') {
    return validators.validate(method, path, request);
  }

  const internal = validators as { routeMap: Map<string, CompiledRouteValidator>; spec: DereferencedSpec };
  const errors: ValidationError[] = [];

  const matched = findMatchingRoute(internal.routeMap, internal.spec, method, path);
  if (!matched) {
    return {
      valid: false,
      errors: [{
        location: 'path',
        pointer: '',
        message: `Unknown endpoint: ${method} ${path}`,
        expected: 'A valid endpoint defined in the OpenAPI spec',
      }],
    };
  }

  // Body validation
  if (matched.bodyValidator && request.body !== undefined) {
    const valid = matched.bodyValidator(request.body);
    if (!valid && matched.bodyValidator.errors) {
      for (const err of matched.bodyValidator.errors) {
        errors.push({
          location: 'body',
          pointer: err.instancePath || '/',
          message: err.message ?? 'Invalid value',
          expected: formatSchemaExpectation(err),
          actual: err.params?.['type'] ?? undefined,
        });
      }
    }
  } else if (matched.route.requestBody?.required && request.body === undefined) {
    errors.push({
      location: 'body',
      pointer: '/',
      message: 'Request body is required',
      expected: 'object',
    });
  }

  // Query parameter validation
  if (request.query) {
    for (const [name, validator] of matched.queryValidators) {
      const value = request.query[name];
      if (value !== undefined) {
        const valid = validator(value);
        if (!valid && validator.errors) {
          for (const err of validator.errors) {
            errors.push({
              location: 'query',
              pointer: `/${name}`,
              message: err.message ?? 'Invalid value',
              expected: formatSchemaExpectation(err),
              actual: value,
            });
          }
        }
      }
    }
  }

  // Path parameter validation
  if (request.params) {
    for (const [name, validator] of matched.pathValidators) {
      const value = request.params[name];
      if (value !== undefined) {
        const valid = validator(value);
        if (!valid && validator.errors) {
          for (const err of validator.errors) {
            errors.push({
              location: 'path',
              pointer: `/${name}`,
              message: err.message ?? 'Invalid value',
              expected: formatSchemaExpectation(err),
            });
          }
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

function findMatchingRoute(
  routeMap: Map<string, CompiledRouteValidator>,
  spec: DereferencedSpec,
  method: string,
  reqPath: string,
): CompiledRouteValidator | undefined {
  const upperMethod = method.toUpperCase();

  for (const route of spec.routes) {
    if (route.method !== upperMethod) continue;
    if (matchPath(route.fastifyPath, reqPath)) {
      const key = `${route.method}:${route.fastifyPath}`;
      return routeMap.get(key);
    }
  }

  return undefined;
}

function matchPath(pattern: string, actual: string): boolean {
  const patternParts = pattern.split('/');
  const actualParts = actual.split('/');

  if (patternParts.length !== actualParts.length) return false;

  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i]!.startsWith(':')) continue;
    if (patternParts[i] !== actualParts[i]) return false;
  }

  return true;
}

function formatSchemaExpectation(err: { keyword?: string; params?: Record<string, unknown> }): string {
  if (err.keyword === 'type') {
    return String(err.params?.['type'] ?? 'unknown');
  }
  if (err.keyword === 'required') {
    return `required field: ${String(err.params?.['missingProperty'] ?? 'unknown')}`;
  }
  return err.keyword ?? 'valid value';
}
