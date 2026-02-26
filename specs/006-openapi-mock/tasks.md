# Tasks: OpenAPI Smart Mock

**Input**: Design documents from `/specs/006-openapi-mock/`  
**Prerequisites**: plan.md (required), spec.md (required), data-model.md, contracts/, research.md, quickstart.md  
**Branch**: `006-openapi-mock` | **Generated**: 2026-02-27

**Organization**: Tasks are grouped by user story (5 stories from spec.md) to enable independent implementation and testing. US2 and US3 share the same priority tier (P2) and can be developed in parallel after US1 is complete.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1–US5)
- All paths are relative to repository root

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create directory structure and install the new dependency for the OpenAPI subsystem

- [X] T001 Create `packages/core/src/openapi/` directory and initial barrel export file `packages/core/src/openapi/index.ts`
- [X] T002 [P] Create test directory `packages/core/tests/unit/openapi/`
- [X] T003 [P] Add `@readme/openapi-parser` ^4.0.0 to `packages/core/package.json` dependencies and move `ajv` from devDependencies to dependencies; run `pnpm install`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Type definitions, configuration schema extensions, and SSE event types that ALL user stories depend on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T004 Define OpenAPI-specific types (`DereferencedSpec`, `OpenAPIRoute`, `OpenAPIResponseDef`, `OpenAPIParam`, `JSONSchema`, `MockMode`) and all entity interfaces from data-model.md (`RecordingEntry`, `RecordingFile`, `RequestSignature`, `RecordingStore`, `ValidationError`, `ValidationResult`, `MockGenerateResult`, `MockValidateResult`) in `packages/core/src/openapi/types.ts`
- [X] T005 Extend `MockServiceSchema` Zod schema with new optional fields (`openapi`, `mode`, `validate`, `target`, `recordingsDir`, `maxDepth`, `overrides`) including `.default()` values and `.describe()` annotations, add `.refine()` rule requiring `target` when `mode === 'record'`, in `packages/core/src/config-loader.ts`
- [X] T006 Extend `MockServiceConfig` interface in `packages/core/src/types.ts` with the new fields (`openapi?: string`, `mode?: MockMode`, `validate?: boolean`, `target?: string`, `recordingsDir?: string`, `maxDepth?: number`, `overrides?: MockRouteConfig[]`)
- [X] T007 Add new SSE event type variants (`mock_openapi_parsed`, `mock_validation_error`, `mock_recording_saved`) to the event type unions in `packages/core/src/types.ts`
- [X] T008 [P] Re-export all types from `packages/core/src/openapi/index.ts`

**Checkpoint**: Foundation ready — OpenAPI types, config schema extensions, and SSE event types in place. User story implementation can now begin.

---

## Phase 3: US1 — One-Click Mock Generation from OpenAPI Spec (Priority: P1) 🎯 MVP

**Goal**: A developer points the mock configuration at an OpenAPI spec file and the system automatically generates mock routes for every endpoint with schema-appropriate responses — zero manual route definitions required.

**Independent Test**: Provide an OpenAPI spec file in the mock configuration and verify that all spec-defined endpoints return schema-appropriate responses. Test both YAML and JSON formats, specs with and without `example` fields, `$ref` resolution, and multi-status-code selection via `X-Mock-Status` header.

### Implementation for User Story 1

- [X] T009 [US1] Implement `loadAndDereferenceSpec(specPath: string)` in `packages/core/src/openapi/spec-loader.ts` — use `@readme/openapi-parser` to validate + dereference the spec, resolve the path to absolute, extract routes into `OpenAPIRoute[]`, detect circular `$ref` references, and return a `DereferencedSpec`. Report clear errors for invalid/missing specs and unresolvable references (FR-M01, FR-M09, FR-M11).
- [X] T010 [US1] Implement `convertOpenApiPath(openApiPath: string): string` helper in `packages/core/src/openapi/spec-loader.ts` — convert `{param}` syntax to Fastify `:param` syntax via regex replace (FR-M10)
- [X] T011 [US1] Implement `generateResponseBody(schema: JSONSchema, options: { maxDepth: number; currentDepth?: number }): unknown` in `packages/core/src/openapi/response-generator.ts` — generate mock response bodies from JSON schemas using `example` fields when present, or type-appropriate placeholders when absent. Handle `string` (format-aware: email, date, uuid), `integer`, `number`, `boolean`, `array` (single-element), `object` (recursive), `enum` (first value), `oneOf`/`anyOf` (first variant), `allOf` (merge). Enforce `maxDepth` for circular schema protection (FR-M02, FR-M11).
- [X] T012 [US1] Implement `buildOpenAPIRoutes(spec: DereferencedSpec, config: { maxDepth: number }): FastifyRouteConfig[]` in `packages/core/src/openapi/route-builder.ts` — iterate `spec.routes`, create a Fastify route handler per path/method that: selects default status code (lowest 2xx), checks `X-Mock-Status` header for alternative status codes, calls `generateResponseBody()` for the selected response schema, sets `Content-Type` from the response definition (FR-M02, FR-M03).
- [X] T013 [US1] Modify `createMockServer()` in `packages/core/src/mock-generator.ts` — add OpenAPI code path: when `config.openapi` is present, call `loadAndDereferenceSpec()` → `buildOpenAPIRoutes()` → register routes on the Fastify instance. Emit `mock_openapi_parsed` SSE event with endpoint count and spec version. Preserve backward compatibility: when `openapi` is absent, use existing route registration logic unchanged.
- [X] T014 [US1] Re-export `loadAndDereferenceSpec`, `generateResponseBody`, `buildOpenAPIRoutes` from `packages/core/src/openapi/index.ts`

