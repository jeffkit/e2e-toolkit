/**
 * @module openapi/types
 * OpenAPI Smart Mock type definitions.
 *
 * Covers: DereferencedSpec, OpenAPIRoute, response/param definitions,
 * recording/replay, validation, and MCP tool result types.
 */

// =====================================================================
// Mock Mode
// =====================================================================

export type MockMode = 'auto' | 'record' | 'replay' | 'smart';

/** Dereferenced OpenAPI document (generic record since the parser returns plain objects) */
export type OpenAPIDocument = Record<string, unknown>;

// =====================================================================
// JSON Schema (subset used for validation & response generation)
// =====================================================================

export type JSONSchema = Record<string, unknown>;

// =====================================================================
// DereferencedSpec
// =====================================================================

export interface DereferencedSpec {
  /** Original spec file path (resolved to absolute) */
  specPath: string;

  /** OpenAPI version string ("3.0.3", "3.1.0", etc.) */
  openApiVersion: string;

  /** Spec title from info.title */
  title: string;

  /** Fully dereferenced OpenAPI document (no $ref remaining) */
  document: OpenAPIDocument;

  /** Extracted route definitions ready for Fastify registration */
  routes: OpenAPIRoute[];

  /** Parse timestamp */
  parsedAt: number;
}

// =====================================================================
// OpenAPIRoute & sub-types
// =====================================================================

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';

export interface OpenAPIResponseDef {
  statusCode: number;
  description: string;
  schema?: JSONSchema;
  example?: unknown;
  headers?: Record<string, { schema: JSONSchema }>;
  contentType: string;
}

export interface OpenAPIParam {
  name: string;
  required: boolean;
  schema: JSONSchema;
  example?: unknown;
}

export interface OpenAPIRoute {
  /** HTTP method (uppercase) */
  method: HttpMethod;

  /** OpenAPI path template, e.g. "/users/{id}" */
  openApiPath: string;

  /** Fastify-compatible path, e.g. "/users/:id" */
  fastifyPath: string;

  /** Operation ID from spec (if defined) */
  operationId?: string;

  /** Map of status code → response definition */
  responses: Map<number, OpenAPIResponseDef>;

  /** Default status code (lowest 2xx) */
  defaultStatus: number;

  /** Request body schema (if defined, for validation) */
  requestBody?: {
    required: boolean;
    schema: JSONSchema;
    contentType: string;
  };

  /** Path parameters with schemas */
  pathParams: OpenAPIParam[];

  /** Query parameters with schemas */
  queryParams: OpenAPIParam[];

  /** Header parameters with schemas */
  headerParams: OpenAPIParam[];
}

// =====================================================================
// Recording & RecordingStore (record/replay subsystem)
// =====================================================================

export interface RecordingEntry {
  request: {
    method: string;
    path: string;
    query: Record<string, string>;
    headers: Record<string, string>;
    body?: unknown;
  };
  response: {
    status: number;
    headers: Record<string, string>;
    body: unknown;
  };
  timestamp: string;
}

export interface RecordingFile {
  metadata: {
    mockName: string;
    recordedAt: string;
    specFile?: string;
    version: 1;
  };
  recordings: RecordingEntry[];
}

/**
 * Request signature for matching recordings during replay.
 * Format: `${METHOD}:${path}?${sortedQueryString}`
 */
export type RequestSignature = string;

export interface RecordingStore {
  save(entry: RecordingEntry): void;
  find(signature: RequestSignature): RecordingEntry | undefined;
  has(signature: RequestSignature): boolean;
  flush(): Promise<void>;
  load(): Promise<void>;
}

// =====================================================================
// Validation
// =====================================================================

export interface ValidationError {
  /** Where the error occurred: body, query, path, header */
  location: 'body' | 'query' | 'path' | 'header';
  /** JSON pointer to the failing field (e.g., "/amount") */
  pointer: string;
  /** Human-readable error message */
  message: string;
  /** Expected value/type */
  expected?: string;
  /** Actual value received */
  actual?: unknown;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export interface RequestValidatorSet {
  validate(method: string, path: string, request: {
    body?: unknown;
    params?: Record<string, string>;
    query?: Record<string, string>;
    headers?: Record<string, string | string[] | undefined>;
  }): ValidationResult;
}

// =====================================================================
// MCP Tool Results
// =====================================================================

export interface MockGenerateResult {
  yaml: string;
  summary: {
    specTitle: string;
    specVersion: string;
    totalEndpoints: number;
    methods: Record<string, number>;
  };
}

export interface MockValidateResult {
  totalSpecEndpoints: number;
  coveredCount: number;
  missingCount: number;
  coveragePercent: number;
  covered: Array<{ method: string; path: string }>;
  missing: Array<{ method: string; path: string }>;
  extra: Array<{ method: string; path: string }>;
}
