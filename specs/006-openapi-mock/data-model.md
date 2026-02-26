# Data Model: OpenAPI Smart Mock

**Feature**: 006-openapi-mock  
**Date**: 2026-02-27

---

## Entity Relationship Overview

```
E2EConfig
  └── mocks: Record<string, MockServiceConfig>
        ├── openapi? ──→ [OpenAPI Spec File] ──parse──→ DereferencedSpec
        ├── mode?    ──→ MockMode (auto|record|replay|smart)
        ├── validate?
        ├── target?  ──→ Real API URL (for record mode)
        ├── overrides? ──→ MockRouteConfig[]
        ├── routes?    ──→ MockRouteConfig[] (backward compat)
        └── port
              │
              ▼
        MockServer (Fastify)
          ├── Auto-generated routes ←── DereferencedSpec
          ├── Override routes ←── overrides / routes
          ├── RequestValidator? ←── DereferencedSpec (when validate: true)
          └── Recorder? ←── RecordingStore (when mode=record|replay|smart)
```

---

## 1. Extended MockServiceConfig (Zod Schema)

The existing `MockServiceConfig` is extended with new optional fields. All new fields default to values that preserve backward compatibility.

```typescript
export const MockModeSchema = z.enum(['auto', 'record', 'replay', 'smart']);
export type MockMode = z.infer<typeof MockModeSchema>;

export const MockServiceSchema = z.object({
  port: z.number()
    .describe('Host port the mock server listens on'),

  containerPort: z.number().optional()
    .describe('Container-internal port (for Docker network access)'),

  routes: z.array(MockRouteSchema).optional()
    .describe('Mock route definitions (backward compatible; acts as overrides when openapi is set)'),

  image: z.string().optional()
    .describe('Pre-built Docker image (alternative to inline routes)'),

  // ── New OpenAPI fields ──
  openapi: z.string().optional()
    .describe('Path to OpenAPI 3.x spec file (YAML or JSON), relative to e2e.yaml'),

  mode: MockModeSchema.optional().default('auto')
    .describe('Mock operating mode: auto, record, replay, smart'),

  validate: z.boolean().optional().default(false)
    .describe('Enable request validation against OpenAPI spec'),

  target: z.string().url().optional()
    .describe('Real API base URL for record mode proxying'),

  recordingsDir: z.string().optional().default('.argusai/recordings')
    .describe('Directory for storing recorded request/response pairs'),

  maxDepth: z.number().min(1).max(10).optional().default(3)
    .describe('Maximum nesting depth for circular $ref resolution'),

  overrides: z.array(MockRouteSchema).optional()
    .describe('Manual override routes that take precedence over auto-generated routes'),
});
```

**Validation rules**:

- When `mode` is `record`, `target` is required
- When `mode` is `replay` or `smart`, `openapi` is required
- When `openapi` is absent, `mode`, `validate`, `overrides` are ignored (pure backward-compat mode)
- `routes` and `overrides` are treated identically when `openapi` is present — both override auto-generated routes. `overrides` is the preferred name; `routes` is kept for backward compatibility.

---

## 2. DereferencedSpec

Internal representation produced by `spec-loader.ts` after parsing and dereferencing.

```typescript
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
```

---

## 3. OpenAPIRoute

Intermediate representation mapping one OpenAPI path+method to the data needed to register a Fastify route and generate responses.

```typescript
export interface OpenAPIRoute {
  /** HTTP method (uppercase) */
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';

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

/** JSON Schema subset used for validation and response generation */
export type JSONSchema = Record<string, unknown>;
```

---

## 4. Recording & RecordingStore

Data model for the record/replay subsystem.

```typescript
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
  timestamp: string;  // ISO-8601
}

export interface RecordingFile {
  metadata: {
    mockName: string;
    recordedAt: string;  // ISO-8601
    specFile?: string;
    version: 1;
  };
  recordings: RecordingEntry[];
}

/**
 * Request signature used for matching recordings during replay.
 * Format: `${METHOD}:${path}?${sortedQueryString}`
 */
export type RequestSignature = string;

export interface RecordingStore {
  /** Save a new recording entry */
  save(entry: RecordingEntry): void;

  /** Find a recording matching the given request signature */
  find(signature: RequestSignature): RecordingEntry | undefined;

  /** Check if any recording exists for the signature */
  has(signature: RequestSignature): boolean;

  /** Flush recordings to disk */
  flush(): Promise<void>;

  /** Load recordings from disk */
  load(): Promise<void>;
}
```

