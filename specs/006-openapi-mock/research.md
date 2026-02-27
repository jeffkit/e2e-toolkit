# Research: OpenAPI Smart Mock

**Feature**: 006-openapi-mock  
**Date**: 2026-02-27  
**Status**: Complete

---

## Decision 1: OpenAPI Spec Parser

**Chosen**: `@readme/openapi-parser` v4.0.0

**Rationale**: The spec requires parsing OpenAPI 3.0 and 3.1 in both YAML and JSON, with full `$ref` resolution including circular and cross-file references (FR-M01, FR-M11). This library is purpose-built for exactly that:

- Validates against OpenAPI 3.0 and 3.1 JSON schemas
- `dereference()` method fully inlines all `$ref` pointers into a plain JS object — ideal for generating mock responses from schemas
- Handles circular references with maintained object reference equality
- `validate()` catches malformed specs with clear error messages (FR-M09)
- MIT license, actively maintained (v4.0.0 published Feb 2026)
- Built-in TypeScript declarations

**Key API surface**:

```typescript
import OpenAPIParser from '@readme/openapi-parser';

// Validate + dereference in one pass
const api = await OpenAPIParser.dereference('/path/to/spec.yaml');
// api.paths['/users']['get'].responses['200'].content['application/json'].schema
// → fully resolved, no $ref left
```

**Alternatives considered**:

| Library | Verdict |
|---------|---------|
| `@apidevtools/swagger-parser` | Predecessor to `@readme/openapi-parser`; callback-based API, less maintained |
| `swagger-parser` (original) | Deprecated upstream |
| Manual `js-yaml` + `$ref` walk | High effort, error-prone for circular refs |

**Trade-offs**:

- Adds ~350KB to core package (acceptable for the functionality gained)
- Dereference produces a potentially large in-memory object for specs with many `$ref`s — acceptable since mock servers run on the developer machine, not in constrained environments

---

## Decision 2: Request Validation Approach

**Chosen**: `ajv` (v8.x, already a devDependency in core) with a thin custom validation layer

**Rationale**: The project already uses `ajv` (in devDependencies) and `zod` for config validation. Rather than adding a heavyweight `openapi-request-validator` package, we build a focused validation module that:

1. Extracts request body schema, parameter schemas, and header schemas from the dereferenced OpenAPI spec
2. Compiles them into Ajv validators at mock server startup (one-time cost)
3. Runs validation in the Fastify `preHandler` hook when `validate: true`

This keeps the dependency footprint minimal and gives us full control over error formatting to produce the "clear, actionable error messages" required by FR-M04.

**Key design**:

```typescript
// At startup: compile validators from dereferenced spec
const validators = compileValidators(dereferencedSpec);

// Per-request: validate in Fastify preHandler
app.addHook('preHandler', (req, reply, done) => {
  const result = validators.validate(req.method, req.url, req);
  if (!result.valid) {
    reply.status(422).send({ errors: result.errors });
    return;
  }
  done();
});
```

**Alternatives considered**:

| Library | Verdict |
|---------|---------|
| `openapi-request-validator` (v12.x) | Adds another dependency; uses jsonschema internally instead of ajv; less control over error format |
| `express-openapi-validator` | Express-focused, not Fastify-compatible without adapter |
| Zod-based validation | Would require converting OpenAPI JSON Schema → Zod at runtime, unnecessary complexity |

**Trade-offs**:

- Custom code (~150-200 LOC) for the validation bridge; worth it for full control and no new dependency
- Move `ajv` from devDependencies to dependencies in `packages/core`

---

## Decision 3: Mock Response Generation from Schemas

**Chosen**: Custom schema-to-value generator (~200 LOC) in `packages/core/src/openapi/response-generator.ts`

**Rationale**: Generating realistic mock response bodies from OpenAPI JSON schemas (FR-M02) requires:

1. Using `example` / `examples` values when present
2. Generating type-appropriate placeholders when absent
3. Handling `oneOf`/`anyOf`/`allOf` composition
4. Respecting `enum`, `format`, `minimum`/`maximum` constraints
5. Bounded recursion for circular `$ref` (FR-M11, max depth configurable)

**Generation rules**:

| Schema type | Example absent | Example present |
|-------------|---------------|-----------------|
| `string` | `"string"` (or format-aware: `"user@example.com"`, `"2026-01-01"`) | Use example value |
| `integer` | `0` | Use example value |
| `number` | `0.0` | Use example value |
| `boolean` | `true` | Use example value |
| `array` | Single-element array with items schema generated | Use example value |
| `object` | Recursively generate all required + optional properties | Use example value |
| `enum` | First enum value | Use example value |
| `oneOf`/`anyOf` | First variant | Use example value |
| `allOf` | Merge all schemas | Use example value |

**Alternatives considered**:

