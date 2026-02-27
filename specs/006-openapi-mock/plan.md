# Implementation Plan: OpenAPI Smart Mock

**Branch**: `006-openapi-mock` | **Date**: 2026-02-27 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `/specs/006-openapi-mock/spec.md`

## Summary

Extend the existing declarative mock system to support one-click mock generation from OpenAPI 3.x specifications. A developer adds a single `openapi` field pointing to a spec file, and the system automatically generates Fastify routes for every endpoint with schema-appropriate responses. Layered on top: request validation mode (FR-M04), manual overrides (FR-M06), record/replay modes (FR-M05), and two new MCP tools for config generation and coverage validation (FR-M07/M08).

**Technical approach**: Parse OpenAPI specs with `@readme/openapi-parser` (dereference all `$ref`), generate response bodies from JSON schemas, validate requests with `ajv`, and persist recordings as JSON files. All new OpenAPI logic lives in `packages/core/src/openapi/`; the existing `mock-generator.ts` gains a new code path that delegates to this submodule when the `openapi` field is present.

## Technical Context

**Language/Version**: TypeScript 5.x, strict mode, ESM  
**Primary Dependencies**:
- `@readme/openapi-parser` ^4.0.0 — OpenAPI 3.0/3.1 parsing, validation, $ref dereferencing
- `ajv` ^8.18.0 — request validation (move from devDependencies → dependencies)
- `fastify` ^5.2.0 — mock HTTP servers (existing)
- `zod` ^3.23.0 — config schema validation (existing)

**Storage**: File system — recording files stored in `.argusai/recordings/{mock-name}.json`  
**Testing**: Vitest, targeting 90%+ coverage for the new `openapi/` module (core module)  
**Target Platform**: Node.js 20+, Linux (primary), macOS (development)  
**Project Type**: TypeScript monorepo (packages/core, cli, mcp, dashboard)  
**Performance Goals**: Mock server startup with a 50-endpoint spec < 500ms; per-request response time < 5ms (excluding delay simulation)  
**Constraints**: Backward-compatible — existing `e2e.yaml` files with manual `routes` must work identically  
**Scale/Scope**: OpenAPI specs up to ~200 endpoints, recording files up to ~10MB

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Status | Notes |
|---|-----------|--------|-------|
| 1 | Configuration-driven architecture | **PASS** | All behavior controlled via `e2e.yaml` — `openapi`, `mode`, `validate`, `overrides` are declarative config fields |
| 2 | Language-agnostic testing | **N/A** | This feature is infrastructure (mock server), not a test runner |
| 3 | Zero-intrusion testing | **PASS** | No service code modifications — mock server is external |
| 4 | TypeScript strict mode | **PASS** | All new code in strict TS, ESM, explicit types, no `any` |
| 5 | Test coverage requirements | **PASS** | Target: 90%+ for `openapi/` module (core module standard) |
| 6 | Single entry CLI | **PASS** | No new CLI commands needed; mock starts via existing `e2e-toolkit setup` |
| 7 | SSE real-time feedback | **PASS** | Existing `mock_starting`/`mock_started` SSE events apply; add `mock_openapi_parsed` event |
| 8 | Extensible architecture | **PASS** | New modules follow pluggable pattern; `openapi/` directory parallels `history/`, `knowledge/` |
| 9 | Web framework: Fastify | **PASS** | Mock server uses Fastify 5.x; auto-generated routes use Fastify's route registration |
| 10 | Node.js 20+ runtime | **PASS** | Uses native `fetch` for record-mode proxying; no legacy APIs |

**Compliance checklist**:
- [x] Configuration-driven: `openapi`, `mode`, `validate`, `target`, `overrides` in `e2e.yaml`
- [x] Zero-intrusion: mock server is external infrastructure
- [x] TypeScript strict mode, no `any` types
- [x] ESM module system
- [x] pnpm for dependency management
- [x] Vitest for testing, 90%+ coverage target
- [x] Fastify 5.x for mock server
- [x] Node.js 20+ features (native fetch for record proxying)
- [x] All public APIs have complete type definitions

## Project Structure

### Documentation (this feature)

```text
specs/006-openapi-mock/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0: technology decisions
├── data-model.md        # Phase 1: entity definitions and schemas
├── quickstart.md        # Phase 1: usage guide
├── contracts/           # Phase 1: MCP tool contracts
│   ├── argus_mock_generate.json
│   └── argus_mock_validate.json
└── tasks.md             # Phase 2 output (created by /speckit.tasks)
```

### Source Code (repository root)