**Request signature computation**:

```typescript
function computeSignature(method: string, path: string, query: Record<string, string>): RequestSignature {
  const sortedQuery = Object.keys(query).sort()
    .map(k => `${k}=${query[k]}`)
    .join('&');
  return `${method.toUpperCase()}:${path}${sortedQuery ? '?' + sortedQuery : ''}`;
}
```

---

## 5. ValidationResult

Output of the request validator.

```typescript
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
```

**422 error response format**:

```json
{
  "error": "Request validation failed",
  "code": "VALIDATION_ERROR",
  "details": [
    {
      "location": "body",
      "pointer": "/amount",
      "message": "must be integer",
      "expected": "integer",
      "actual": "not-a-number"
    }
  ]
}
```

---

## 6. MockGenerateResult (MCP Tool Output)

Output of the `argus_mock_generate` MCP tool.

```typescript
export interface MockGenerateResult {
  /** Generated YAML configuration snippet */
  yaml: string;

  /** Summary of what was generated */
  summary: {
    specTitle: string;
    specVersion: string;
    totalEndpoints: number;
    methods: Record<string, number>;  // e.g. { GET: 5, POST: 3 }
  };
}
```

---

## 7. MockValidateResult (MCP Tool Output)

Output of the `argus_mock_validate` MCP tool.

```typescript
export interface MockValidateResult {
  /** Total endpoints in the spec */
  totalSpecEndpoints: number;

  /** Number of covered endpoints */
  coveredCount: number;

  /** Number of missing endpoints */
  missingCount: number;

  /** Coverage percentage */
  coveragePercent: number;

  /** List of covered endpoints */
  covered: Array<{ method: string; path: string }>;

  /** List of missing endpoints (in spec but not in mock config) */
  missing: Array<{ method: string; path: string }>;

  /** Extra endpoints (in mock config but not in spec) */
  extra: Array<{ method: string; path: string }>;
}
```

---

## State Transitions

### Mock Mode State Machine

```
                    ┌─────────────┐
                    │   CONFIG    │  (e2e.yaml parsed)
                    └──────┬──────┘
                           │
                    openapi field present?
                   ┌───no──┴──yes───┐
                   ▼                ▼
            ┌──────────┐    ┌──────────────┐
            │  LEGACY  │    │  PARSE SPEC  │
            │  (routes │    └──────┬───────┘
            │   only)  │           │
            └──────────┘    parse success?
                           ┌──no──┴──yes───┐
                           ▼               ▼
                    ┌──────────┐    ┌──────────────┐
                    │  ERROR   │    │  CHECK MODE  │
                    │ (report) │    └──────┬───────┘
                    └──────────┘           │
                              ┌────┬──────┴──────┬────┐
                              ▼    ▼             ▼    ▼
                          ┌──────┐ ┌───────┐ ┌──────┐ ┌───────┐
                          │ auto │ │record │ │replay│ │ smart │
                          └──┬───┘ └───┬───┘ └──┬───┘ └───┬───┘
                             │         │        │         │
                             ▼         ▼        ▼         ▼
                          Generate   Proxy    Load      Load rec
                          routes +   to real  recordings + gen
                          register   API +    + register  fallback
                                     save               routes
```

### Recording Lifecycle

```
[record mode]
  Request arrives → Forward to target → Save pair → Return real response

[replay mode]
  Request arrives → Compute signature → Find recording → Return recorded response
                                              │
                                         not found → 404 "No recording found"

[smart mode]
  Request arrives → Compute signature → Find recording → Return recorded response
                                              │
                                         not found → Generate from spec → Return generated
```

---

## Backward Compatibility Matrix

| Config pattern | Behavior |
|----------------|----------|
| `routes` only (no `openapi`) | **Unchanged** — existing mock behavior preserved |
| `openapi` only | Auto-generate all routes from spec |
| `openapi` + `overrides` | Auto-generate + overrides take precedence |
| `openapi` + `routes` | Same as `openapi` + `overrides` (routes act as overrides) |
| `openapi` + `routes` + `overrides` | Merge: both `routes` and `overrides` are overrides |
| `image` (no `openapi`, no `routes`) | **Unchanged** — use external Docker image |