| Approach | Verdict |
|----------|---------|
| `@stoplight/json-schema-sampler` | Adds dependency, limited control over output format |
| `json-schema-faker` | Large dependency (300KB+), overkill for our needs |
| Inline generation | Chosen — minimal code, fully customizable, no extra deps |

---

## Decision 4: Recording Format (Record/Replay)

**Chosen**: Single JSON file per mock service, array of request/response pairs

**Rationale**: The recording format must support:

- Request matching by method + path + sorted query params (per spec assumptions)
- Deterministic replay across runs (SC-006)
- Human readability for debugging
- Easy version control

**File format** (`.argusai/recordings/{mock-name}.json`):

```json
{
  "metadata": {
    "mockName": "payment-api",
    "recordedAt": "2026-02-27T10:00:00Z",
    "specFile": "specs/payment-api.yaml"
  },
  "recordings": [
    {
      "request": {
        "method": "POST",
        "path": "/api/charge",
        "query": {},
        "headers": { "content-type": "application/json" },
        "body": { "amount": 100, "currency": "USD" }
      },
      "response": {
        "status": 200,
        "headers": { "content-type": "application/json" },
        "body": { "charged": true, "transactionId": "tx_abc123" }
      },
      "timestamp": "2026-02-27T10:00:01Z"
    }
  ]
}
```

**Request signature** for matching: `${method}:${path}?${sortedQueryString}`

When multiple recordings match (same signature), the most recent recording wins (per edge case spec).

**Alternatives considered**:

| Format | Verdict |
|--------|---------|
| HAR (HTTP Archive) | Standard but overly verbose for API-only use; browser-centric metadata adds noise |
| Per-request files (WireMock style) | Generates too many files for large specs; harder to review in PRs |
| SQLite database | Overkill for local recordings; not diff-friendly in version control |

**Trade-offs**:

- Single JSON file can grow large for specs with many endpoints — acceptable since recordings are typically dozens to low hundreds of entries
- Not streaming-friendly — acceptable since recordings are written at end of test run

---

## Decision 5: Config Schema Extension

**Chosen**: Extend `MockServiceConfig` with new optional fields; fully backward-compatible

**Rationale**: The existing `MockServiceConfig` has `port`, `containerPort`, `routes`, `image`. We add:

```yaml
mocks:
  payment-api:
    port: 9090
    # NEW fields for OpenAPI Smart Mock
    openapi: ./specs/payment-api.yaml   # Path to OpenAPI spec file
    mode: auto                           # auto | record | replay | smart
    validate: false                      # Enable request validation
    target: https://api.payment.com      # Real API URL for record mode
    recordingsDir: .argusai/recordings   # Custom recordings directory
    maxDepth: 3                          # Max depth for circular $ref
    overrides:                           # Manual overrides (same as routes)
      - method: POST
        path: /api/charge
        response:
          status: 200
          body: { charged: true, transactionId: "{{uuid}}" }
    routes: [...]                        # Existing routes still work (backward compat)
```

Key design: when `openapi` is present, auto-generate routes from spec. When `routes` is present without `openapi`, existing behavior is preserved. When both are present, `routes` entries act as overrides (same as `overrides` field).

---

## Decision 6: OpenAPI Path Parameter Matching

**Chosen**: Convert OpenAPI path templates to Fastify parameterized routes

**Rationale**: OpenAPI uses `{id}` syntax for path parameters; Fastify uses `:id`. At route registration time:

```
/users/{userId}/orders/{orderId}  →  /users/:userId/orders/:orderId
```

This gives us Fastify's built-in path matching and parameter extraction for free. The conversion is a simple regex replace: `/{([^}]+)}/g` → `/:$1`.

---

## Decision 7: Multi-Status Code Handling

**Chosen**: `X-Mock-Status` request header for selecting alternative response codes

**Rationale**: Per FR-M03, each endpoint may define multiple response status codes. The default is the lowest 2xx code. Callers select alternatives via `X-Mock-Status: 404` header. At route registration, all response schemas are pre-compiled. The handler checks for the header and falls back to default.

---

## Decision 8: Module Structure

**Chosen**: New `packages/core/src/openapi/` directory with focused modules

**Rationale**: The OpenAPI functionality is substantial enough to warrant its own directory within core, following the pattern of `packages/core/src/history/` and `packages/core/src/knowledge/`:

```
packages/core/src/openapi/
├── index.ts              # Re-exports
├── types.ts              # OpenAPI-specific type definitions
├── spec-loader.ts        # Parse + dereference OpenAPI specs
├── response-generator.ts # Generate mock responses from schemas
├── route-builder.ts      # Convert OpenAPI paths to Fastify routes
├── request-validator.ts  # Validate requests against spec
└── recorder.ts           # Record/replay functionality
```

This keeps the existing `mock-generator.ts` clean — it gains a new code path for OpenAPI-backed mocks but delegates all OpenAPI logic to the submodule.