### Tests for User Story 1

- [X] T015 [P] [US1] Write unit tests for `spec-loader.ts` covering: valid YAML spec parse, valid JSON spec parse, `$ref` resolution (inline + cross-file), circular `$ref` detection with max depth, invalid spec error reporting, missing file error, path parameter conversion (`{id}` → `:id`) — target 90%+ coverage in `packages/core/tests/unit/openapi/spec-loader.test.ts`
- [X] T016 [P] [US1] Write unit tests for `response-generator.ts` covering: example values used when present, string/integer/number/boolean/array/object type generation, format-aware strings (email, date, uuid), enum handling (first value), `oneOf`/`anyOf` (first variant), `allOf` (merge), circular depth enforcement, nested object generation — target 90%+ coverage in `packages/core/tests/unit/openapi/response-generator.test.ts`
- [X] T017 [P] [US1] Write unit tests for `route-builder.ts` covering: route creation for all HTTP methods, default status code selection (lowest 2xx), `X-Mock-Status` header override, content-type propagation, multi-response endpoint handling — target 90%+ coverage in `packages/core/tests/unit/openapi/route-builder.test.ts`
- [X] T018 [P] [US1] Write unit tests for the OpenAPI code path in `mock-generator.ts` covering: auto-generation from spec, backward compatibility (no openapi field), SSE event emission (`mock_openapi_parsed`), error handling for bad spec path — in `packages/core/tests/unit/openapi/mock-generator-openapi.test.ts`

**Checkpoint**: US1 complete — developers can point mock config at an OpenAPI spec and get a fully functioning mock server with all endpoints. Zero manual route definitions. Delivers immediate value.

---

## Phase 4: US2 — Request Validation Mode (Priority: P2)

**Goal**: Enable optional request validation that checks incoming requests against the OpenAPI spec, returning 422 with clear error details on validation failure — transforming the mock from a passive stub into an active correctness checker.

**Independent Test**: Enable `validate: true` on a mock with an OpenAPI spec, send both valid and invalid requests. Valid requests receive mock responses; invalid requests receive 422 with detailed validation errors.

### Implementation for User Story 2

- [X] T019 [US2] Implement `compileValidators(spec: DereferencedSpec): RequestValidatorSet` in `packages/core/src/openapi/request-validator.ts` — at mock server startup, extract request body schemas, parameter schemas, and header schemas from the dereferenced spec; compile each into an Ajv validator. Return a `RequestValidatorSet` with a `validate(method, path, request)` method.
- [X] T020 [US2] Implement `validateRequest(validators: RequestValidatorSet, method: string, path: string, request: FastifyRequest): ValidationResult` in `packages/core/src/openapi/request-validator.ts` — validate request body (type/structure), path parameters, query parameters, and headers against compiled schemas. Return structured `ValidationResult` with location-specific errors. Return 422 error for unknown endpoints not in spec (FR-M04).
- [X] T021 [US2] Integrate request validation into `createMockServer()` in `packages/core/src/mock-generator.ts` — when `config.validate === true` and `config.openapi` is present, compile validators at startup and register a Fastify `preHandler` hook that validates every incoming request. On failure, return 422 with `{ error: "Request validation failed", code: "VALIDATION_ERROR", details: [...] }`. Emit `mock_validation_error` SSE event on validation failures.
- [X] T022 [US2] Re-export `compileValidators`, `validateRequest` from `packages/core/src/openapi/index.ts`