```text
packages/core/
├── src/
│   ├── openapi/                    # NEW: OpenAPI subsystem
│   │   ├── index.ts                # Public re-exports
│   │   ├── types.ts                # OpenAPI-specific types (DereferencedSpec, OpenAPIRoute, etc.)
│   │   ├── spec-loader.ts          # Parse + validate + dereference OpenAPI specs
│   │   ├── response-generator.ts   # Generate mock response bodies from JSON schemas
│   │   ├── route-builder.ts        # Convert OpenAPI paths → Fastify route registrations
│   │   ├── request-validator.ts    # Validate incoming requests against spec (ajv-based)
│   │   └── recorder.ts            # Record/replay: RecordingStore, proxy, signature matching
│   ├── mock-generator.ts          # MODIFIED: add OpenAPI code path
│   ├── config-loader.ts           # MODIFIED: extend MockServiceSchema with new fields
│   └── types.ts                   # MODIFIED: extend MockServiceConfig interface
├── tests/
│   └── unit/
│       └── openapi/                # NEW: unit tests for each module
│           ├── spec-loader.test.ts
│           ├── response-generator.test.ts
│           ├── route-builder.test.ts
│           ├── request-validator.test.ts
│           ├── recorder.test.ts
│           └── mock-generator-openapi.test.ts
└── package.json                    # MODIFIED: add @readme/openapi-parser, move ajv to deps

packages/mcp/
├── src/
│   ├── tools/
│   │   ├── mock-generate.ts        # NEW: argus_mock_generate handler
│   │   └── mock-validate.ts        # NEW: argus_mock_validate handler
│   └── server.ts                   # MODIFIED: register 2 new tools (→ 20 total)
└── tests/
    └── unit/
        ├── mock-generate.test.ts    # NEW
        └── mock-validate.test.ts    # NEW
```

**Structure Decision**: Follows the established pattern of feature-specific subdirectories within `packages/core/src/` (matching `history/`, `knowledge/`, `resilience/`). MCP tools follow the existing one-file-per-tool pattern in `packages/mcp/src/tools/`.

## Implementation Architecture

### Module Dependency Graph

```
e2e.yaml (config)
    │
    ▼
config-loader.ts ──→ Extended MockServiceSchema (Zod)
    │
    ▼
mock-generator.ts ──→ createMockServer()
    │                      │
    │                openapi field present?
    │               ┌──no──┴──yes──┐
    │               ▼              ▼
    │         Existing path    openapi/spec-loader.ts
    │         (routes only)        │ dereference()
    │                              ▼
    │                    openapi/route-builder.ts
    │                         │ buildRoutes()
    │                         ▼
    │              openapi/response-generator.ts
    │                    │ generateResponse()
    │                    ▼
    │            Fastify route registration
    │                    │
    │     ┌──────────────┼──────────────┐
    │     ▼              ▼              ▼
    │  validate?     mode=record?   overrides?
    │     │              │              │
    │     ▼              ▼              ▼
    │  request-       recorder.ts    Override routes
    │  validator.ts                  take precedence
    │
    ▼
MCP Tools (packages/mcp/)
    ├── mock-generate.ts → spec-loader + YAML generation
    └── mock-validate.ts → spec-loader + coverage analysis
```

### Key Integration Points

1. **`mock-generator.ts` modification**: The `createMockServer()` function checks for `config.openapi`. When present, it calls `loadAndDereferenceSpec()` → `buildOpenAPIRoutes()` → registers routes on the Fastify instance. Override routes (from `config.overrides` or `config.routes`) are registered *after* auto-generated routes and checked *first* in the handler chain.

2. **`config-loader.ts` modification**: `MockServiceSchema` gains new optional Zod fields. A `.refine()` rule ensures `target` is required when `mode === 'record'`.

3. **`types.ts` modification**: `MockServiceConfig` interface adds the new fields (`openapi`, `mode`, `validate`, `target`, `recordingsDir`, `maxDepth`, `overrides`).

4. **MCP server.ts**: Two new tool registrations (`argus_mock_generate`, `argus_mock_validate`) bringing the total from 18 to 20.

### New SSE Events

```typescript
| { type: 'mock_openapi_parsed'; name: string; endpoints: number; specVersion: string; timestamp: number }
| { type: 'mock_validation_error'; name: string; method: string; path: string; errors: unknown[]; timestamp: number }
| { type: 'mock_recording_saved'; name: string; method: string; path: string; timestamp: number }
```

## Priority Phasing

Based on spec priorities:

| Phase | Stories | Modules | Effort |
|-------|---------|---------|--------|
| **P1** | US-1: One-click mock generation | spec-loader, response-generator, route-builder, config extension | ~3 days |
| **P2** | US-2: Request validation, US-3: Manual overrides | request-validator, override logic in mock-generator | ~2 days |
| **P3** | US-4: Record/replay, US-5: MCP tools | recorder, mock-generate tool, mock-validate tool | ~3 days |

## Complexity Tracking

No constitution violations found. All design decisions align with project principles.

| Aspect | Decision | Justification |
|--------|----------|---------------|
| New dependency (`@readme/openapi-parser`) | Accept | Spec requires full OpenAPI 3.0/3.1 parsing with $ref resolution; building this from scratch would be ~1000+ LOC and error-prone |
| `ajv` moved to production dependency | Accept | Already in project's devDependencies; needed at runtime for request validation |
| New `openapi/` directory in core | Accept | Follows established pattern (`history/`, `knowledge/`); keeps mock-generator.ts clean |
