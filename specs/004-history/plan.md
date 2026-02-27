# Implementation Plan: Test Result Persistence & Trend Analysis

**Branch**: `004-history` | **Date**: 2026-02-26 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/004-history/spec.md`

## Summary

Implement persistent test result storage using SQLite (better-sqlite3), automatic flaky test detection via a sliding-window ratio algorithm, four new MCP tools for AI Agent access to historical data, RESTful trend APIs for the Dashboard, and a React-based Trend Analysis page. The system records every test run and per-case outcome, computes flaky scores in real-time, and exposes this intelligence through MCP, REST, and visual interfaces.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode), Node.js 20+
**Primary Dependencies**: better-sqlite3 (new), Recharts (new for Dashboard UI), zod, fastify 5.x, React + Vite + Tailwind CSS (existing)
**Storage**: SQLite via better-sqlite3 (local mode), in-memory Map (test/CI mode)
**Testing**: Vitest (existing)
**Target Platform**: Linux server, macOS (development), Windows (WSL2)
**Project Type**: TypeScript monorepo (pnpm workspaces)
**Performance Goals**: <5% overhead on test execution from persistence; Trends page loads <3s for 1000 runs; flaky queries <2s (SC-003, SC-005, SC-007)
**Constraints**: Single-writer SQLite (application-level write serialization); graceful degradation on storage failure (FR-017)
**Scale/Scope**: Up to 1000 runs retained, ~15 test cases per run average, 4 new MCP tools, 7 new REST endpoints, 1 new Dashboard page

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Pre-Design Check

| Principle | Status | Notes |
|-----------|--------|-------|
| 1. Configuration-Driven | PASS | History config lives in `e2e.yaml` under `history:` key with sensible defaults |
| 2. Language-Agnostic | N/A | History records results from all test runners uniformly |
| 3. Zero-Intrusion | PASS | No service code modifications; history is internal to the tool |
| 4. TypeScript Strict Mode | PASS | All new code in strict TS, ESM imports, explicit types |
| 5. Test Coverage | PASS | Core modules (store, flaky) target 90%+; overall 80%+ |
| 6. Single Entry CLI | PASS | No new CLI subcommands; history is automatic on existing `run` |
| 7. SSE Real-Time Feedback | N/A | History recording is post-execution, no streaming needed |
| 8. Extensible Architecture | PASS | HistoryStore is an interface; SQLite and Memory implementations; new store backends can be added |
| 9. Web Framework (Fastify) | PASS | New routes use Fastify plugin pattern, matching existing `testRoutes`, `configRoutes` |
| 10. Node.js 20+ | PASS | Uses `crypto.createHash` (built-in), `child_process.execSync` (built-in) |

### Post-Design Re-Check

| Principle | Status | Notes |
|-----------|--------|-------|
| 1. Configuration-Driven | PASS | `HistoryConfigSchema` added to `E2EConfigSchema` with `.default({})` |
| 2. Language-Agnostic | N/A | |
| 3. Zero-Intrusion | PASS | |
| 4. TypeScript Strict Mode | PASS | All interfaces defined; no `any` types; `@types/better-sqlite3` for native module |
| 5. Test Coverage | PASS | Test plan in quickstart.md; 6 test files across 3 packages |
| 6. Single Entry CLI | PASS | |
| 7. SSE Real-Time Feedback | N/A | |
| 8. Extensible Architecture | PASS | `HistoryStore` interface is pluggable; FlakyDetector accepts store as dependency |
| 9. Web Framework (Fastify) | PASS | `historyRoutes` plugin follows existing pattern |
| 10. Node.js 20+ | PASS | |

**Gate Result**: ALL PASS — no violations.

## Project Structure

### Documentation (this feature)

```text
specs/004-history/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 research output
├── data-model.md        # Phase 1 data model
├── quickstart.md        # Phase 1 quickstart guide
├── contracts/
│   ├── mcp-tools.md     # MCP tool contracts (tools 12-15)
│   └── rest-api.md      # REST API contracts (7 endpoints)
└── tasks.md             # Phase 2 output (NOT created by plan)
```

### Source Code (repository root)

```text
packages/core/src/
├── history/                    # NEW: History subsystem
│   ├── index.ts                # Public exports
│   ├── history-store.ts        # HistoryStore interface + SQLiteHistoryStore
│   ├── memory-history-store.ts # MemoryHistoryStore (for tests/CI)
│   ├── flaky-detector.ts       # Flaky score computation + StabilityLevel classification
│   ├── git-context.ts          # Git commit/branch retrieval
│   ├── config-hash.ts          # SHA-256 config fingerprinting
│   ├── history-recorder.ts     # Post-run recording orchestrator
│   ├── migrations.ts           # SQLite schema migrations (user_version pragma)
│   └── types.ts                # History-specific type definitions
├── config-loader.ts            # MODIFIED: Add HistoryConfigSchema to E2EConfigSchema
├── types.ts                    # MODIFIED: Add history-related types to main types
└── index.ts                    # MODIFIED: Re-export history module

packages/core/tests/
├── unit/
│   ├── history-store.test.ts   # NEW: SQLite + Memory store tests
│   ├── flaky-detector.test.ts  # NEW: Flaky algorithm tests
│   └── git-context.test.ts     # NEW: Git context retrieval tests

packages/mcp/src/
├── server.ts                   # MODIFIED: Register 4 new tools (tools 12-15)
└── tools/
    ├── history.ts              # NEW: argus_history handler
    ├── trends.ts               # NEW: argus_trends handler
    ├── flaky.ts                # NEW: argus_flaky handler
    └── compare.ts              # NEW: argus_compare handler

packages/mcp/tests/
└── history-tools.test.ts       # NEW: MCP tool handler tests

packages/dashboard/server/
├── routes/
│   └── history.ts              # NEW: 7 REST trend/history endpoints
└── index.ts                    # MODIFIED: Register historyRoutes plugin

packages/dashboard/ui/src/
├── pages/
│   └── TrendsPage.tsx          # NEW: Trend Analysis page
├── components/
│   ├── PassRateChart.tsx        # NEW: Recharts line chart
│   ├── DurationChart.tsx        # NEW: Duration trend chart
│   ├── FlakyTable.tsx           # NEW: Flaky ranking table
│   ├── FailuresList.tsx         # NEW: Recent failures list
│   └── RunTimeline.tsx          # NEW: Run history timeline
└── App.tsx                      # MODIFIED: Add Trends route + nav link
```

**Structure Decision**: Follows the existing monorepo package layout. New history subsystem lives in `packages/core/src/history/` as a self-contained module, mirroring the `packages/core/src/resilience/` pattern. MCP tools follow the existing `packages/mcp/src/tools/` per-file pattern. Dashboard follows the existing `server/routes/` and `ui/src/pages/` patterns.

## Complexity Tracking

> No constitution violations to justify. All choices align with project principles.

| Aspect | Decision | Rationale |
|--------|----------|-----------|
| New dependency: `better-sqlite3` | Accepted | Required for performant local SQLite; prebuilt binaries available; aligns with team's pre-identified choice |
| New dependency: `recharts` | Accepted | React-native chart library for Trends page; ~50KB gzipped; best DX for React + Tailwind dashboard |
| Separate `HistoryStore` interface | Accepted | Different concern than existing `Store` (analytical vs. operational); avoids interface bloat |
| No `@types/better-sqlite3` in production deps | Devdep only | Types are compile-time only; better-sqlite3 itself is the runtime dependency |