### Tests for User Story 2

- [X] T023 [P] [US2] Write unit tests for `request-validator.ts` covering: body type mismatch (string where integer expected), missing required field, unknown endpoint rejection, query parameter type validation, valid request passes, validation disabled returns no errors — target 90%+ coverage in `packages/core/tests/unit/openapi/request-validator.test.ts`

**Checkpoint**: US2 complete — request validation catches integration bugs early. Mock rejects malformed requests with clear, actionable error messages.

---

## Phase 5: US3 — Manual Override of Auto-Generated Routes (Priority: P2)

**Goal**: Allow developers to override specific auto-generated endpoints with custom responses while keeping auto-generation for everything else — the best of both worlds.

**Independent Test**: Define a mock with an OpenAPI spec and one override entry. Verify the overridden endpoint returns the custom response (with template variable expansion) while non-overridden endpoints return auto-generated responses.

### Implementation for User Story 3

- [X] T024 [US3] Implement override route precedence logic in `createMockServer()` in `packages/core/src/mock-generator.ts` — when `config.openapi` is present and `config.overrides` (or `config.routes`) is provided, register auto-generated routes from spec first, then register override routes that take precedence. Override routes support existing template variables (`{{uuid}}`, etc.) via the existing template engine. Merge `routes` and `overrides` arrays when both present (backward compatibility per data-model).
- [X] T025 [US3] Ensure override routes for paths NOT in the OpenAPI spec work correctly — overrides are independent of the spec and can define entirely custom routes (per edge case spec).

### Tests for User Story 3

- [X] T026 [P] [US3] Write unit tests for override logic covering: override takes precedence over auto-generated route, non-overridden endpoints still auto-generate, template variable expansion in overrides (`{{uuid}}`), override for path not in spec, `routes` treated as overrides when `openapi` is present, merge of `routes` + `overrides` — in `packages/core/tests/unit/openapi/mock-generator-openapi.test.ts` (extend T018 test file)

**Checkpoint**: US3 complete — developers can customize specific endpoints while keeping auto-generation for the rest.

---

## Phase 6: US4 — Record/Replay Mode (Priority: P3)

**Goal**: Enable offline, deterministic testing via record/replay. Record mode proxies to the real API and saves responses; replay mode serves recorded responses without network access; smart mode falls back to auto-generation for unrecorded endpoints.

**Independent Test**: Run in `record` mode against a real API, then switch to `replay` mode and verify identical responses are served without network access. Test `smart` mode fallback to auto-generation.

### Implementation for User Story 4

- [X] T027 [US4] Implement `computeSignature(method: string, path: string, query: Record<string, string>): RequestSignature` in `packages/core/src/openapi/recorder.ts` — compute `${METHOD}:${path}?${sortedQueryString}` request signature for matching recordings.
- [X] T028 [US4] Implement `RecordingStoreImpl` class in `packages/core/src/openapi/recorder.ts` — implements `RecordingStore` interface with `save()`, `find()` (most recent match wins), `has()`, `flush()` (write to `{recordingsDir}/{mockName}.json`), and `load()` (read from disk). Use the `RecordingFile` format from data-model.md.
- [X] T029 [US4] Implement record-mode proxy handler in `packages/core/src/openapi/recorder.ts` — function `createRecordHandler(target: string, store: RecordingStore)` that forwards requests to the real API via `fetch()`, saves the request/response pair to the store, and returns the real response to the caller. Handle connectivity failures with clear error responses (per edge case spec). Emit `mock_recording_saved` SSE event.
- [X] T030 [US4] Integrate record/replay modes into `createMockServer()` in `packages/core/src/mock-generator.ts` — when `config.mode` is:
  - `auto`: register auto-generated routes (existing US1 behavior)
  - `record`: create `RecordingStoreImpl`, register record proxy handlers for all spec routes
  - `replay`: load recordings, register replay handlers; return error for unrecorded requests
  - `smart`: load recordings, register handlers that replay when recording exists, fall back to auto-generated response otherwise
- [X] T031 [US4] Re-export `RecordingStoreImpl`, `computeSignature`, `createRecordHandler` from `packages/core/src/openapi/index.ts`

### Tests for User Story 4

- [X] T032 [P] [US4] Write unit tests for `recorder.ts` covering: signature computation (method, path, sorted query), recording save/find/has operations, most recent recording wins on duplicate signatures, flush to disk (verify JSON format), load from disk, empty store returns undefined, record handler proxies correctly, replay handler serves recorded response, smart mode fallback to auto-generation — target 90%+ coverage in `packages/core/tests/unit/openapi/recorder.test.ts`

**Checkpoint**: US4 complete — developers can record API interactions and replay them deterministically. CI pipelines run without network access.

---

## Phase 7: US5 — MCP Tools for Mock Management (Priority: P3)

**Goal**: Provide `argus_mock_generate` and `argus_mock_validate` MCP tools for rapid mock configuration generation and endpoint coverage validation.

**Independent Test**: Invoke each MCP tool with appropriate inputs and verify the output format matches the contracts. `argus_mock_generate` returns valid YAML; `argus_mock_validate` returns accurate coverage report.

### Implementation for User Story 5

- [X] T033 [US5] Implement `argus_mock_generate` handler in `packages/mcp/src/tools/mock-generate.ts` — accept `projectPath`, `specPath`, optional `mockName`/`port`/`mode`/`validate`/`target` params per contract; call `loadAndDereferenceSpec()` to parse the spec; generate YAML config snippet with all endpoints; return `MockGenerateResult` with `yaml` string and `summary` (specTitle, specVersion, totalEndpoints, methods breakdown). Handle `SPEC_NOT_FOUND`, `SPEC_PARSE_ERROR`, `SPEC_VALIDATION_ERROR` errors.
- [X] T034 [US5] Implement `argus_mock_validate` handler in `packages/mcp/src/tools/mock-validate.ts` — accept `projectPath`, optional `mockName`/`specPath` params per contract; load e2e.yaml config and OpenAPI spec; compare spec endpoints against mock routes (auto-generated + overrides); return `MockValidateResult` with `totalSpecEndpoints`, `coveredCount`, `missingCount`, `coveragePercent`, `covered`, `missing`, `extra` arrays. Handle `SESSION_NOT_FOUND`, `MOCK_NOT_FOUND`, `NO_OPENAPI_SPEC`, `SPEC_PARSE_ERROR` errors.
- [X] T035 [US5] Register `argus_mock_generate` and `argus_mock_validate` tools with Zod parameter schemas in `packages/mcp/src/server.ts` (tool count: 18 → 20)

### Tests for User Story 5

- [X] T036 [P] [US5] Write unit tests for `mock-generate.ts` covering: valid spec produces correct YAML snippet, summary fields are accurate, missing spec file error, invalid spec error, optional params (port, mode, validate) reflected in output — in `packages/mcp/tests/unit/mock-generate.test.ts`
- [X] T037 [P] [US5] Write unit tests for `mock-validate.ts` covering: full coverage (all endpoints matched), partial coverage (missing endpoints reported), extra endpoints detected, mock without openapi field error, override-only mock validation — in `packages/mcp/tests/unit/mock-validate.test.ts`

**Checkpoint**: US5 complete — MCP users can generate mock config and validate endpoint coverage without manual YAML editing.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Final integration, re-exports, and validation across all user stories

- [X] T038 Add `export * from './openapi/index.js'` to `packages/core/src/index.ts` for public API surface
- [X] T039 [P] Verify backward compatibility: existing `e2e.yaml` files with only `routes` (no `openapi`) must work identically — no regressions in manual mock behavior
- [X] T040 [P] Verify config defaults: when `openapi` is absent, `mode`, `validate`, `overrides` are ignored; when `openapi` is present, `mode` defaults to `auto`, `validate` defaults to `false`, `maxDepth` defaults to `3`, `recordingsDir` defaults to `.argusai/recordings`
- [X] T041 [P] Validate all error messages are clear and actionable: malformed spec, missing file, unresolvable `$ref`, circular reference, unreachable target in record mode (FR-M09)
- [X] T042 [P] Run full openapi test suite and verify 90%+ coverage for `spec-loader.test.ts`, `response-generator.test.ts`, `route-builder.test.ts`, `request-validator.test.ts`, `recorder.test.ts`
- [X] T043 [P] Run quickstart.md scenarios end-to-end: auto mode, validation mode, override mode, record/replay cycle, MCP tool invocations

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 — **BLOCKS all user stories**
- **US1 (Phase 3)**: Depends on Phase 2 — **BLOCKS US2, US3, US4** (all stories need auto-generated routes)
- **US2 (Phase 4)**: Depends on US1 (needs spec-loader and route-builder)
- **US3 (Phase 5)**: Depends on US1 (needs auto-generated routes to override); **can parallel with US2**
- **US4 (Phase 6)**: Depends on US1 (needs spec-loader and response-generator for smart mode fallback)
- **US5 (Phase 7)**: Depends on US1 (needs spec-loader for both tools); **can parallel with US2, US3, US4**
- **Polish (Phase 8)**: Depends on all user stories being complete

### User Story Dependencies

```
Phase 1 (Setup)
  └─→ Phase 2 (Foundational)
        └─→ Phase 3 (US1: One-Click Mock Generation) ← ALL stories depend on this
              ├─→ Phase 4 (US2: Request Validation) [P]
              ├─→ Phase 5 (US3: Manual Overrides) [P]
              ├─→ Phase 6 (US4: Record/Replay) [P]
              └─→ Phase 7 (US5: MCP Tools) [P]
                                                      └─→ Phase 8 (Polish)
```

### Within Each User Story

1. Core module implementation (spec-loader, response-generator, etc.)
2. Integration with `mock-generator.ts` or MCP `server.ts`
3. Barrel export update (`index.ts`)
4. Unit tests (can parallel with integration step)

### Parallel Opportunities

**Story-level parallelism** (after US1 completes):
- US2, US3, US4, US5 can all proceed simultaneously — they touch different files with no cross-dependencies
- This represents **19 tasks** (Phases 4–7) that can be distributed across parallel workers

**Task-level parallelism** (within each phase):
- All tasks marked `[P]` can run alongside other tasks in the same phase
- Test writing tasks (`[P]`) can run alongside integration tasks in the same story
- Setup tasks T002 and T003 can run in parallel with T001

---

## Parallel Example: P2/P3 User Stories (Phases 4–7)

After US1 (one-click mock generation) is complete, all remaining stories can launch in parallel:

```text
Worker A: US2 — Request Validation
  T019 → T020 → T021 → T022 + T023

Worker B: US3 — Manual Overrides
  T024 → T025 + T026

Worker C: US4 — Record/Replay
  T027 → T028 → T029 → T030 → T031 + T032

Worker D: US5 — MCP Tools
  T033 → T034 → T035 + T036 + T037
```

---

## Implementation Strategy

### MVP First (US1 = One-Click Mock Generation)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — blocks everything)
3. Complete Phase 3: US1 — One-Click Mock Generation
4. **STOP and VALIDATE**: Provide an OpenAPI spec → verify all endpoints auto-generate correct responses. Test YAML/JSON, examples/no-examples, `$ref` resolution, `X-Mock-Status` header.
5. Deploy/demo if ready — developers can immediately eliminate manual mock route definitions

### Incremental Delivery

1. Setup + Foundational + US1 → **MVP: One-click mock generation** ✅
2. Add US2 (Request Validation) → Malformed requests caught early ✅
3. Add US3 (Manual Overrides) → Custom responses for specific endpoints ✅
4. Add US4 (Record/Replay) → Offline deterministic testing ✅
5. Add US5 (MCP Tools) → Config generation and coverage validation ✅
6. Polish → Final integration, backward compat validation, coverage check ✅

### Summary Table

| Phase | Story | Priority | Tasks | Parallel | Files Created | Files Modified |
|-------|-------|----------|-------|----------|---------------|----------------|
| 1 | Setup | — | 3 | 2 | 2 | 1 |
| 2 | Foundational | — | 5 | 1 | 1 | 2 |
| 3 | US1: One-Click Mock Gen | P1 | 10 | 4 | 3 | 1 |
| 4 | US2: Request Validation | P2 | 5 | 1 | 1 | 1 |
| 5 | US3: Manual Overrides | P2 | 3 | 1 | 0 | 1 |
| 6 | US4: Record/Replay | P3 | 6 | 1 | 1 | 1 |
| 7 | US5: MCP Tools | P3 | 5 | 2 | 2 | 1 |
| 8 | Polish | — | 6 | 5 | 0 | 1 |
| **Total** | | | **43** | **17** | **10** | **~9** |

---

## Notes

- `[P]` tasks = different files, no dependencies on incomplete tasks in the same phase
- `[Story]` labels (US1–US5) map each task to its user story for traceability
- Each user story is independently completable and testable at its checkpoint
- Commit after each task or logical group within a story
- Stop at any checkpoint to validate the story independently
- Tests use Vitest with mocked file system and HTTP calls — no real API or file I/O required for unit tests
- All new code uses TypeScript strict mode, ESM imports, no `any` types
- One new runtime dependency: `@readme/openapi-parser` ^4.0.0; `ajv` moved from devDependencies to dependencies
- Backward compatibility is preserved — existing `e2e.yaml` files with only `routes` work identically
